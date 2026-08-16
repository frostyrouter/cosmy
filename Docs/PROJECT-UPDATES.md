# Project updates

## 2026-08-17 - Provider bulkheads and bounded circuit recovery (commit pending)

- Change: Added a zero-queue concurrency bulkhead around every provider and limited half-open circuit recovery to one probe, preventing slow/outage traffic from creating unbounded in-process work or a recovery stampede.
- Runtime impact: Each provider receives an independent positive `PROVIDER_MAX_CONCURRENCY` cap (default 100). Saturated calls fail immediately with retryable `provider_saturated`, increment the same-named operational metric, and remain eligible for an already planned policy-compliant fallback. Permits cover retries and are released on every completion, error, cancellation, and early stream close.
- Files: Provider resilience/error contracts, application/config/environment wiring, metrics, focused concurrency/stream/circuit/config tests, and reliability/operator documentation.
- Validation: 198 tests passed locally (23 PostgreSQL integration tests skipped without a database), including HTTP 503/metric behavior, permit release, early stream termination, and half-open concurrency; TypeScript lint, production build, and diff whitespace validation passed. The 20,000-request benchmark completed with zero errors at about 643 requests/second and 126.933 ms p95 on this development host; deployment load testing remains the sizing authority. Both verification jobs and the real Compose/PostgreSQL smoke job passed on draft PR #14 at commit `e156943`.
- Boundary: Limits are per process rather than distributed; deployment-wide capacity is replicas multiplied by the provider cap. Priority/fairness queues and automatic cap tuning remain outside this milestone.

## 2026-08-17 - Cached OIDC workload identity (commit pending)

- Change: Added signed JWT workload authentication behind the existing bearer-token API, composing it with bootstrap and durable API keys while mapping verified issuer subjects, tenants, and prefixed scopes into the existing principal contract.
- Security/reliability: Verification pins the issuer, audience, asymmetric algorithms, required lifetime claims, optional token type, and a trusted HTTPS JWKS endpoint. Startup fails if keys cannot be bootstrapped; refresh is single-flight and preserves known-good keys only for a configured bounded stale window before failing closed. Unknown key IDs fail immediately and start a background refresh.
- Latency/operations: Known-key requests verify against an in-memory JWKS without an identity-provider or database round trip. Added configuration, `oidc_jwks_refresh_failure`, a rotation/outage runbook, and `npm run bench:oidc`. Identity operators must overlap signing keys and should issue short-lived access tokens.
- Files: Authentication contracts and HTTP callers, cached OIDC verifier, application/config wiring, metrics, environment example, unit/HTTP/config regressions, benchmark, and security/API/operator documentation.
- Validation: 194 tests passed locally (23 PostgreSQL integration tests skipped without a database); TypeScript lint, production build, dependency-tree validation, diff whitespace validation, and a production dependency audit with zero known vulnerabilities passed. The isolated 10,000-verification benchmark completed with zero failures, one JWKS fetch, about 29,806 verifications/second, and 3.254 ms p95. The existing 20,000-request benchmark completed with zero errors at about 630 requests/second and 127.638 ms p95 on this development host; deployment load testing remains the release authority.
- Boundary: Cosmy accepts signed JWT bearer tokens only; authorization-code flows, token issuance/refresh, opaque-token introspection, per-token revocation, DPoP/mTLS binding, and dynamic issuer discovery remain outside this milestone.

## 2026-08-16 - Durable tenant policy bundles (commit pending)

- Change: Added versioned PostgreSQL/in-memory tenant policies with admin read/replace endpoints, provider/model allow/deny controls, region/data-class boundaries, cost/latency/quality limits, and fallback control.
- Invariant: Requests may only tighten operator policy—allowlists intersect, denylists union, maxima choose the lower value, quality chooses the higher value, and either side may disable fallback. Model discovery and explicit model routing use the same visibility rules.
- Consistency: Local updates refresh immediately; peers poll at `POLICY_REFRESH_SECONDS` (default 2) with stale-refresh generation protection. Failures preserve the last-known-good snapshot and increment `policy_refresh_failure`.
- Latency/evidence: The response path uses an in-memory tenant lookup and bounded set operations with no policy database read. Decisions include the tenant policy version for replay and audit correlation.
- Persistence/security: Tenant-specific advisory locks and required `If-Match` prevent lost updates; `policy.set` audit commits in the same transaction. Migration 015 constrains stored values.
- Validation: 185 tests passed locally (23 PostgreSQL integration tests skipped without a database), including resolution/non-relaxation, fail-closed class/region, model discovery, HTTP enforcement/version/reason/audit, config, and migration coverage; TypeScript lint, production build, and diff whitespace validation passed. A 20,000-request benchmark completed with zero errors at about 632 requests/second and 125.1 ms p95 on this development host; deployment load testing remains the release authority. Real-PostgreSQL concurrency and cross-instance convergence coverage is included for Compose CI.

