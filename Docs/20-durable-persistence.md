# Durable persistence boundary

The persistence package currently provides PostgreSQL implementations without adding infrastructure-specific dependencies to the routing core.

`buildApp` accepts `registry`, `usage`, `health`, `providers`, and `metrics` dependencies. This is the startup seam for production composition: the default remains in-memory, while a deployment composition root can construct SQL adapters and inject them without modifying request routing.

## PostgreSQL responsibilities

PostgreSQL is the source of truth for model-registry snapshots, manifests, provider health, reservations, and usage records. Registry publication must write a complete snapshot in one transaction, then expose it as current only after all manifests are committed. Reservation reconciliation must be idempotent by reservation ID so retries cannot double-count spend.

In PostgreSQL mode, provider outcomes append to `provider_health_events` and atomically increment `provider_health_state`. Each process applies its own observations immediately and asynchronously persists them through a dedicated bounded pool, then polls the shared aggregate every `HEALTH_REFRESH_SECONDS`. This avoids adding a health database round trip to response latency while allowing horizontally scaled routers to converge. Memory mode retains process-local health. Metrics and optional response caching remain local.

## Budget invariant

`tenant_budgets` is the serialized authority for a tenant's configured limit, reserved amount, and spent amount. Reservation creation locks that tenant row and performs a conditional update before inserting the reservation. Two concurrent requests therefore cannot both pass a stale application-side budget check.

Reconciliation uses one data-modifying CTE. It marks an active reservation reconciled and moves its estimate from `reserved_usd` to actual `spent_usd`; a repeated reconciliation finds no active row and cannot double-charge.

## Crash recovery

Every reservation has a renewable lease. Normal provider completion reconciles actual cost; streaming execution renews its lease at least three times per lease period. A failed renewal is retried with a five-second bound; sustained failure stops the stream with `reservation_heartbeat_failed` and settles the conservative estimate before recovery may touch live work. Startup and the periodic recovery sweep lock expired rows with `SKIP LOCKED`, charge their original estimate conservatively, and release reserved capacity. This favors budget safety over undercounting when a process dies after provider execution but before actual usage is stored.

`RESERVATION_LEASE_SECONDS` defaults to 300 and is automatically raised to at least the request timeout plus 30 seconds. `RECONCILIATION_SWEEP_SECONDS` defaults to 30; zero disables the periodic sweep but startup recovery still runs. Rows record `reconciliation_source` as `runtime` or `lease-expiry` for audit and correction workflows.

## Migration path

Startup applies numbered SQL files in lexical order inside one transaction protected by a PostgreSQL advisory lock. `schema_migrations` stores each file's SHA-256 checksum. Editing an already-applied migration fails startup; add a new numbered migration instead.

| Operation | Failure behavior | Safe retry? |
|---|---|---|
| Apply migration | Transaction rolls back; startup fails. | Yes, with the unchanged file. |
| Reserve budget | Transaction rolls back; request fails. | Yes, subject to an idempotency key at the API layer. |
| Reconcile usage | Only an unreconciled row can change totals. | Yes. |
| Recover expired lease | Charge estimate once and release reserved balance. | Yes; concurrent workers use row locks. |
| Change budget | Upserts one tenant row. | Yes. |
| Record provider health | Keep the immediate local observation; increment `health_store_failure` if the asynchronous write fails. | A later observation is safe, but a failed event is not replayed automatically. |

The SQL migrations are a production-safe baseline, not a claim that every deployment should use the same indexes or retention periods. `provider_health_events` is append-only and has no built-in retention job; production operations must define archival or deletion based on audit requirements. Load testing and tenant-level access patterns should determine partitioning, archival, and query plans.
