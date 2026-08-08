from __future__ import annotations

from collections.abc import AsyncIterator
from hashlib import blake2b
from uuid import uuid4

import orjson

from .execution import RequestExecutor
from .models import ResponseChunk, ResponseRequest, ResponseResult
from .routing import DeterministicRouter
from .stores import MemoryResponseCache


def _cache_key(request: ResponseRequest) -> str:
    value = request.model_dump(mode="json", by_alias=True, exclude={"request_id"}, exclude_none=True)
    value["stream"] = False
    return blake2b(orjson.dumps(value, option=orjson.OPT_SORT_KEYS), digest_size=16).hexdigest()


def _cacheable(request: ResponseRequest) -> bool:
    data_class = request.policy.data_class if request.policy and request.policy.data_class else "internal"
    return (
        not request.tools
        and (request.temperature is None or request.temperature == 0)
        and data_class in {"public", "internal"}
    )


class RouterService:
    __slots__ = ("cache", "cache_ttl_seconds", "executor", "router")

    def __init__(
        self,
        router: DeterministicRouter,
        executor: RequestExecutor,
        cache: MemoryResponseCache | None = None,
        cache_ttl_seconds: int = 0,
    ) -> None:
        self.router = router
        self.executor = executor
        self.cache = cache
        self.cache_ttl_seconds = cache_ttl_seconds

    async def complete(self, request: ResponseRequest) -> ResponseResult:
        request_id = request.request_id or f"req_{uuid4()}"
        if self.cache is None or self.cache_ttl_seconds <= 0 or not _cacheable(request):
            route = self.router.decide(request_id, request)
            return await self.executor.execute(request_id, route, request)
        key = f"{self.router.policy.version}:{_cache_key(request)}"
        if cached := self.cache.get(key):
            return cached.model_copy(
                update={"request_id": request_id, "route": cached.route.model_copy(update={"request_id": request_id})}
            )
        route = self.router.decide(request_id, request)
        result = await self.executor.execute(request_id, route, request)
        self.cache.set(key, result, self.cache_ttl_seconds)
        return result

    async def stream(self, request: ResponseRequest) -> AsyncIterator[ResponseChunk]:
        request_id = request.request_id or f"req_{uuid4()}"
        route = self.router.decide(request_id, request)
        async for chunk in self.executor.stream(request_id, route, request):
            yield chunk
