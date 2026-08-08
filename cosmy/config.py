from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from os import environ


def _integer(env: Mapping[str, str], key: str, fallback: int) -> int:
    try:
        return int(env.get(key, fallback))
    except (TypeError, ValueError):
        return fallback


@dataclass(frozen=True, slots=True)
class Settings:
    host: str = "0.0.0.0"
    port: int = 8080
    environment: str = "development"
    log_level: str = "info"
    request_timeout_ms: int = 60_000
    provider_max_retries: int = 2
    persistence_mode: str = "memory"
    database_url: str | None = None
    http_max_connections: int = 500
    http_keepalive_connections: int = 100
    cache_mode: str = "off"
    response_cache_ttl_seconds: int = 60
    response_cache_max_entries: int = 1_000

    @classmethod
    def from_env(cls, env: Mapping[str, str] = environ) -> Settings:
        environment = env.get("ROUTER_ENV", "development")
        if environment not in {"development", "test", "production"}:
            raise ValueError(f"Unsupported ROUTER_ENV: {environment}")
        persistence = "postgres" if env.get("PERSISTENCE_MODE") == "postgres" else "memory"
        return cls(
            host=env.get("HOST", "0.0.0.0"),
            port=_integer(env, "PORT", 8080),
            environment=environment,
            log_level=env.get("LOG_LEVEL", "info"),
            request_timeout_ms=_integer(env, "REQUEST_TIMEOUT_MS", 60_000),
            provider_max_retries=_integer(env, "PROVIDER_MAX_RETRIES", 2),
            persistence_mode=persistence,
            database_url=env.get("DATABASE_URL"),
            http_max_connections=_integer(env, "HTTP_MAX_CONNECTIONS", 500),
            http_keepalive_connections=_integer(env, "HTTP_KEEPALIVE_CONNECTIONS", 100),
            cache_mode="memory" if env.get("CACHE_MODE") == "memory" else "off",
            response_cache_ttl_seconds=_integer(env, "RESPONSE_CACHE_TTL_SECONDS", 60),
            response_cache_max_entries=_integer(env, "RESPONSE_CACHE_MAX_ENTRIES", 1_000),
        )
