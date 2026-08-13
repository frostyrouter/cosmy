# Safe shadow evaluation

Status: Implemented for sampled, side-effect-free, separately budgeted comparisons.

## What happens

```text
primary response completes -> eligibility + stable sample -> bounded memory queue
                                                           -> shadow budget reserve
                                                           -> candidate provider
                                                           -> hash-only observation
```

The primary response never waits for shadow execution and never changes because of it. Cached responses, idempotency replays, streams, tool definitions, tool-role messages, confidential data, and restricted data are not shadowed.

## Administrative flow

| Endpoint | Scope | Purpose |
|---|---|---|
| `POST /v1/admin/shadow-campaigns` | `admin:write` | Start a campaign for an exact registered model version |
| `GET /v1/admin/shadow-campaigns/:id` | `admin:read` | Read budget and success/error totals |
| `POST /v1/admin/shadow-campaign-actions` | `admin:write` | Pause, resume, or complete a campaign |

```json
{
  "modelId": "provider/model-v2",
  "modelVersion": "2",
  "samplePercentage": 5,
  "budgetLimitUsd": 100,
  "allowedDataClasses": ["public", "internal"]
}
```

Only one active campaign may target a model, with at most 64 active campaigns platform-wide. Sampling is stable for campaign, authenticated tenant, and request ID. Operators must have authorization to send every admitted tenant's internal data to the candidate provider; use `public` only when that authorization is absent.

## Privacy and side effects

- Prompts and outputs are never written to shadow tables or a durable queue.
- The bounded queue keeps only the ephemeral provider request plus a keyed output digest; it holds at most 1,000 jobs and 16 MiB per router and runs four concurrently.
- Tenant IDs, metadata, explicit model selection, routing hints, and tools are stripped before provider execution.
- Stored output fingerprints are process-keyed HMAC-SHA-256 values. They support equality only within one comparison and cannot reconstruct content.
- Observations contain model IDs, status, latency, usage, keyed digests, and an exact-match flag. Define database retention for these records.

## Independent budget and failure isolation

Shadow reservations update campaign `reservedUsd` atomically and cannot consume tenant production budgets. Completion moves actual cost to `spentUsd`; failures and expired five-minute leases conservatively charge the estimate. A campaign automatically completes when spending reaches its limit.

Shadow SQL uses its own four-connection pool with short deadlines. Queue overflow, budget rejection, provider failure, observation failure, and recovered reservations emit operational metrics. None replaces, delays, retries, or invalidates the primary response.

## Operator checklist

1. Validate provider/data residency and begin with public data at 1%.
2. Set a hard campaign budget and verify candidate pricing first.
3. Watch `shadow_job_dropped`, `shadow_execution_failure`, `shadow_budget_rejection`, and recovery metrics.
4. Compare campaign success, errors, latency, tokens, cost, and exact-match rate with offline quality evaluation.
5. Pause on anomalies; complete the campaign before promotion or rejection.

## Honest boundary

Exact string match is not a quality score. Cosmy does not yet send shadow outputs to a grader or retain content, so semantic quality comparison requires a privacy-approved evaluator pipeline with protected datasets, signed results, and explicit retention. This implementation supplies safe production-distribution evidence without pretending it proves answer quality.
