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

## 2026-08-09 - Policy enforcement and reliability fixes

- Change: Enforced `maxCostUsd`, `maxLatencyMs`, and `requireCapabilities` as hard eligibility constraints instead of scoring signals; requests now reject candidates that exceed the caller's cost or latency caps. The circuit-breaker open state now marks failures retryable so the executor falls back to the next eligible candidate, and only retryable failures count toward opening the breaker. Streaming attempts now apply their timeout only until the first chunk (time-to-first-token) so long generations are not truncated mid-stream.
- Change: Fixed the OpenAI structured-output request body (required `name` and a non-empty fallback schema) so `json-schema` requests no longer fail with a provider 400; malformed JSON bodies now return HTTP 400 instead of 500; the `npm start` script path now matches the build output; tenant budgets are wired through `TENANT_BUDGET_USD` with a wildcard tenant default.
- Change: Client cancellations no longer mark provider health failures; completed streams record success and reconcile the reservation estimate when the provider omits usage; SSE parsing flushes a trailing unterminated data line; `/readyz` reports unready (503) when PostgreSQL connectivity is lost; error responses include `requestId`, `retryable`, and `no_eligible_model` rejection details; fallback metrics count requests that fell back rather than every attempt.
- Impact: Routing decisions honor caller policy bounds (previously a model 12x over the cost cap could be selected), provider outages fail over to eligible fallbacks instead of failing requests, and streaming responses can exceed `REQUEST_TIMEOUT_MS` after the first token.
- Files or subsystems: Routing policy, execution/resilience, provider adapters, HTTP API, persistence, configuration, metrics, tests.
- Validation: 37 automated tests (10 new regression tests), TypeScript lint, and the latency benchmark.
- Known limitations and follow-up: `TENANT_BUDGET_USD` is enforced in memory mode only; PostgreSQL-backed budget enforcement and per-tenant limit configuration are not yet implemented. Request/attempt counters in metrics still count attempts (asserted by tests); only the fallback counter changed semantics.

## 2026-08-09 - Authentication, request deadlines, and API hardening

- Change: Added optional inbound API-key authentication (`COSMY_API_KEY`); when set, `/v1/responses` requires `Authorization: Bearer <key>` while `/healthz` and `/readyz` stay open for probes.
- Change: Added an overall request deadline for non-streaming execution so total wall time (candidates x retries) is bounded by `REQUEST_TIMEOUT_MS`; streaming keeps its time-to-first-token semantics and is not truncated.
- Change: Exempted health endpoints from the rate limiter (probes previously received 429/400 under load); streaming requests with routing errors now return the proper HTTP status (422 for unknown models) instead of a 200 SSE error event.
- Change: Provider error details are logged server-side and no longer forwarded to clients; response cache keys now include policy and registry versions so cached routes invalidate after registry updates; `metadata` is bounded to 64 keys of 4096 characters.
- Impact: Production deployments can authenticate callers, interactive requests honor their timeout, orchestrators see stable probe responses, and upstream failure details stay internal.
- Files or subsystems: HTTP API, execution, routing, caching, configuration, tests.
- Validation: 44 automated tests (6 new regression tests), TypeScript lint, and manual verification of the deadline (1370ms to 154ms) and auth rejection (401) repro cases.
- Known limitations and follow-up: The deadline applies to non-streaming requests; streaming has no total-duration bound by design. `COSMY_API_KEY` is optional and provides single shared-key auth only; per-tenant credentials and OAuth remain follow-up work.
