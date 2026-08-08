# Cosmy Model Router

Cosmy is a low-latency, provider-neutral AI model router. Applications send one normalized request; Cosmy selects an eligible provider and model using explicit quality, cost, latency, capability, region, and data-handling policies.

The active runtime uses Python 3.12 and FastAPI. It includes simulator, OpenAI, Anthropic, and Gemini adapters, provider fallback, SSE streaming, tenant budget reconciliation, PostgreSQL reservations, and a bounded in-memory response cache.

## Local development

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m uvicorn cosmy.app:app --host 127.0.0.1 --port 8080
```

Run verification with:

```powershell
.\.venv\Scripts\python.exe -m ruff check cosmy tests scripts
.\.venv\Scripts\python.exe -m ruff format --check cosmy tests scripts
.\.venv\Scripts\python.exe -m pytest -q
```

Production-like PostgreSQL integration runs through `docker-compose.integration.yml`.

## API

- `POST /v1/responses` - normalized completion or SSE stream
- `GET /healthz` - process health
- `GET /readyz` - runtime readiness
- `GET /docs` - interactive API documentation outside production

See [Docs/README.md](Docs/README.md) for architecture and operating guidance.