## 2026-08-16 - Emergency model disable (commit pending)

- Change: Added `POST /v1/admin/models/disable` as a targeted incident kill switch that creates a new registry snapshot while changing only the selected model's `enabled` lifecycle flag.
- Safety: The operation requires current-version `If-Match`, serializes with publication and rollback, rejects missing models and stale commands, treats an already-disabled current model as an idempotent no-op, and cannot disable the last enabled model.
- Audit: PostgreSQL commits `models.disable` with model identity, provider, previous version, and operator reason in the same transaction as the copied manifests. Migration 014 extends the constrained action set.
- Runtime/latency: The local router activates the committed snapshot immediately and peers use existing polling. There is no added database call or computation on response routing.
- Validation: 181 tests passed locally (22 PostgreSQL integration tests skipped without a database), including HTTP routing exclusion and stale/idempotent/last-model behavior; TypeScript lint, production build, and diff whitespace validation passed. Real-PostgreSQL concurrent-disable and last-model coverage is included for Compose CI.

## 2026-08-16 - Atomic model-registry rollback (commit pending)

- Change: Added `POST /v1/admin/models/rollback` to restore a prior durable registry snapshot as a new monotonic version, with immediate local activation and normal cross-instance registry convergence.
- Safety: Rollback requires `If-Match` with the current version, rejects current/future/missing targets and unavailable enabled providers, and serializes against publication so duplicate or stale incident commands cannot overwrite newer state.
- Audit: PostgreSQL copies target manifests and commits `models.rollback` with target/previous version, operator reason, and model count in the same transaction. Migration 013 extends the constrained audit action set.
- Latency: This is an administrative-only database workflow and adds no work to request routing, provider execution, or authentication.
- Validation: 180 tests passed locally (21 PostgreSQL integration tests skipped without a database), including HTTP precondition/stale-retry/history restoration; TypeScript lint, production build, and diff whitespace validation passed. Real-PostgreSQL concurrent rollback and atomic-audit coverage is included for Compose CI.

## 2026-08-16 - Stable administrative audit pagination (commit pending)

- Change: `GET /v1/admin/audit` now returns a nullable opaque `nextCursor` and accepts that cursor to traverse the complete administrative history beyond the former newest-500 ceiling.
- Correctness: Memory and PostgreSQL stores use the same descending `(occurredAt, id)` keyset order, avoiding offset drift when new mutations arrive between pages. Cursors are versioned, canonical base64url payloads with strict size, UUID, timestamp, and shape validation.
- Latency: Pagination is isolated to the administrative control plane and uses the existing PostgreSQL audit index/order; it adds no work to message routing or request authentication.
- Validation: 179 tests passed locally (20 PostgreSQL integration tests skipped without a database), including cursor round-trip/rejection and HTTP multi-page/no-duplicate behavior; TypeScript lint, production build, and diff whitespace validation passed. Real-PostgreSQL gap-free traversal coverage is included for Compose CI.

## 2026-08-16 - Durable credential lifecycle (commit pending)

