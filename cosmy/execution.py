from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from time import perf_counter
from typing import Protocol

from .errors import ProviderError, RequestCancelledError
from .models import ResponseChunk, ResponseRequest, ResponseResult, RouteDecision
from .providers import Provider
from .stores import MemoryHealthStore, MemoryMetrics, RequestMetric, UsageReservation


class UsageLedger(Protocol):
    async def reserve(self, tenant_id: str, estimated_cost_usd: float) -> UsageReservation: ...
    async def reconcile(self, reservation: UsageReservation, actual_cost_usd: float) -> None: ...


class RequestExecutor:
    def __init__(
        self, providers: tuple[Provider, ...], usage: UsageLedger, health: MemoryHealthStore, metrics: MemoryMetrics
    ) -> None:
        self.providers = {provider.name: provider for provider in providers}
        self.usage = usage
        self.health = health
        self.metrics = metrics

    def _provider(self, route: RouteDecision) -> Provider:
        provider = self.providers.get(route.selected.model.provider)
        if provider is None:
            raise ProviderError(f"Provider '{route.selected.model.provider}' is not configured", False)
        return provider

    async def execute(self, request_id: str, route: RouteDecision, request: ResponseRequest) -> ResponseResult:
        candidates = (route.selected, *route.alternatives)
        for fallback_index, candidate in enumerate(candidates):
            attempt_route = route.model_copy(
                update={"selected": candidate, "alternatives": tuple(candidates[fallback_index + 1 :])}
            )
            try:
                return await self._execute_candidate(request_id, attempt_route, request, fallback_index)
            except ProviderError as error:
                if (
                    not (request.policy is None or request.policy.allow_fallback)
                    or not error.retryable
                    or fallback_index == len(candidates) - 1
                ):
                    raise
        raise ProviderError("All route candidates failed")

    async def _execute_candidate(
        self, request_id: str, route: RouteDecision, request: ResponseRequest, fallback_index: int
    ) -> ResponseResult:
        provider = self._provider(route)
        tenant_id = request.policy.tenant_id if request.policy and request.policy.tenant_id else "default"
        reservation = await self.usage.reserve(tenant_id, route.selected.estimated_cost_usd)
        started = perf_counter()
        provider_request = request.model_copy(update={"request_id": request_id})
        try:
            response = await provider.complete(provider_request, route.selected.model)
            latency_ms = (perf_counter() - started) * 1_000
            self.health.mark_success(route.selected.model.id, latency_ms)
            await self.usage.reconcile(reservation, response.usage.estimated_cost_usd)
            self.metrics.record(
                RequestMetric(
                    request_id,
                    route.selected.model.model,
                    provider.name,
                    "success",
                    latency_ms,
                    fallback_index,
                    response.usage,
                )
            )
            return ResponseResult.model_construct(
                request_id=request_id,
                model=route.selected.model.model,
                provider=provider.name,
                output=response.output,
                usage=response.usage,
                status="completed",
                finish_reason=response.finish_reason,
                route=route,
            )
        except asyncio.CancelledError as error:
            await self.usage.reconcile(reservation, 0)
            raise RequestCancelledError() from error
        except Exception:
            latency_ms = (perf_counter() - started) * 1_000
            self.health.mark_failure(route.selected.model.id)
            await self.usage.reconcile(reservation, 0)
            self.metrics.record(
                RequestMetric(
                    request_id, route.selected.model.model, provider.name, "error", latency_ms, fallback_index
                )
            )
            raise

    async def stream(
        self, request_id: str, route: RouteDecision, request: ResponseRequest
    ) -> AsyncIterator[ResponseChunk]:
        candidates = (route.selected, *route.alternatives)
        for fallback_index, candidate in enumerate(candidates):
            attempt_route = route.model_copy(
                update={"selected": candidate, "alternatives": tuple(candidates[fallback_index + 1 :])}
            )
            emitted = False
            try:
                async for chunk in self._stream_candidate(request_id, attempt_route, request, fallback_index):
                    emitted = emitted or bool(chunk.delta)
                    yield chunk
                return
            except ProviderError as error:
                if (
                    emitted
                    or not (request.policy is None or request.policy.allow_fallback)
                    or not error.retryable
                    or fallback_index == len(candidates) - 1
                ):
                    raise

    async def _stream_candidate(
        self, request_id: str, route: RouteDecision, request: ResponseRequest, fallback_index: int
    ) -> AsyncIterator[ResponseChunk]:
        provider = self._provider(route)
        tenant_id = request.policy.tenant_id if request.policy and request.policy.tenant_id else "default"
        reservation = await self.usage.reserve(tenant_id, route.selected.estimated_cost_usd)
        started = perf_counter()
        actual_cost = 0.0
        completed = False
        provider_request = request.model_copy(update={"request_id": request_id})
        try:
            async for chunk in provider.stream(provider_request, route.selected.model):
                current = chunk.model_copy(update={"request_id": request_id})
                yield current
                if current.done and current.usage:
                    latency_ms = (perf_counter() - started) * 1_000
                    actual_cost = current.usage.estimated_cost_usd
                    completed = True
                    self.health.mark_success(route.selected.model.id, latency_ms)
                    self.metrics.record(
                        RequestMetric(
                            request_id,
                            route.selected.model.model,
                            provider.name,
                            "success",
                            latency_ms,
                            fallback_index,
                            current.usage,
                        )
                    )
        except Exception:
            self.health.mark_failure(route.selected.model.id)
            raise
        finally:
            await self.usage.reconcile(reservation, actual_cost if completed else 0)
