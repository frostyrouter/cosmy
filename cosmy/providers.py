from __future__ import annotations

import asyncio
import json
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from os import environ
from typing import Any

import httpx

from .errors import ProviderError
from .models import (
    ModelConfiguration,
    ModelCoordinates,
    ModelHealth,
    ModelPricing,
    ResponseChunk,
    ResponseRequest,
    Usage,
)


@dataclass(frozen=True, slots=True)
class ProviderResponse:
    output: str
    usage: Usage
    finish_reason: str = "stop"


class Provider(ABC):
    name: str

    @abstractmethod
    async def complete(self, request: ResponseRequest, model: ModelConfiguration) -> ProviderResponse: ...

    @abstractmethod
    def stream(self, request: ResponseRequest, model: ModelConfiguration) -> AsyncIterator[ResponseChunk]: ...


def _token_count(value: str) -> int:
    return max(1, (len(value) + 3) // 4)


def _usage(input_tokens: int, output_tokens: int, model: ModelConfiguration) -> Usage:
    return Usage.model_construct(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        estimated_cost_usd=(
            input_tokens * model.pricing.input_per_million_usd + output_tokens * model.pricing.output_per_million_usd
        )
        / 1_000_000,
    )


class SimulatorProvider(Provider):
    name = "simulator"

    @staticmethod
    def _output(request: ResponseRequest) -> str:
        prompt = request.messages[-1].content
        if "rewrite" in prompt.lower():
            return f"Rewritten: {prompt.replace('rewrite:', '').replace('Rewrite:', '').strip()}"
        if "json" in prompt.lower():
            return '{"answer":"simulated response","source":"simulator"}'
        return f"Simulated response for: {prompt}"

    async def complete(self, request: ResponseRequest, model: ModelConfiguration) -> ProviderResponse:
        output = self._output(request)
        input_tokens = sum(_token_count(message.content) for message in request.messages)
        return ProviderResponse(output=output, usage=_usage(input_tokens, _token_count(output), model))

    async def stream(self, request: ResponseRequest, model: ModelConfiguration) -> AsyncIterator[ResponseChunk]:
        output = self._output(request)
        request_id = request.request_id or "unknown"
        pieces = output.split(" ")
        for index, piece in enumerate(pieces):
            yield ResponseChunk(
                request_id=request_id, index=index, delta=piece + (" " if index < len(pieces) - 1 else ""), done=False
            )
        input_tokens = sum(_token_count(message.content) for message in request.messages)
        yield ResponseChunk(
            request_id=request_id,
            index=len(pieces),
            delta="",
            done=True,
            usage=_usage(input_tokens, _token_count(output), model),
        )


class HttpProvider(Provider):
    def __init__(self, api_key: str, client: httpx.AsyncClient, base_url: str) -> None:
        self.api_key = api_key
        self.client = client
        self.base_url = base_url.rstrip("/")

    async def _post(self, path: str, body: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        try:
            response = await self.client.post(f"{self.base_url}{path}", json=body, headers=headers)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            raise ProviderError(
                f"{self.name} returned HTTP {status}", status in {408, 409, 429} or status >= 500
            ) from error
        except (httpx.HTTPError, ValueError) as error:
            raise ProviderError(f"{self.name} request failed: {error}") from error

    async def _sse(
        self, path: str, body: dict[str, Any], headers: dict[str, str]
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        try:
            async with self.client.stream("POST", f"{self.base_url}{path}", json=body, headers=headers) as response:
                response.raise_for_status()
                event = "message"
                async for line in response.aiter_lines():
                    if line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        raw = line[5:].strip()
                        if raw == "[DONE]":
                            return
                        try:
                            yield event, json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                    elif not line:
                        event = "message"
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            raise ProviderError(
                f"{self.name} returned HTTP {status}", status in {408, 409, 429} or status >= 500
            ) from error
        except httpx.HTTPError as error:
            raise ProviderError(f"{self.name} stream failed: {error}") from error


def _messages(request: ResponseRequest) -> list[dict[str, Any]]:
    return [message.model_dump(by_alias=True, exclude_none=True) for message in request.messages]


class OpenAIProvider(HttpProvider):
    name = "openai"

    def __init__(self, api_key: str, client: httpx.AsyncClient, base_url: str = "https://api.openai.com/v1") -> None:
        super().__init__(api_key, client, base_url)

    def _body(self, request: ResponseRequest, model: ModelConfiguration, stream: bool) -> dict[str, Any]:
        body: dict[str, Any] = {"model": model.model, "input": _messages(request), "stream": stream}
        if request.temperature is not None:
            body["temperature"] = request.temperature
        if request.max_output_tokens is not None:
            body["max_output_tokens"] = request.max_output_tokens
        if request.tools:
            body["tools"] = [
                {
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
                for tool in request.tools
            ]
        return body

    def _usage(self, value: Mapping[str, Any], model: ModelConfiguration) -> Usage:
        raw = value.get("usage") or {}
        return _usage(
            int(raw.get("input_tokens", raw.get("prompt_tokens", 0))),
            int(raw.get("output_tokens", raw.get("completion_tokens", 0))),
            model,
        )

    async def complete(self, request: ResponseRequest, model: ModelConfiguration) -> ProviderResponse:
        value = await self._post(
            "/responses", self._body(request, model, False), {"authorization": f"Bearer {self.api_key}"}
        )
        output = value.get("output_text") or "".join(
            part.get("text", "") for item in value.get("output", []) for part in item.get("content", [])
        )
        return ProviderResponse(
            output=output,
            usage=self._usage(value, model),
            finish_reason="length" if value.get("status") == "incomplete" else "stop",
        )

    async def stream(self, request: ResponseRequest, model: ModelConfiguration) -> AsyncIterator[ResponseChunk]:
        index = 0
        request_id = request.request_id or "unknown"
        usage: Usage | None = None
        async for event, value in self._sse(
            "/responses", self._body(request, model, True), {"authorization": f"Bearer {self.api_key}"}
        ):
            delta = value.get("delta") or value.get("text") or ""
            if value.get("usage"):
                usage = self._usage(value, model)
            if delta:
                yield ResponseChunk(request_id=request_id, index=index, delta=str(delta), done=False)
                index += 1
            if event in {"response.completed", "response.done"}:
                yield ResponseChunk(
                    request_id=request_id, index=index, delta="", done=True, usage=usage or self._usage(value, model)
                )
                return
        yield ResponseChunk(request_id=request_id, index=index, delta="", done=True, usage=usage)


class AnthropicProvider(HttpProvider):
    name = "anthropic"

    def __init__(self, api_key: str, client: httpx.AsyncClient, base_url: str = "https://api.anthropic.com/v1") -> None:
        super().__init__(api_key, client, base_url)

    def _body(self, request: ResponseRequest, model: ModelConfiguration, stream: bool) -> dict[str, Any]:
        system = "\n".join(message.content for message in request.messages if message.role == "system")
        messages = [
            {"role": "assistant" if message.role == "assistant" else "user", "content": message.content}
            for message in request.messages
            if message.role != "system"
        ]
        body: dict[str, Any] = {
            "model": model.model,
            "max_tokens": request.max_output_tokens or model.max_output_tokens,
            "messages": messages,
            "stream": stream,
        }
        if system:
            body["system"] = system
        if request.temperature is not None:
            body["temperature"] = request.temperature
        return body

    @property
    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}

    def _usage(self, value: Mapping[str, Any], model: ModelConfiguration) -> Usage:
        raw = value.get("usage") or value.get("message", {}).get("usage", {})
        return _usage(int(raw.get("input_tokens", 0)), int(raw.get("output_tokens", 0)), model)

    async def complete(self, request: ResponseRequest, model: ModelConfiguration) -> ProviderResponse:
        value = await self._post("/messages", self._body(request, model, False), self._headers)
        output = "".join(item.get("text", "") for item in value.get("content", []) if item.get("type") == "text")
        return ProviderResponse(
            output=output,
            usage=self._usage(value, model),
            finish_reason="length" if value.get("stop_reason") == "max_tokens" else "stop",
        )

    async def stream(self, request: ResponseRequest, model: ModelConfiguration) -> AsyncIterator[ResponseChunk]:
        index = 0
        request_id = request.request_id or "unknown"
        usage: Usage | None = None
        async for event, value in self._sse("/messages", self._body(request, model, True), self._headers):
            delta = value.get("delta", {}).get("text", "")
            if delta:
                yield ResponseChunk(request_id=request_id, index=index, delta=delta, done=False)
                index += 1
            if event == "message_stop":
                usage = self._usage(value, model)
                yield ResponseChunk(request_id=request_id, index=index, delta="", done=True, usage=usage)
                return
        yield ResponseChunk(request_id=request_id, index=index, delta="", done=True, usage=usage)


class GeminiProvider(HttpProvider):
    name = "gemini"

    def __init__(
        self,
        api_key: str,
        client: httpx.AsyncClient,
        base_url: str = "https://generativelanguage.googleapis.com/v1beta",
    ) -> None:
        super().__init__(api_key, client, base_url)

    def _body(self, request: ResponseRequest) -> dict[str, Any]:
        contents = [
            {"role": "model" if message.role == "assistant" else "user", "parts": [{"text": message.content}]}
            for message in request.messages
            if message.role != "system"
        ]
        body: dict[str, Any] = {"contents": contents}
        generation: dict[str, Any] = {}
        if request.temperature is not None:
            generation["temperature"] = request.temperature
        if request.max_output_tokens is not None:
            generation["maxOutputTokens"] = request.max_output_tokens
        if generation:
            body["generationConfig"] = generation
        return body

    def _usage(self, value: Mapping[str, Any], model: ModelConfiguration) -> Usage:
        raw = value.get("usageMetadata", {})
        return _usage(int(raw.get("promptTokenCount", 0)), int(raw.get("candidatesTokenCount", 0)), model)

    @staticmethod
    def _output(value: Mapping[str, Any]) -> str:
        return "".join(
            part.get("text", "")
            for candidate in value.get("candidates", [])
            for part in candidate.get("content", {}).get("parts", [])
        )

    async def complete(self, request: ResponseRequest, model: ModelConfiguration) -> ProviderResponse:
        value = await self._post(f"/models/{model.model}:generateContent?key={self.api_key}", self._body(request), {})
        return ProviderResponse(output=self._output(value), usage=self._usage(value, model))

    async def stream(self, request: ResponseRequest, model: ModelConfiguration) -> AsyncIterator[ResponseChunk]:
        index = 0
        request_id = request.request_id or "unknown"
        usage: Usage | None = None
        path = f"/models/{model.model}:streamGenerateContent?alt=sse&key={self.api_key}"
        async for _, value in self._sse(path, self._body(request), {}):
            delta = self._output(value)
            if value.get("usageMetadata"):
                usage = self._usage(value, model)
            if delta:
                yield ResponseChunk(request_id=request_id, index=index, delta=delta, done=False)
                index += 1
        yield ResponseChunk(request_id=request_id, index=index, delta="", done=True, usage=usage)


class ResilientProvider(Provider):
    def __init__(self, provider: Provider, timeout_seconds: float, max_retries: int) -> None:
        self.provider = provider
        self.name = provider.name
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries

    async def complete(self, request: ResponseRequest, model: ModelConfiguration) -> ProviderResponse:
        for attempt in range(self.max_retries + 1):
            try:
                async with asyncio.timeout(self.timeout_seconds):
                    return await self.provider.complete(request, model)
            except TimeoutError as error:
                current = ProviderError(f"{self.name} timed out")
                if attempt == self.max_retries:
                    raise current from error
            except ProviderError as error:
                if not error.retryable or attempt == self.max_retries:
                    raise
            await asyncio.sleep(min(0.25, 0.025 * 2**attempt))
        raise ProviderError(f"{self.name} failed")

    async def stream(self, request: ResponseRequest, model: ModelConfiguration) -> AsyncIterator[ResponseChunk]:
        async with asyncio.timeout(self.timeout_seconds):
            async for chunk in self.provider.stream(request, model):
                yield chunk


def _number(env: Mapping[str, str], key: str, fallback: float) -> float:
    try:
        return float(env.get(key, fallback))
    except (TypeError, ValueError):
        return fallback


def configured_models(env: Mapping[str, str] = environ) -> tuple[ModelConfiguration, ...]:
    models: list[ModelConfiguration] = []
    for provider in ("openai", "anthropic", "gemini"):
        prefix = provider.upper()
        model = env.get(f"{prefix}_MODEL")
        if not model or not env.get(f"{prefix}_API_KEY"):
            continue
        models.append(
            ModelConfiguration(
                id=f"{provider}:{model}",
                provider=provider,
                model=model,
                version=env.get(f"{prefix}_MODEL_VERSION", "configured"),
                enabled=True,
                capabilities=("streaming", "tools", "structured-output", "reasoning"),
                modalities=("text",),
                coordinates=ModelCoordinates(
                    technicality=_number(env, f"{prefix}_TECHNICALITY", 0.7),
                    creativity=_number(env, f"{prefix}_CREATIVITY", 0.65),
                    quality=_number(env, f"{prefix}_QUALITY", 0.8),
                    reasoning=_number(env, f"{prefix}_REASONING", 0.75),
                ),
                pricing=ModelPricing(
                    input_per_million_usd=_number(env, f"{prefix}_INPUT_PRICE_PER_MTOK", 1),
                    output_per_million_usd=_number(env, f"{prefix}_OUTPUT_PRICE_PER_MTOK", 3),
                ),
                context_window=int(_number(env, f"{prefix}_CONTEXT_WINDOW", 128_000)),
                max_output_tokens=int(_number(env, f"{prefix}_MAX_OUTPUT_TOKENS", 8_000)),
                regions=tuple(
                    value.strip() for value in env.get(f"{prefix}_REGIONS", "global").split(",") if value.strip()
                ),
                allowed_data_classes=("public", "internal", "confidential"),
                health=ModelHealth(availability=0.99, latency_p95_ms=1_500, error_rate=0.01, checked_at="startup"),
            )
        )
    return tuple(models)


def configured_providers(
    client: httpx.AsyncClient, timeout_seconds: float, max_retries: int, env: Mapping[str, str] = environ
) -> tuple[Provider, ...]:
    providers: list[Provider] = [SimulatorProvider()]
    if key := env.get("OPENAI_API_KEY"):
        providers.append(OpenAIProvider(key, client, env.get("OPENAI_BASE_URL", "https://api.openai.com/v1")))
    if key := env.get("ANTHROPIC_API_KEY"):
        providers.append(AnthropicProvider(key, client, env.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1")))
    if key := env.get("GEMINI_API_KEY"):
        providers.append(
            GeminiProvider(key, client, env.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"))
        )
    return tuple(ResilientProvider(provider, timeout_seconds, max_retries) for provider in providers)
