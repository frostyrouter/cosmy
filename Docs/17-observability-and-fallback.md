# Observability and fallback execution

The executor now owns provider fallback because it is the first layer that knows whether a provider failed before or after output became visible.

## Fallback rules

- Candidates are attempted in the order produced by the router.
- A retryable `ProviderError` may move to the next candidate.
- `policy.allowFallback: false` disables candidate switching.
- A completion can fall back after any retryable failure.
- A stream can fall back only before its first non-empty delta.
- Once output is visible, restarting could duplicate user-visible content, so the error is returned.
- Every attempt receives its own budget reservation; failures reconcile to zero and successful candidates reconcile to actual usage.

## Metrics boundary

`MetricsSink` is intentionally vendor-neutral. The in-memory implementation records request count, success/error/cancellation count, fallback count, active streams, latency distribution, token totals, cost, and bounded operational failure counters. The authenticated `/metrics` endpoint translates these events to Prometheus text without changing router or provider adapters.

The metrics contract must not record prompts, outputs, tenant IDs, API keys, arbitrary metadata, or raw provider payloads. Export uses only bounded stable model/provider/status labels. See [Operational observability](24-operational-observability.md).
