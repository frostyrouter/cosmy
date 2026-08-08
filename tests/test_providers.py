import json

import httpx
import pytest

from cosmy.models import ChatMessage, ModelConfiguration, ResponseRequest
from cosmy.providers import AnthropicProvider, GeminiProvider, OpenAIProvider
from cosmy.registry import DEFAULT_MODELS


def provider_model(provider: str, model: str) -> ModelConfiguration:
    return DEFAULT_MODELS[0].model_copy(update={"id": f"{provider}-test", "provider": provider, "model": model})


@pytest.mark.asyncio
async def test_openai_normalizes_completion() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer test"
        assert json.loads(request.content)["model"] == "gpt-test"
        return httpx.Response(
            200, json={"output_text": "hello", "usage": {"input_tokens": 2, "output_tokens": 3}, "status": "completed"}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        model = provider_model("openai", "gpt-test")
        result = await OpenAIProvider("test", client).complete(
            ResponseRequest(messages=[ChatMessage(role="user", content="hi")]), model
        )
    assert result.output == "hello"
    assert result.usage.total_tokens == 5


@pytest.mark.asyncio
async def test_openai_normalizes_stream() -> None:
    stream = (
        'event: response.output_text.delta\ndata: {"delta":"he"}\n\n'
        'event: response.output_text.delta\ndata: {"delta":"llo"}\n\n'
        'event: response.completed\ndata: {"usage":{"input_tokens":1,"output_tokens":2}}\n\n'
    )

    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text=stream, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        model = provider_model("openai", "gpt-test")
        chunks = [
            chunk
            async for chunk in OpenAIProvider("test", client).stream(
                ResponseRequest(request_id="req_1", messages=[ChatMessage(role="user", content="hi")]), model
            )
        ]
    assert "".join(chunk.delta for chunk in chunks) == "hello"
    assert chunks[-1].done
    assert chunks[-1].usage.total_tokens == 3


@pytest.mark.asyncio
async def test_anthropic_separates_system_message() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert request.headers["x-api-key"] == "test"
        assert body["system"] == "Be concise"
        assert body["messages"] == [{"role": "user", "content": "hi"}]
        return httpx.Response(
            200,
            json={"content": [{"type": "text", "text": "hello"}], "usage": {"input_tokens": 4, "output_tokens": 2}},
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        model = provider_model("anthropic", "claude-test")
        result = await AnthropicProvider("test", client).complete(
            ResponseRequest(
                messages=[ChatMessage(role="system", content="Be concise"), ChatMessage(role="user", content="hi")]
            ),
            model,
        )
    assert result.output == "hello"
    assert result.usage.total_tokens == 6


@pytest.mark.asyncio
async def test_gemini_normalizes_completion() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert "/models/gemini-test:generateContent" in str(request.url)
        assert request.url.params["key"] == "test"
        return httpx.Response(
            200,
            json={
                "candidates": [{"content": {"parts": [{"text": "hello"}]}}],
                "usageMetadata": {"promptTokenCount": 3, "candidatesTokenCount": 2},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        model = provider_model("gemini", "gemini-test")
        result = await GeminiProvider("test", client).complete(
            ResponseRequest(messages=[ChatMessage(role="user", content="hi")]), model
        )
    assert result.output == "hello"
    assert result.usage.total_tokens == 5
