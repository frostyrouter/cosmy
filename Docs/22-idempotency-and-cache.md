# Safe retries and response caching

Status: Implemented for non-streaming responses.

## The two guarantees

| Mechanism | Promise | Storage key |
|---|---|---|
| Idempotency | Retrying one operation does not execute or bill it twice | authenticated tenant + `Idempotency-Key` |
| Response cache | Reuses eligible deterministic output as an optimization | policy version + registry version + normalized request |

These are deliberately separate. Idempotency is a correctness boundary; cache failures are fail-open and never decide whether an operation may run.

## Client contract

Send `Idempotency-Key` on retryable non-streaming `POST /v1/responses` calls. Keys are 1–128 characters from letters, digits, `.`, `_`, `:`, and `-`.

| Situation | Result |
|---|---|
| First tenant/key/request | Execute and persist the response |
| Same tenant/key/request after completion | Return the exact stored response |
| Same key, changed request | `409 idempotency_conflict` |
| Duplicate while first call runs | retryable `409 idempotency_in_progress` |
| Result cannot be persisted after execution | retryable `503 idempotency_store_error`; claim stays locked to prevent double billing |
| Key used with streaming | `400 invalid_request` |

Different tenants may safely use the same key. The request hash ignores generated request IDs and the stream flag, but covers the remaining normalized request.

## State flow

```text
missing -> processing -> completed -> expired
             |              |
             | failure      +-> replay
             +-> released
```

PostgreSQL provides cross-instance claims through the `(tenant_id, idempotency_key)` primary key. Memory mode is bounded to 10,000 entries and is suitable only for one-process development. `IDEMPOTENCY_TTL_SECONDS` defaults to 86,400 seconds. PostgreSQL removes expired matching keys immediately and sweeps up to 1,000 expired rows every 256 claims.

## Cache eligibility

Caching occurs only when every condition is true:

- response-cache TTL is positive;
- data class is `public` or `internal`;
- temperature is omitted or zero;
- no tools are present.

`confidential`, `restricted`, creative, and tool-using requests always bypass the cache. Registry or policy version changes produce a different key, so old routing decisions are not reused.

## Operator checklist

1. Apply migration `003_idempotency.sql` through managed startup migrations.
2. Use PostgreSQL mode for more than one router instance.
3. Set the TTL to the longest legitimate client retry window plus clock/network margin.
4. Alert on `idempotency_store_error`; inspect database availability before clients retry.
5. Treat stored responses as tenant data and include the table in retention and backup policy.

## Validation map

| Risk | Test |
|---|---|
| Concurrent double execution | memory, HTTP, and real PostgreSQL claim races |
| Cross-tenant collision | tenant-isolation unit test |
| Changed payload with reused key | HTTP and PostgreSQL conflict tests |
| Sensitive/nondeterministic cache reuse | HTTP cache-eligibility test |
| Migration omission | managed migration test and Docker integration workflow |
