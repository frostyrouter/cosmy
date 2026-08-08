from collections.abc import AsyncIterator

import pytest

from cosmy.errors import ProviderError
from cosmy.models import ChatMessage, ResponseChunk, ResponseRequest, Usage
from cosmy.providers import Provider, ProviderResponse, ResilientProvider
from cosmy.registry import DEFAULT_MODELS


class FlakyProvider(Provider):
    name = "flaky"

    def __init__(self, failures: int, retryable: bool = True) -> None:
        self.failures = failures
        self.retryable = retryable
        self.calls = 0

    async def complete(self, request, model) -> ProviderResponse:
        self.calls += 1
        if self.calls <= self.failures:
            raise ProviderError("temporary" if self.retryable else "bad request", self.retryable)
        return ProviderResponse("ok", Usage(input_tokens=1, output_tokens=1, total_tokens=2, estimated_cost_usd=0))

    async def stream(self, request, model) -> AsyncIterator[ResponseChunk]:
        if False:
            yield


@pytest.mark.asyncio
async def test_retries_transient_failures() -> None:
    provider = FlakyProvider(2)
    result = await ResilientProvider(provider, 1, 2).complete(
        ResponseRequest(messages=[ChatMessage(role="user", content="hello")]), DEFAULT_MODELS[0]
    )
    assert result.output == "ok"
    assert provider.calls == 3


@pytest.mark.asyncio
async def test_does_not_retry_non_retryable_failure() -> None:
    provider = FlakyProvider(3, retryable=False)
    with pytest.raises(ProviderError, match="bad request"):
        await ResilientProvider(provider, 1, 3).complete(
            ResponseRequest(messages=[ChatMessage(role="user", content="hello")]), DEFAULT_MODELS[0]
        )
    assert provider.calls == 1
