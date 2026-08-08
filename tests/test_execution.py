from collections.abc import AsyncIterator

import pytest

from cosmy.errors import ProviderError
from cosmy.execution import RequestExecutor
from cosmy.models import ChatMessage, ResponseChunk, ResponseRequest
from cosmy.providers import Provider, SimulatorProvider
from cosmy.registry import ModelRegistry
from cosmy.routing import DeterministicRouter
from cosmy.stores import MemoryHealthStore, MemoryMetrics, MemoryUsageLedger


class FailingProvider(Provider):
    name = "simulator"

    async def complete(self, request: ResponseRequest, model):
        raise ProviderError("temporary failure")

    async def stream(self, request: ResponseRequest, model) -> AsyncIterator[ResponseChunk]:
        raise ProviderError("temporary failure")
        yield


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