- Change: Added audited PostgreSQL credential creation/listing/revocation, an atomically reloadable in-memory authenticator, immediate local refresh, and bounded cross-instance polling without a database lookup on request authentication.
- Security: The API accepts and stores only SHA-256 digests, redacts digests from admin responses, validates scopes/identifiers in both API and SQL, and serializes admin revocation so concurrent requests cannot disable every durable `admin:write` key.
- Reliability: Exact create and disable retries are idempotent; refresh failures preserve the prior known-good snapshot and increment `credential_refresh_failure`, while refresh generations prevent a slow stale query from overwriting a newer snapshot. Static bootstrap keys remain configuration-owned and require a final restart to remove.
- Operations: Apply migration 012, set `CREDENTIAL_REFRESH_SECONDS` (default 2), create two durable admins before removing bootstrap configuration, and generate/distribute high-entropy plaintext keys outside Cosmy.
- Validation: 176 tests passed locally (19 PostgreSQL integration tests skipped without a database), including reload/rotation/revocation/admin redaction/config/migration coverage; TypeScript lint, production build, and diff whitespace validation passed. Real PostgreSQL concurrency, idempotency, and cross-instance revocation tests are included for Compose CI.
- Remaining boundary: Cross-instance revocation is polling-bounded rather than push-immediate; OAuth/workload identity remains future work.
- CI correction: The first Compose run showed that migration 012 created credential audit events without extending PostgreSQL's existing audit-action constraint. Migration 012 now replaces the constraint with the complete action set, and migration coverage asserts both credential actions are present.

## 2026-08-12 - Complete routing decision evidence (commit pending)

- Change: Added route-less durable records for semantic/routing rejections and ordered, privacy-safe candidate attempt history for completion, failure, cancellation, validation fallback, and streaming fallback.
- Reliability: Provider streams that end without a terminal event now fail and may fall back before visible output instead of being falsely recorded as completed.
- Privacy/latency: Attempts retain normalized model/provider/status/latency/error/usage data but no prompts, outputs, raw provider errors, credentials, or provider request IDs. They reuse the terminal decision update rather than adding a database write per fallback.
- Operations: Apply migration 011. Malformed transport/schema requests and authentication/rate-limit failures remain pre-routing admission telemetry, not routing decisions. Candidate history aggregates provider-internal retries.
- Validation: 174 tests passed locally (17 PostgreSQL tests skipped without a database), plus TypeScript lint, production build, diff whitespace validation, and a 20,000-request benchmark with zero errors. The benchmark produced about 624 requests/second and 126.5 ms p95 on this development host; repeated samples showed substantial host contention, so deployment load testing—not this laptop result—remains the latency release gate. Real-PostgreSQL rejection/attempt coverage is included for CI.
- Limitation: A process crash after provider work but before the terminal decision update leaves the planned route but cannot reconstruct in-memory attempt history; per-attempt synchronous writes were intentionally avoided on the latency-sensitive path.
- CI correction: The PostgreSQL behavior and migration passed, but the first Compose run exposed a test matcher that expected an omitted optional `route` property to exist as `undefined`. The assertion now verifies absence separately, matching the serialized API contract.

## 2026-08-12 - Shared PostgreSQL provider health (commit pending)

- Change: Added an atomic provider-health aggregate, asynchronous event persistence on a dedicated bounded pool, and periodic cross-instance snapshot refresh while preserving immediate local routing feedback.
- Impact: Horizontally scaled PostgreSQL deployments now learn provider failures and recovery from one another without adding a database round trip to the provider response path.
- Operations: Apply migration 010, keep `HEALTH_REFRESH_SECONDS` above zero for multiple instances, alert on `health_store_failure`, and define retention for append-only health events.
- Validation: 170 tests passed (16 PostgreSQL tests skipped without a local database), including a stale-refresh race regression; TypeScript lint, production build, diff validation, and a 20,000-request benchmark passed with zero errors (about 695 requests/second and 112.6 ms p95 on the development machine). A real-PostgreSQL cross-instance test is included for CI.
- Limitations and follow-up: Convergence is eventually consistent (default polling window two seconds), failed asynchronous events are not replayed automatically, and production load/fault testing remains required.

This file is the shared implementation record for the Cosmy router. New feature and change entries must follow the rules in [`agent.md`](../agent.md).

## 2026-08-12 - End-to-end routing and first-event deadlines (commit pending)

