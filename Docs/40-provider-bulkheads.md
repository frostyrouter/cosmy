# Provider bulkheads and load shedding

Status: implemented for per-process, per-provider concurrency.

## Behavior

Every configured or injected provider adapter is wrapped in an independent bulkhead. `PROVIDER_MAX_CONCURRENCY` (default 100) is the maximum number of active logical completion or streaming calls for each provider in one router process. A logical call retains one permit across its bounded internal retries and releases it on success, failure, cancellation, or early stream termination.

There is deliberately no waiting queue. When a provider is full, Cosmy increments `provider_saturated` and immediately raises retryable `provider_saturated` (HTTP 503 if no eligible fallback succeeds). The executor may move to a pre-ranked, policy-compliant fallback provider without spending the request deadline waiting behind already slow work.

Circuit recovery is also bounded. After cooldown, exactly one call becomes the half-open probe; concurrent calls continue to fail fast until that probe succeeds or fails. This prevents a traffic burst from stampeding a recovering provider.

## Sizing and rollout

Choose the cap from the provider project limit, expected stream duration, router replica count, connection-pool capacity, and remaining latency budget. The setting applies separately to each provider and each process, so an approximate deployment-wide ceiling is `replicas * PROVIDER_MAX_CONCURRENCY` per provider. Begin below the external limit, load test realistic streaming duration, and alert on any sustained `provider_saturated` increase.

```dotenv
PROVIDER_MAX_CONCURRENCY=100
```

Lowering the value requires a restart and affects new calls only; active work is not cancelled. Roll back by restoring the prior positive value. A zero/unbounded setting is rejected because it would remove the production safety invariant.

## Boundaries

This is local admission control, not a distributed quota. Replicas do not coordinate permits, and priority/fairness queues are not implemented. Tenant ingress rate limits, request deadlines, provider bulkheads, and provider-side quotas remain separate layers. Deployment load tests—not the default value—are the authority for production sizing.
