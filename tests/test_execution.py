from collections.abc import AsyncIterator

import pytest

from cosmy.errors import ProviderError
from cosmy.execution import RequestExecutor
from cosmy.models import ChatMessage, ResponseChunk, ResponseRequest, Usage
from cosmy.providers import Provider, ProviderResponse, SimulatorProvider
from cosmy.registry import DEFAULT_MODELS, ModelRegistry
from cosmy.routing import DeterministicRouter
from cosmy.stores import MemoryHealthStore, MemoryMetrics, MemoryUsageLedger


class FailingProvider(Provider):
    name = "simulator"

    async def complete(self, request: ResponseRequest, model):
        raise ProviderError("temporary failure")

    async def stream(self, request: ResponseRequest, model) -> AsyncIterator[ResponseChunk]:
        raise ProviderError("temporary failure")
        yield


class SuccessfulProvider(Provider):
    def __init__(self, name: str, output: str = "fallback") -> None:
        self.name = name
        self.output = output

    async def complete(self, request, model) -> ProviderResponse:
        return ProviderResponse(
            self.output,
            Usage(input_tokens=1, output_tokens=1, total_tokens=2, estimated_cost_usd=0),
        )

    async def stream(self, request, model) -> AsyncIterator[ResponseChunk]:
        yield ResponseChunk(request_id=request.request_id or "unknown", index=0, delta=self.output, done=False)


class InterruptedStreamProvider(FailingProvider):
    def __init__(self, name: str) -> None:
        self.name = name

    async def complete(self, request, model) -> ProviderResponse:
        raise ProviderError("upstream unavailable")

    async def stream(self, request, model) -> AsyncIterator[ResponseChunk]:
        yield ResponseChunk(request_id=request.request_id or "unknown", index=0, delta="partial", done=False)
        raise ProviderError("stream interrupted")


@pytest.mark.asyncio
async def test_execution_reconciles_successful_usage() -> None:
    ledger = MemoryUsageLedger()
    registry = ModelRegistry()
    request = ResponseRequest(messages=[ChatMessage(role="user", content="hello")])
    route = DeterministicRouter(registry).decide("req_test", request)
    result = await RequestExecutor((SimulatorProvider(),), ledger, MemoryHealthStore(), MemoryMetrics()).execute(
        "req_test", route, request
    )
    assert result.status == "completed"
    assert ledger.reserved["default"] == 0
    assert ledger.spent["default"] == result.usage.estimated_cost_usd


@pytest.mark.asyncio
async def test_execution_releases_reservation_on_failure() -> None:
    ledger = MemoryUsageLedger()
    registry = ModelRegistry()
    request = ResponseRequest(messages=[ChatMessage(role="user", content="hello")])
    route = DeterministicRouter(registry).decide("req_test", request)
    with pytest.raises(ProviderError):
        await RequestExecutor((FailingProvider(),), ledger, MemoryHealthStore(), MemoryMetrics()).execute(
            "req_test", route, request
        )
    assert ledger.reserved["default"] == 0


@pytest.mark.asyncio
async def test_falls_back_to_next_candidate_and_records_metrics() -> None:
    first = DEFAULT_MODELS[0].model_copy(update={"id": "first", "provider": "first"})
    second = DEFAULT_MODELS[0].model_copy(update={"id": "second", "provider": "second"})
    request = ResponseRequest(messages=[ChatMessage(role="user", content="hello")])
    route = DeterministicRouter(ModelRegistry((first, second))).decide("req_fallback", request)
    metrics = MemoryMetrics()
    executor = RequestExecutor(
        (InterruptedStreamProvider("first"), SuccessfulProvider("second")),
        MemoryUsageLedger(),
        MemoryHealthStore(),
        metrics,
    )
    result = await executor.execute("req_fallback", route, request)
    assert result.provider == "second"
    assert result.output == "fallback"
    assert metrics.snapshot()["fallbacks"] == 1


@pytest.mark.asyncio
async def test_stream_does_not_fallback_after_output_is_emitted() -> None:
    first = DEFAULT_MODELS[0].model_copy(update={"id": "first", "provider": "first"})
    second = DEFAULT_MODELS[0].model_copy(update={"id": "second", "provider": "second"})
    request = ResponseRequest(stream=True, messages=[ChatMessage(role="user", content="hello")])
    route = DeterministicRouter(ModelRegistry((first, second))).decide("req_stream", request)
    executor = RequestExecutor(
        (InterruptedStreamProvider("first"), SuccessfulProvider("second")),
        MemoryUsageLedger(),
        MemoryHealthStore(),
        MemoryMetrics(),
    )
    chunks: list[str] = []
    with pytest.raises(ProviderError, match="stream interrupted"):
        async for chunk in executor.stream("req_stream", route, request):
            chunks.append(chunk.delta)
    assert chunks == ["partial"]