- Change: Moved the overall request deadline to service admission so it includes semantic classification, routing, planned-decision persistence, provider fallback/retries, and completion or streaming time to first canonical event.
- Semantics: Non-streaming and pre-output streaming deadline expiry return retryable HTTP 504 `timeout`; caller cancellation stays distinct. Streaming releases the timer after its first visible text/tool event so long valid streams are not truncated.
- Audit: A timed-out request with a planned route persists terminal `errorCode: timeout` instead of being misclassified as a client cancellation. Pre-route classifier timeouts now persist route-less rejected decisions.
- Files: Service deadline composition, application wiring, classifier/HTTP/audit regressions, and runtime documentation.
- Validation: 168 tests passed (15 PostgreSQL integration tests skipped without a database), plus TypeScript lint, production build, and diff whitespace validation.
- Boundary: Store operations without cancellation rely on their own bounded query timeouts; the overall timer cannot forcibly interrupt an arbitrary non-cooperative promise.

## 2026-08-12 - Stateless tool-result continuation (commit pending)

- Change: Extended canonical messages with assistant tool-call history and matched tool-result messages, then translated full stateless continuation histories for OpenAI, Anthropic, and Gemini while preserving call IDs and explicit tool errors.
- Safety: Requests fail before routing/provider work on undeclared tools, duplicate or unknown call IDs, name mismatches, incomplete parallel results, invalid ordering, or role-incompatible fields. Tool results stay in native result containers and are excluded from semantic classifier input and shadow execution.
- Accuracy: Tool-call arguments and result content count toward context/cost estimation even though untrusted tool output cannot steer semantic classification.
- Files: Request/domain schema, conversation validator, service admission, provider request adapters, feature extraction, provider/HTTP regressions, and client workflow documentation.
- Validation: 166 tests passed (15 PostgreSQL integration tests skipped without a database), plus TypeScript lint, production build, and diff whitespace validation.
- Boundary: Execution remains client-owned. Cosmy does not authorize or run tools, and provider-private thought signatures/hosted-tool state are not portable in this stateless subset.

## 2026-08-12 - Provider-neutral tool calls and typed streams (commit pending)

- Change: Normalized OpenAI function calls, Anthropic tool-use blocks, and Gemini function calls into stable `{ id, name, arguments }` response objects with `finishReason: tool_calls`; fragmented and parallel tool-call streams now preserve call identity and output indexes.
- API: Replaced generic `delta`/`done` SSE names with typed response lifecycle, route, text, tool, usage, completion, and failure events carrying one response ID and monotonic sequence numbers. Existing non-streaming text output remains backward-compatible.
- Reliability: Any observed tool event now blocks unsafe streaming fallback just like visible text. Terminal streaming decisions record the provider/model that actually served a fallback instead of the originally planned primary.
- Files: Canonical domain/provider contracts, OpenAI/Anthropic/Gemini/simulator adapters, executor, service/audit persistence, HTTP/SSE encoding, response schema, tests, and protocol documentation.
- Validation: 161 tests passed (15 PostgreSQL integration tests skipped without a database), plus TypeScript lint, production build, and diff whitespace validation.
- Boundary: Cosmy returns client-executed function calls but does not yet run tools or provide a first-class tool-result continuation item. Provider-hosted tools and managed tool loops remain follow-up work.

## 2026-08-12 - Live health admission and structured-output enforcement (commit pending)

- Change: Connected execution health observations back into routing. Three consecutive failures temporarily reject a model with `observed_health_unavailable`; successful probes restore it, and explicit unhealthy model requests fail instead of silently changing models.
- Change: Added deterministic non-streaming JSON-schema verification and validation-driven fallback. Invalid outputs are reconciled at actual cost, do not poison transport health, and can escalate only through pre-ranked eligible alternatives while staying within the request's total `maxCostUsd` ceiling. Unsupported schema keywords fail before provider execution.
- Impact: Repeatedly failing providers stop receiving fresh automatic traffic, and a provider can no longer return malformed or schema-incompatible output as a successful structured response.
- Files: Health store contracts/implementation, router composition and admission, executor/error contracts, structured-output validator, regressions, and operator documentation.
- Validation: 154 tests passed (15 PostgreSQL integration tests skipped without a database), plus TypeScript lint, production build, and diff whitespace validation.
- Boundary: Health remains process-local and uses configured p95 latency as its percentile baseline. Post-generation validation cannot safely replay an already emitted stream; streaming schema enforcement remains provider-native. `$ref`, conditional schemas, formats, and other unsupported JSON Schema vocabulary are rejected rather than partially enforced.

## 2026-08-12 - Durable routing decisions and query APIs

