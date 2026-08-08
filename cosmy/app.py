from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import asyncpg
import httpx
import orjson
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from .config import Settings
from .errors import RouterError
from .execution import RequestExecutor, UsageLedger
from .models import ResponseRequest
from .persistence import PostgresUsageLedger, create_postgres_pool
from .providers import Provider, configured_models, configured_providers
from .registry import DEFAULT_MODELS, ModelRegistry
from .routing import DeterministicRouter
from .service import RouterService
from .stores import MemoryHealthStore, MemoryMetrics, MemoryResponseCache, MemoryUsageLedger


@dataclass(slots=True)
class Runtime:
    service: RouterService
    http: httpx.AsyncClient
    postgres: asyncpg.Pool | None = None


def _json_response(content: Any, status_code: int = 200) -> Response:
    return Response(orjson.dumps(content), status_code=status_code, media_type="application/json")


def _error(code: str, message: str, status_code: int) -> Response:
    return _json_response({"error": {"code": code, "message": message}}, status_code)


def create_app(
    settings: Settings | None = None,
    provider_overrides: tuple[Provider, ...] | None = None,
    usage_override: UsageLedger | None = None,
) -> FastAPI:
    config = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        client = httpx.AsyncClient(
            http2=True,
            timeout=httpx.Timeout(config.request_timeout_ms / 1_000),
            limits=httpx.Limits(
                max_connections=config.http_max_connections,
                max_keepalive_connections=config.http_keepalive_connections,
                keepalive_expiry=30,
            ),
        )
        postgres: asyncpg.Pool | None = None
        try:
            registry = ModelRegistry(DEFAULT_MODELS + configured_models())
            providers = provider_overrides or configured_providers(
                client, config.request_timeout_ms / 1_000, config.provider_max_retries
            )
            usage: UsageLedger
            if usage_override is not None:
                usage = usage_override
            elif config.persistence_mode == "postgres":
                if not config.database_url:
                    raise RuntimeError("DATABASE_URL is required when PERSISTENCE_MODE=postgres")
                postgres = await create_postgres_pool(config.database_url)
                usage = PostgresUsageLedger(postgres)
            else:
                usage = MemoryUsageLedger()
            cache = MemoryResponseCache(config.response_cache_max_entries) if config.cache_mode == "memory" else None
            executor = RequestExecutor(providers, usage, MemoryHealthStore(), MemoryMetrics())
            app.state.runtime = Runtime(
                RouterService(DeterministicRouter(registry), executor, cache, config.response_cache_ttl_seconds),
                client,
                postgres,
            )
            yield
        finally:
            if postgres is not None:
                await postgres.close()
            await client.aclose()

    app = FastAPI(
        title="Cosmy Router",
        version="0.2.0",
        lifespan=lifespan,
        docs_url="/docs" if config.environment != "production" else None,
        redoc_url=None,
    )

    @app.exception_handler(RouterError)
    async def router_error_handler(_: Request, error: RouterError) -> Response:
        return _error(error.code, str(error), error.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, error: RequestValidationError) -> Response:
        return _error("invalid_request", str(error), 400)

    @app.get("/healthz")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    async def ready(request: Request) -> Response:
        if getattr(request.app.state, "runtime", None) is None:
            return _json_response({"status": "not_ready"}, 503)
        return _json_response({"status": "ready"})

    @app.post(
        "/v1/responses",
        openapi_extra={
            "requestBody": {
                "required": True,
                "content": {"application/json": {"schema": ResponseRequest.model_json_schema(by_alias=True)}},
            }
        },
    )
    async def responses(request: Request) -> Any:
        try:
            input_ = ResponseRequest.model_validate_json(await request.body())
        except ValidationError as error:
            return _error("invalid_request", str(error), 400)
        service: RouterService = request.app.state.runtime.service
        if not input_.stream:
            result = await service.complete(input_)
            return _json_response(result.model_dump(mode="json", by_alias=True, exclude_none=True))

        async def events() -> AsyncIterator[bytes]:
            try:
                async for chunk in service.stream(input_):
                    if await request.is_disconnected():
                        return
                    event = "done" if chunk.done else "delta"
                    yield (
                        b"event: "
                        + event.encode()
                        + b"\ndata: "
                        + orjson.dumps(chunk.model_dump(mode="json", by_alias=True, exclude_none=True))
                        + b"\n\n"
                    )
            except RouterError as error:
                yield (
                    b"event: error\ndata: "
                    + orjson.dumps({"error": {"code": error.code, "message": str(error)}})
                    + b"\n\n"
                )

        return StreamingResponse(
            events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
        )

    return app


app = create_app()
