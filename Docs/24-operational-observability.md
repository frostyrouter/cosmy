# Operational observability

Status: Implemented without OpenTelemetry or Redis.

## Scrape contract

```http
GET /metrics
Authorization: Bearer <metrics-read-key>
```

The credential needs `metrics:read`; `admin:read` and `admin:write` also work. Response/application credentials do not. The endpoint is exempt from request rate limiting so scraper cadence does not compete with API callers.

The response uses Prometheus text format 0.0.4 and requires no external telemetry SDK. Each router instance exposes its own process-local counters; the monitoring system sums counters and treats gauges per instance.

## Exported signals

| Metric | Type | Labels / meaning |
|---|---|---|
| `cosmy_provider_attempts_total` | Counter | `provider`, `model`, `status` (`success`, `error`, `cancelled`) |
| `cosmy_provider_latency_ms_count/sum` | Counter pair | Provider/model attempt latency |
| `cosmy_provider_input_tokens_total` | Counter | Provider/model input usage |
| `cosmy_provider_output_tokens_total` | Counter | Provider/model output usage |
| `cosmy_provider_cost_usd_total` | Counter | Provider-reported estimated USD |
| `cosmy_fallbacks_total` | Counter | Requests that reached the first fallback |
| `cosmy_active_streams` | Gauge | Streams currently executing in this instance |
| `cosmy_latency_p95_ms` | Gauge | Local p95 over the newest 2,048 attempts |
| `cosmy_operational_events_total` | Counter | Cache, idempotency, reconciliation, registry refresh, and recovery events |
| `cosmy_metrics_provider_series` | Gauge | Current bounded provider/model series count |

## Cardinality and privacy boundary

Provider/model pairs are capped at 512. Additional pairs merge into `{provider="_other",model="_other"}` so repeated registry publications cannot grow memory forever. Status and operational event names are closed enums.

Never exported:

- tenant, project, credential, or request IDs;
- prompts, outputs, tools, metadata, headers, or API keys;
- arbitrary error text or provider payloads.

Prometheus label escaping covers quotes, backslashes, and newlines in operator-controlled provider/model names.

## Starter alerts

| Condition | Suggested action |
|---|---|
| `reconciliation_failure` increases | Check PostgreSQL; reservations may require lease recovery |
| `idempotency_store_failure` increases | Stop automatic client retries until PostgreSQL is stable |
| `registry_refresh_failure` persists for two intervals | Compare active registry versions across instances |
| `reservation_recovered` increases | Audit uncertain provider cost and process/database availability |
| Provider error ratio spikes | Check adapter/provider health and fallback capacity |
| Active streams grow without falling | Inspect client disconnects and provider stream termination |

## Deployment notes

Create a dedicated scraper credential rather than reusing an administrator key. Scrape every 15–30 seconds with a timeout below the interval. In multi-instance deployment, configure the monitoring target for every replica; this endpoint does not aggregate the cluster.

Distributed traces, long-term metrics storage, and dashboards are integrations outside the router process. They can consume this stable boundary later without making OpenTelemetry a runtime requirement today.