- Change: Added tenant-scoped planned and terminal decision records plus `GET /v1/routing/decisions/:id`, deterministic non-executing `POST /v1/routing/simulate`, and rollout-visible `GET /v1/models` APIs behind the new `routing:read` scope.
- Privacy and reliability: Records contain route features, model metadata, versions, rejection reasons, and content-free outcomes; they exclude prompts, outputs, credentials, request metadata, and provider payloads. PostgreSQL planned writes fail before billable work, while terminal-update failures preserve the provider result and emit `decision_store_failure`.
- Persistence: Migration 009 adds tenant-keyed PostgreSQL decision storage; development mode uses a bounded in-memory implementation.
- Files: Domain and persistence contracts, memory/PostgreSQL stores, router service, public HTTP/auth configuration, migrations, exports, documentation, and tenant/privacy/API regressions.
- Validation: TypeScript lint, unit/HTTP suite, migration coverage, production build, and real PostgreSQL tenant-isolation integration are required before merge.
- Boundary: Request IDs must currently be unique per tenant; pre-route rejections, retention cleanup, pagination/export, and detailed streaming fallback histories remain follow-up work.

## 2026-08-12 - Configuration and rollout contention hardening (PR #12 follow-up)

- Change: Added one validated configuration-resolution boundary so partial programmatic configuration receives the same timeout, retry, persistence, cache, authentication, and classifier defaults as environment-based startup. Explicit test configuration remains isolated from ambient provider credentials.
- Reliability: PostgreSQL canary observations now retry only server-confirmed lock and statement cancellations with bounded jitter. Every retry starts a fresh transaction, so a timed-out statement cannot partially count an outcome or duplicate the automatic-rollback audit event.
- Developer impact: `npm test` is cross-platform and the latency benchmark has a first-class compiled `npm run bench` command; the benchmark now exercises resolved defaults instead of aborting immediately on an undefined provider timeout and does not depend on a TypeScript runtime loader.
- Files: Configuration/application bootstrap, PostgreSQL control-plane adapter, package scripts, unit/HTTP persistence regressions, and rollout operations documentation.
- Validation: TypeScript lint, unit/HTTP suite, production build, benchmark smoke, and PostgreSQL Compose integration are required before the follow-up is considered complete.
- Boundary: Retry protects short transient row contention; persistent database saturation still increments `rollout_observation_failure` and never replaces the already completed provider response. Stage-level production load evidence remains follow-up work.

## 2026-08-10 - Safe shadow evaluation

- Change: Added audited shadow campaigns with stable sampling, bounded asynchronous execution, lifecycle APIs, separate atomic budgets, crash-recoverable reservations, and hash-only observations.
- Privacy: Streams, tools, tool messages, confidential/restricted data, cache hits, and idempotency replays are excluded. Provider requests strip tenant IDs, metadata, routing hints, and model overrides; durable storage contains no prompts or outputs and uses process-keyed HMAC fingerprints.
- Isolation: Four workers and a 1,000-job bound protect memory; shadow SQL uses a dedicated four-connection pool, and every failure remains outside the primary response path.
- Validation: Policy/coordinator/API tests, full build and unit suite, managed migration checks, concurrent PostgreSQL budget admission, lease recovery, and Docker smoke.
- Boundary: Exact match is distribution evidence, not semantic quality. A privacy-approved signed evaluator pipeline remains required before shadow results can prove answer quality.

## 2026-08-10 - Controlled canary rollouts

- Change: Added durable canary state, tenant-stable percentage assignment before ranking, explicit-model enforcement, manual promotion/rollback, and route-versioned cache keys.
- Safety: PostgreSQL records outcomes and performs threshold rollback atomically after a minimum sample gate; cancellations do not count as provider failures, and only the winning transition writes the system audit event.
- Operations: Added rollout read/action APIs, audit events, cross-router polling, and `rollout_auto_rollback` / `rollout_observation_failure` metrics.
- Validation: Deterministic assignment/routing tests, threshold and concurrency tests, API/migration coverage, full build, and real PostgreSQL/Docker validation.
- Boundary: Shadow duplication is intentionally deferred until separate budgets, privacy/redaction, side-effect suppression, asynchronous comparison, and evaluator integrity exist.
- Follow-up: Windowed p95/error gates, quality and cost deltas, shadow evaluation, staged percentage changes, and automatic promotion policy remain.
- Review hardening: Rollout observation waits are capped at 100 ms, preventing a stalled control-plane query from hanging an already completed response or SSE stream; timeout is surfaced as an operational failure metric.
- Review hardening: Observation SQL is isolated in a four-connection bulkhead with server lock/statement and client query deadlines, so timed-out rollout work cannot exhaust the primary persistence pool.

