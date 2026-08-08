# FastAPI runtime and latency

## Runtime decision

FastAPI is the active HTTP runtime. The request boundary validates JSON directly with Pydantic Core, routing and provider execution remain asynchronous, and successful responses are serialized once with `orjson`.

Latency-focused choices include:

- Direct `model_validate_json` request validation to avoid a separate JSON decode pass
- Shared `httpx.AsyncClient` connection pools for provider keep-alive and HTTP/2
- Trusted internal routing objects skip redundant validation after the API boundary
- Cache lookup occurs before routing and provider budget reservation
- Bounded in-memory caching is optional; no external cache is required
- Linux containers use uvloop and httptools through Uvicorn
- Access logs are disabled in the production container hot path

## Reproducible baseline

Both runtimes were measured on the same Windows host with the same Node `fetch` client, 50 warm-up requests, 500 sequential requests, and the simulator provider. Results vary by machine and must be tracked as relative evidence rather than universal SLOs.

| Runtime | Cache | Average | p50 | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| Fastify | memory | 1.223 ms | 1.162 ms | 1.479 ms | 3.463 ms |
| FastAPI optimized | memory | 1.023 ms | 0.965 ms | 1.365 ms | 2.279 ms |

The optimized FastAPI path reduced average latency by about 16% and p95 by about 8% in this test. Provider network latency will dominate real requests, so connection reuse, cancellation, and fallback behavior remain more important than framework-only microbenchmarks.

Use `scripts/benchmark_fastapi.py` against a running router for repeatable measurements. Production acceptance should add concurrent load, streaming time-to-first-token, provider-mocked delay distributions, and PostgreSQL contention.
