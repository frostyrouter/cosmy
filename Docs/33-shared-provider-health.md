# Shared provider health

PostgreSQL mode shares provider health across router instances without putting database latency in the response path.

## Data flow

1. The executor records success or failure in its local snapshot immediately.
2. A process-local queue appends the outcome to `provider_health_events` and atomically updates `provider_health_state` through a dedicated four-connection pool.
3. Every router polls the aggregate snapshot at `HEALTH_REFRESH_SECONDS` (default 2).
4. The deterministic router rejects a model after three consecutive observed failures for the existing 30-second cooldown. A success resets the consecutive count.

Pending local observations are protected from an overlapping refresh, so a poll cannot overwrite newer in-process evidence. After the final queued write, the returned database row replaces local state with the cross-instance aggregate.

## Latency and failure semantics

Provider completion does not await the health write. This keeps the added response-path work to an in-memory map update and queue scheduling. Cross-instance convergence is eventually consistent and is normally bounded by the refresh interval plus database query time.

Startup fails if the initial shared snapshot cannot be loaded, preventing a PostgreSQL-configured instance from silently starting with isolated health. Later write or refresh failures increment `health_store_failure` and retain the current local snapshot. Failed outcome writes are not replayed automatically, so operators should alert on this metric and investigate database availability.

## Operations

- Apply migration `010_provider_health_state.sql` before rolling out this build; managed startup migrations do this automatically.
- Keep `HEALTH_REFRESH_SECONDS` above zero for multi-instance deployments.
- Monitor database pool saturation, `health_store_failure`, request fallback rate, and per-model failure rate.
- Define retention for append-only `provider_health_events`; the aggregate state table is compact, but the event table grows with traffic.
- Run the PostgreSQL integration suite and a fault-injection/load test in the deployment environment before production promotion.

This design reduces avoidable latency and closes process-local health divergence. It does not promise zero latency or zero defects: provider networks, database outages, traffic shape, and model behavior still require SLOs, monitoring, staged rollout, and rollback.
