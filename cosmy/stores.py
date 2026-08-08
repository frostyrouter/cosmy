from __future__ import annotations

import asyncio
from dataclasses import dataclass
from time import monotonic
from uuid import uuid4

from .errors import RouterError
from .models import ResponseResult, Usage, now_iso


@dataclass(frozen=True, slots=True)
class UsageReservation:
    id: str
    tenant_id: str
    estimated_cost_usd: float


class MemoryUsageLedger:
    def __init__(self, limits: dict[str, float] | None = None) -> None:
        self.limits = limits or {}
        self.reserved: dict[str, float] = {}
        self.spent: dict[str, float] = {}
        self.active: dict[str, UsageReservation] = {}
        self._lock = asyncio.Lock()

    async def reserve(self, tenant_id: str, estimated_cost_usd: float) -> UsageReservation:
        async with self._lock:
            current = self.reserved.get(tenant_id, 0.0)
            limit = self.limits.get(tenant_id)
            if limit is not None and current + estimated_cost_usd > limit:
                raise RouterError("Tenant budget would be exceeded", "budget_exceeded", 429)
            reservation = UsageReservation(f"res_{uuid4()}", tenant_id, estimated_cost_usd)
            self.reserved[tenant_id] = current + estimated_cost_usd
            self.active[reservation.id] = reservation
            return reservation

    async def reconcile(self, reservation: UsageReservation, actual_cost_usd: float) -> None:
        async with self._lock:
            active = self.active.pop(reservation.id, None)
            if active is None:
                return
            self.reserved[active.tenant_id] = max(
                0.0, self.reserved.get(active.tenant_id, 0.0) - active.estimated_cost_usd
            )
            self.spent[active.tenant_id] = self.spent.get(active.tenant_id, 0.0) + max(0.0, actual_cost_usd)


class MemoryHealthStore:
    def __init__(self) -> None:
        self.successes: dict[str, int] = {}
        self.failures: dict[str, int] = {}
        self.latencies: dict[str, float] = {}
        self.updated: dict[str, str] = {}

    def mark_success(self, model_id: str, latency_ms: float) -> None:
        self.successes[model_id] = self.successes.get(model_id, 0) + 1
        self.latencies[model_id] = latency_ms
        self.updated[model_id] = now_iso()

    def mark_failure(self, model_id: str) -> None:
        self.failures[model_id] = self.failures.get(model_id, 0) + 1
        self.updated[model_id] = now_iso()


@dataclass(frozen=True, slots=True)
class RequestMetric:
    request_id: str
    model: str
    provider: str
    status: str
    latency_ms: float
    fallback_index: int
    usage: Usage | None = None


class MemoryMetrics:
    def __init__(self, capacity: int = 10_000) -> None:
        self.capacity = capacity
        self.values: list[RequestMetric] = []

    def record(self, metric: RequestMetric) -> None:
        if len(self.values) >= self.capacity:
            del self.values[: max(1, self.capacity // 10)]
        self.values.append(metric)


@dataclass(slots=True)
class _CacheEntry:
    value: ResponseResult
    expires_at: float


class MemoryResponseCache:
    def __init__(self, max_entries: int = 1_000) -> None:
        self.max_entries = max_entries
        self.entries: dict[str, _CacheEntry] = {}

    def get(self, key: str) -> ResponseResult | None:
        entry = self.entries.get(key)
        if entry is None:
            return None
        if entry.expires_at <= monotonic():
            self.entries.pop(key, None)
            return None
        return entry.value

    def set(self, key: str, value: ResponseResult, ttl_seconds: int) -> None:
        if len(self.entries) >= self.max_entries:
            self.entries.pop(next(iter(self.entries)), None)
        self.entries[key] = _CacheEntry(value, monotonic() + ttl_seconds)