## 2026-08-10 - Evidence-backed model promotion

- Change: Added immutable model-version evidence records, audited submission/read APIs, non-mutating promotion assessment, and active-publication gates for newly enabled IDs or versions.
- Gates: Conformance, pricing, usage accounting, routing pass rate, quality, sample count, exact identity, clock validity, and freshness must all pass. Disabled and unchanged active versions remain backward-compatible.
- Consistency: PostgreSQL re-checks current versions and latest evidence under a registry publication lock in the same transaction that writes the snapshot and audit event.
- Impact: New models join the routing graph through validated metadata and evidence publication; the router does not require retraining.
- Validation: Deterministic gate-reason tests, HTTP workflow tests, managed migration checks, full unit/build validation, and real PostgreSQL evidence/publication tests.
- Follow-up: Signed evaluator evidence, separation of duties, shadow/canary traffic, automatic rollback, and deprecation automation remain lifecycle milestones.
- Review hardening: Enabled model versions are immutable; any same-version manifest change is rejected in both service and transactional PostgreSQL enforcement, closing an evidence-bypass path.

## 2026-08-10 - Bounded operational metrics

- Change: Added an authenticated Prometheus text endpoint with a dedicated `metrics:read` scope, plus an admin diagnostics endpoint containing readiness, persistence, registry, and aggregate runtime state. Signals include provider/model/status attempt counters, token/cost totals, active streams, fallback and latency data, and operational failure counters.
- Safety: Provider/model cardinality is capped at 512 with overflow aggregation. Metrics exclude tenant/request/credential IDs, prompts, outputs, metadata, keys, and arbitrary error text; labels are escaped.
- Diagnostics: Persistent usage reconciliation failures, idempotency-store failures, cache outcomes, registry-refresh failures, and recovered reservation counts now produce explicit counters.
- Reliability fix: Fastify rate-limit errors now preserve HTTP 429 with `rate_limit_exceeded` instead of being normalized incorrectly to HTTP 400; health, metrics, and diagnostics endpoints remain limiter-exempt.
- Validation: Prometheus rendering/cardinality/privacy tests, scope tests, reconciliation diagnostics, full unit/build validation, and Docker HTTP smoke.
- Operations: Issue a separate scraper credential and alert first on reconciliation, idempotency, registry refresh, and recovery events.
- Follow-up: Dashboards, long-term storage, and distributed traces remain deployment integrations; OpenTelemetry is deliberately not a runtime dependency.

## 2026-08-10 - Audited administrative control plane

- Change: Added `admin:read` and `admin:write` scopes plus authenticated APIs for immutable model-snapshot publication, tenant budget reads/writes, and audit-event reads.
- Change: PostgreSQL now commits model or budget mutations with their actor audit event in one transaction. First-time budget creation serializes against reservation admission, and limits below current reserved plus spent usage are rejected.
- Change: PostgreSQL-backed routers bootstrap from the durable registry and poll for newer committed versions; publication validates provider availability and routing-safe manifest bounds before activation.
- Impact: Operators can change the routing catalog and tenant limits without editing process configuration or creating unaudited state, while multiple instances converge on one monotonic registry.
- Validation: Scope/validation HTTP tests, migration checks, full unit/build validation, and real PostgreSQL transaction/race tests.
- Operations: Apply migration 005, issue separate least-privilege admin credentials, and review `REGISTRY_REFRESH_SECONDS` before multi-instance rollout.
- Follow-up: Credential lifecycle, policy bundles, paginated audit export, and one-click rollback remain future control-plane work.
- Review hardening: Memory mode now enforces the same `budget_below_usage` invariant as PostgreSQL, with store-level and HTTP regressions.

## 2026-08-09 - Tenant-safe retries and cache boundaries

