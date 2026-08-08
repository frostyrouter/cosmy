# Project updates

This file is the shared implementation record for the Cosmy router. New feature and change entries must follow the rules in [`agent.md`](../agent.md).

## 2026-08-08 - Update tracking established

- Change: Added the repository rule requiring implementation updates for every feature or change, with a consolidated entry at least every two merged pull requests.
- Impact: Contributors now have one chronological place to understand shipped work, validation, limitations, and follow-up tasks.
- Validation: Documentation-only change; no runtime behavior changed.
- Follow-up: Add the next implementation entry when the next feature or fix is merged.

## 2026-08-08 - Provider runtime and production persistence

- Change: Added provider adapters for OpenAI, Anthropic, and Gemini; retry, timeout, health, fallback, metrics, evaluation, PostgreSQL persistence, startup migrations, and Docker integration.
- Change: Corrected tenant reservation reconciliation, simulator total-token accounting, HTTP cancellation handling, and the production container build.
- Impact: The router can execute through configured external providers or the simulator, fail over safely, reconcile budgets, and run with PostgreSQL-backed reservations.
- Files or subsystems: Provider adapters, execution, routing, HTTP API, persistence, configuration, Docker, CI, evaluation, and tests.
- Validation: 27 automated tests, TypeScript lint, production build, and PostgreSQL-backed Docker Compose smoke test.
- Limitations and follow-up: Health snapshots and registry publication remain in-memory at runtime; production provider credentials and deployment secrets must be supplied through the environment.

## 2026-08-08 - FastAPI runtime and latency optimization

- Change: Added the Python 3.12 FastAPI runtime with equivalent routing, provider execution, fallback, SSE, budget reconciliation, PostgreSQL startup, and in-memory caching boundaries.
- Change: Added direct Pydantic Core JSON validation, one-pass ORJSON serialization, shared provider connection pools, cache-first routing, Uvicorn uvloop/httptools deployment, Python CI, and repeatable latency tooling.
- Impact: The active container and CI runtime now use FastAPI. The comparable cached simulator benchmark improved from 1.223 ms to 1.023 ms average and from 1.479 ms to 1.365 ms p95 on the development host.
- Files or subsystems: `cosmy`, Python tests, Docker, CI, integration smoke, environment configuration, README, and latency documentation.
- Validation: Ruff, 14 Python tests, comparable 500-request HTTP benchmark, and PostgreSQL-backed Docker Compose verification.
- Limitations and follow-up: The TypeScript implementation remains temporarily for parity comparison; remaining evaluation and control-plane tests must be ported before removing it.
