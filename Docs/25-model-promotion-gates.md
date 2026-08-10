# Model onboarding and promotion gates

Status: Implemented for evidence submission and active-version publication.

## The no-retraining contract

Cosmy does not train a router whenever a provider releases a model. Operators add a manifest, run versioned tests, submit the resulting evidence, assess the candidate, and publish a new immutable registry snapshot. The deterministic filter/ranker consumes the new coordinates and capabilities immediately.

```text
manifest -> conformance/evaluation -> evidence -> assessment -> registry publication -> all routers refresh
```

## API flow

All endpoints require administrative credentials.

| Endpoint | Scope | Purpose |
|---|---|---|
| `POST /v1/admin/model-evidence` | `admin:write` | Store an immutable evidence record and audit event |
| `GET /v1/admin/model-evidence?modelId=...&modelVersion=...` | `admin:read` | Read the newest submitted evidence for an exact model version |
| `POST /v1/admin/model-promotion-assessments` | `admin:read` | Evaluate gates without changing routing state |
| `PUT /v1/admin/models` | `admin:write` | Publish only when every newly enabled ID/version passes |

Evidence may be submitted before the manifest is active. A failed record is retained for audit; submit a newer passing record rather than editing history.

## Default active gate

| Gate | Default |
|---|---|
| Adapter conformance | Passed |
| Pricing verification | Passed |
| Usage-accounting verification | Passed |
| Routing pass rate | At least 0.95 |
| Quality score | At least 0.70 and at least the manifest's declared quality |
| Samples | At least 100 |
| Evaluation clock | Not more than five minutes in the future |
| Freshness | `expiresAt` is in the future and after `evaluatedAt` |
| Identity | Exact model ID and version match |

Gate failures return `409 promotion_gate_failed` with deterministic reason codes in the message. Disabled candidates need no evidence because they cannot receive traffic. An already enabled unchanged ID/version may be republished, allowing safe registry metadata updates without repeating promotion.

## Example evidence

```json
{
  "modelId": "provider:model-v2",
  "modelVersion": "2",
  "suiteVersion": "standard-routing-v3",
  "datasetVersion": "support-and-code-2026-08",
  "conformancePassed": true,
  "pricingVerified": true,
  "usageVerified": true,
  "routingPassRate": 0.98,
  "qualityScore": 0.91,
  "sampleCount": 500,
  "evaluatedAt": "2026-08-10T08:00:00.000Z",
  "expiresAt": "2026-09-10T08:00:00.000Z"
}
```

## Consistency and audit

PostgreSQL serializes registry publications. Inside the same transaction, it re-reads the current snapshot and latest evidence before writing the next version and audit event, preventing a stale pre-check from bypassing the gate. Evidence submission and its actor audit event are also one transaction.

Memory mode implements the same gate for development, retains at most 20 submissions for each of 10,000 model versions, and loses evidence on restart. PostgreSQL keeps immutable evidence until an operator-defined database retention policy removes it; use PostgreSQL for multi-instance or production operation.

## What the evidence means

Cosmy verifies that evidence satisfies a policy; it cannot prove that an operator's submitted numbers are truthful. Production evaluation automation should sign results or use separate evaluator credentials and protected datasets. Separation of duties, shadow traffic, canary percentages, automatic rollback, and cryptographic attestation remain later lifecycle layers.

## Fast rollout checklist

1. Keep the candidate disabled while adapting and testing it.
2. Verify real provider usage parsing and pricing before setting those booleans.
3. Run stable and hidden datasets; store suite and dataset versions.
4. Submit evidence, call the assessment endpoint, then publish the complete snapshot.
5. Confirm every router reports the new registry version in diagnostics.
6. Watch error, latency, cost, and recovery metrics; rollback by republishing the previous complete snapshot.