- Change: Added tenant-scoped idempotency claims for non-streaming responses, with bounded memory storage and durable PostgreSQL replay through migration 003. Duplicate in-flight work is blocked, changed requests cannot reuse a key, and a result-storage outage keeps the claim instead of risking duplicate execution and billing.
- Change: Response caching now permits only public/internal, zero-temperature, tool-free requests. Confidential, restricted, creative, and tool-using work bypasses cache storage and lookup.
- Impact: Clients can safely retry ambiguous non-streaming failures across router instances, while sensitive or nondeterministic responses cannot be accidentally reused by the optimization cache.
- Files: HTTP admission, router service, persistence contracts/adapters, migration 003, configuration, integration CI, tests, and the retry/cache operator guide.
- Validation: Unit and HTTP concurrency tests, migration coverage, TypeScript lint, production build, and real PostgreSQL/Docker integration.
- Migration: Deploy migration 003 before using idempotency on PostgreSQL. Configure `IDEMPOTENCY_TTL_SECONDS` to cover the client retry window; default is 24 hours.
- Follow-up: Administrative audit APIs remain in the next control-plane milestone.

## 2026-08-09 - Reservation crash recovery

- Change: Added renewable reservation leases, streaming heartbeats, startup recovery, and periodic PostgreSQL sweeps using `FOR UPDATE SKIP LOCKED`. Expired work is charged at its reserved estimate and tagged `lease-expiry`.
- Impact: A router crash or persistent reconciliation failure can no longer reserve tenant capacity forever. Multiple router instances may sweep safely without double settlement.
- Validation: Unit/configuration tests plus real PostgreSQL lease-expiry, heartbeat, and concurrent accounting integration tests.
- Operations: Keep `RESERVATION_LEASE_SECONDS` above the longest ordinary non-streaming request; Cosmy enforces request timeout plus 30 seconds as a floor. Alert on lease-expiry reconciliation because it indicates uncertain actual provider cost.
- Review hardening: Duplicate enabled credential digests now fail startup, sustained streaming-heartbeat failure terminates the stream before lease recovery can settle it, and third-party CI actions are pinned to immutable commits.
- Follow-up: Add an authenticated correction/audit workflow for operators who later recover authoritative provider usage.

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

## 2026-08-09 - Accounting robustness, cache bounds, and hygiene fixes

- Change: Usage reconciliation is now best-effort with one retry; a usage-store failure no longer turns a successful provider response into a failed request, no longer marks a healthy model as failed, and no longer masks the original provider error on failure paths.
- Change: The in-memory response cache now evicts the oldest entry when it reaches 10,000 entries, so unread expired entries cannot grow memory without bound.
- Change: API-key probe exemption matches the registered route (query-string safe); backoff `wait` removes its abort listener when it resolves; coordinate distance scoring is clamped to [0,1]; CI now runs on `optimise/**` branches; macOS `.DS_Store` files are ignored.
- Impact: Transient database hiccups during cost accounting no longer fail requests or poison health; cache memory is bounded; health probes with query strings stay unauthenticated.
- Files or subsystems: Execution, persistence cache, HTTP API, routing policy, resilience, CI, tests.
- Validation: 47 automated tests (3 new regression tests), TypeScript lint, production build, live HTTP smoke (stream abort, 50 concurrent requests, server restart), and `npm start` smoke test.
- Known limitations and follow-up: Postgres-backed budget enforcement and per-tenant auth remain open; reconciliation failure is retried once then released as best-effort, which under persistent store outages can leave a reservation un-reconciled.

## 2026-08-09 - Deadline fast-path fix, timeout semantics, and rate-limit edge

- Change: Fixed a real deadline bug where the overall request deadline was disposed immediately on the single-candidate fast path (the un-awaited return let `finally` clear the timer before execution started), so `REQUEST_TIMEOUT_MS` was not enforced for the most common routing outcome.
- Change: Deadline expiry now surfaces as HTTP 504 `timeout` (retryable) instead of `499 request_cancelled`, so server-side timeouts are distinguishable from client cancellations.
- Change: Client cancellations no longer count toward opening the circuit breaker; a `RATE_LIMIT_MAX=0` value now disables rate limiting instead of failing every request with 400; the response-cache key registry version is read lazily so a runtime registry publish invalidates cached routes.
- Impact: Timeouts are enforced on every execution path, timeout errors carry a retryable 504, cancellation storms no longer trip breakers, and zero rate limits behave as documented.
- Files or subsystems: Execution, resilience, configuration, cache, tests.
- Validation: 50 automated tests (2 new regression tests), TypeScript lint, live HTTP verification of the 504 timeout path and `RATE_LIMIT_MAX=0`.
- Known limitations and follow-up: Streaming requests still have no total-duration bound by design; half-open breaker probes are not concurrency-limited.

