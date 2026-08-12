# Live health routing and structured-output validation

## Runtime health feedback

Provider execution and automatic routing now share the same `HealthSnapshotStore`. Three consecutive non-cancellation execution failures temporarily remove a model from automatic routing for 30 seconds. The route decision records `observed_health_unavailable`, and an explicit request for that model fails with `no_eligible_model` rather than silently switching providers.

A successful attempt resets the consecutive-failure counter. Observed success/error data adjusts reliability ranking, while the registry's latency p95 remains authoritative: a single local latency sample is not treated as a percentile. Memory mode keeps this state process-local; PostgreSQL mode shares its aggregate across instances as described in [shared provider health](33-shared-provider-health.md).

## Structured-output guarantee

For non-streaming requests with `responseFormat.type: "json-schema"`, Cosmy parses the provider output and validates it before returning success. The validator supports the common deterministic JSON Schema subset used by the API: types, objects/properties/required/additional properties, arrays, scalar bounds, enum/const, and boolean composition (`allOf`, `anyOf`, `oneOf`, `not`). Unsupported keywords such as `$ref`, `format`, and `pattern` fail with `invalid_request` before any provider call.

If an output is invalid, the attempt is reconciled at its actual reported cost and is recorded as an output error without marking the provider transport unhealthy. When fallback is enabled, the executor tries a pre-ranked eligible alternative. It stops before another attempt whose estimate plus prior invalid-output cost would exceed `policy.maxCostUsd`; the terminal error is `output_validation_failed`.

Streaming output cannot be safely replayed after bytes reach a caller, so post-generation schema validation and schema-driven fallback apply only to non-streaming requests. Streaming requests still receive provider-native structured-output constraints, and unsupported schemas are rejected before execution.

## Operational guidance

- Alert on `output_validation_failed` separately from transport outages; it is a model/conformance signal.
- Keep an eligible structured-output fallback from a different provider where reliability matters.
- Treat `maxCostUsd` as the total ceiling for validation-driven escalation, not permission to spend that amount per attempt.
- Use request idempotency for ambiguous client retries; invalid output attempts are billable even when a fallback succeeds.
