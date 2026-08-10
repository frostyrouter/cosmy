# Controlled canary rollouts

Status: Implemented for tenant-stable canaries, manual promotion/rollback, and automatic health rollback.

## The fast mental model

```text
promoted model -> start canary -> stable tenant slice -> observe real attempts
                                      |                    |
                                      |          threshold exceeded
                                      |                    v
                                      +------------ automatic rollback
                                               or
                                      operator promotion -> active
```

A model must already be enabled through the evidence-backed promotion workflow. Starting a rollout does not change its manifest; it adds a runtime admission boundary before eligibility and utility ranking.

## APIs

| Endpoint | Scope | Purpose |
|---|---|---|
| `POST /v1/admin/model-rollouts` | `admin:write` | Start one canary for an exact enabled ID/version |
| `GET /v1/admin/model-rollouts/:id` | `admin:read` | Read counters, thresholds, state, and reason |
| `POST /v1/admin/model-rollout-actions` | `admin:write` | Promote or manually roll back a mutable canary |

Start payload:

```json
{
  "modelId": "provider/model-v2",
  "modelVersion": "2",
  "trafficPercentage": 5,
  "minimumSamples": 200,
  "maximumErrorRate": 0.03,
  "maximumAverageLatencyMs": 1800
}
```

`minimumSamples` is at least 20. Cancellations are excluded because they do not prove provider failure. Provider errors count as failures; successful and failed attempts both contribute latency.

## Assignment and routing safety

Cosmy hashes rollout ID plus authenticated tenant ID into `[0,100)`. The same tenant remains in or out of the canary as traffic changes, preventing request-to-request model flapping. Non-assigned and rolled-back candidates are removed before hard constraints and scoring; explicit model selection cannot bypass the boundary.

Cache keys include the selected immutable model ID/version, so a response produced before a rollout change cannot be served as another model's result.

## Atomic rollback

PostgreSQL increments sample, error, and latency totals in one conditional update. At the minimum sample count, the same statement changes `canary` to `rolled_back` when error rate or average latency exceeds its threshold. Only the transaction that performs the transition writes `rollout.auto_rollback`, so concurrent routers cannot create duplicate rollback decisions.

Routers write observations only for the exact locally known canary version, update local admission immediately after their own outcome, and poll durable rollout state with the registry refresh loop for cross-instance convergence. Observations use a dedicated four-connection PostgreSQL bulkhead with 100 ms server statement deadlines, 75 ms lock deadlines, and a 200 ms client query deadline; reservations, idempotency, readiness, registry refresh, and administration keep the primary pool. The response path itself waits at most 100 ms. Metrics expose `rollout_auto_rollback` and `rollout_observation_failure`; timeout or storage failure never replaces the caller's provider result.

## Operator checklist

1. Start at 1–5% with thresholds based on the incumbent model and enough samples to avoid noisy rollback.
2. Watch rollout counters plus provider error, latency, token, cost, and fallback metrics.
3. Investigate `rollout_observation_failure` immediately because safety decisions are missing evidence.
4. Promote only after quality evaluation and operational gates pass; Cosmy rejects promotion until minimum samples, error rate, and average latency satisfy the rollout policy. Otherwise roll back with a reason.
5. Publish a new immutable model version before retrying changed provider or manifest behavior.

## Deliberate boundaries

This milestone does not duplicate requests for shadow execution: doing so would double-charge tenants and could repeat tools or side effects. Safe shadow execution needs a separate budget, redaction policy, side-effect-free adapter mode, asynchronous comparison, and signed evaluator results. Automatic rollback currently uses cumulative error rate and average latency; bounded time windows, p95 histograms, quality signals, and cost deltas are the next control-loop layer.
