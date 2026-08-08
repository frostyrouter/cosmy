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

`MetricsSink` is intentionally vendor-neutral. The in-memory implementation records request count, success/error/cancellation count, fallback count, latency distribution, token totals, and cost. A future exporter can translate the same events into the chosen monitoring backend without changing the router or provider adapters.

The metrics contract must not record prompts, outputs, API keys, or raw provider payloads. Correlate using request IDs and stable model/provider labels only. Export remains an application-specific integration decision and is intentionally not bundled yet.