## 2026-08-09 - Review defect closure

- Change: Tool definitions must now include `inputSchema`, so malformed requests fail locally instead of reaching a provider. The bounded latency window now removes an evicted sample from its running total, keeping count, total, and p95 mathematically consistent.
- Impact: Provider requests cannot receive structurally incomplete tools, and long-running processes expose correct latency aggregates after the 2,048-sample window wraps.
- Files: Request JSON schema, in-memory metrics, HTTP and metrics regression tests.
- Validation: TypeScript lint, focused regression tests, full test suite, and production build.
- Follow-up: This closes both unresolved P1 findings from PR #6; production metrics export remains part of the observability milestone.

## 2026-08-09 - Tenant-safe API admission

- Change: Added tenant-scoped API credentials configured as SHA-256 digests, scope checks, production fail-closed startup, and credential-derived billing identity. A caller can no longer select another tenant through `policy.tenantId`.
- Impact: Authentication and billing now share one trusted tenant identity. Existing `COSMY_API_KEY` deployments keep a documented migration path to digested credentials.
- Files: Security module, configuration, HTTP admission, startup composition, environment example, tests, and tenant security guide.
- Validation: Authentication/configuration tests, HTTP trust-boundary tests, TypeScript lint, full test suite, and production build.
- Migration: Configure `COSMY_API_CREDENTIALS` before the next production restart. Use `ALLOW_UNAUTHENTICATED=true` only as an explicit emergency override.
- Follow-up: Durable key rotation, OAuth/workload identity, and administrative audit events remain control-plane work.

## 2026-08-09 - Atomic PostgreSQL budgets and managed migrations

- Change: Added tenant budget rows, transactional conditional reservations, idempotent reconciliation totals, and a zero-means-unlimited configuration fix. Startup now applies numbered migrations under an advisory lock and rejects checksum drift.
- Impact: Concurrent router instances cannot overspend a configured PostgreSQL tenant budget through a check-then-insert race. Schema changes are ordered, recorded, and safe to retry.
- Files: PostgreSQL client and repositories, migration 002, configuration, unit/integration tests, integration CI, and persistence guide.
- Validation: Mock contract tests, real PostgreSQL concurrent reservation tests, full test suite, build, and Docker Compose smoke.
- Migration: Existing databases re-run idempotent migration 001 once to establish checksums, then apply migration 002. Never edit a migration after deployment.
- Follow-up: Add durable reconciliation jobs and budget administration/audit APIs in the control-plane milestone.

## 2026-08-10 - Hybrid latent-space router (working-tree change; commit pending)

- Change: Added a DeepSeek V4 Flash routing-classifier boundary, strict versioned request/model vectors, conservative predicted-quality gating, safe Pareto pruning, and deterministic cost-first selection.
- Change: Replaced the low-signal domain-specialization dimension with an explicit design-skill axis beside creativity, covering visual hierarchy, layout, typography, interaction patterns, and design-language execution.
- Change: Added the post-ranking deep-reasoning gate so an initially selected non-reasoning model is promoted to the next cheapest eligible reasoning-capable model.
- Impact: `/v1/responses` can now choose the cheapest model predicted to meet the requested quality while retaining hard policy, latency, cost, capability, cancellation, and fallback guarantees.
- Files or subsystems: Domain contracts, routing features/policy/router, model registry, classifier/provider configuration, service/API wiring, documentation, and unit/integration tests.
- Validation: 128 project tests passed (13 PostgreSQL integration tests skipped without a database) with no paid model calls; TypeScript lint, production build, and diff whitespace validation also passed.
- Limitations and follow-up: Model quality and capability vectors are configured priors until production evaluation profiles calibrate them. Classifier cost/usage telemetry and shared production health snapshots remain follow-up work.
