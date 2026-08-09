# Durable persistence boundary

The persistence package currently provides PostgreSQL implementations without adding infrastructure-specific dependencies to the routing core.

`buildApp` accepts `registry`, `usage`, `health`, `providers`, and `metrics` dependencies. This is the startup seam for production composition: the default remains in-memory, while a deployment composition root can construct SQL adapters and inject them without modifying request routing.

## PostgreSQL responsibilities

PostgreSQL is the source of truth for model-registry snapshots, manifests, health events, reservations, and usage records. Registry publication must write a complete snapshot in one transaction, then expose it as current only after all manifests are committed. Reservation reconciliation must be idempotent by reservation ID so retries cannot double-count spend.

Caching and distributed coordination are deliberately deferred. The current runtime uses PostgreSQL for durable reservations and in-memory state for local health, metrics, and optional response caching.

## Budget invariant

`tenant_budgets` is the serialized authority for a tenant's configured limit, reserved amount, and spent amount. Reservation creation locks that tenant row and performs a conditional update before inserting the reservation. Two concurrent requests therefore cannot both pass a stale application-side budget check.

Reconciliation uses one data-modifying CTE. It marks an active reservation reconciled and moves its estimate from `reserved_usd` to actual `spent_usd`; a repeated reconciliation finds no active row and cannot double-charge.

## Migration path

Startup applies numbered SQL files in lexical order inside one transaction protected by a PostgreSQL advisory lock. `schema_migrations` stores each file's SHA-256 checksum. Editing an already-applied migration fails startup; add a new numbered migration instead.

| Operation | Failure behavior | Safe retry? |
|---|---|---|
| Apply migration | Transaction rolls back; startup fails. | Yes, with the unchanged file. |
| Reserve budget | Transaction rolls back; request fails. | Yes, subject to an idempotency key at the API layer. |
| Reconcile usage | Only an unreconciled row can change totals. | Yes. |
| Change budget | Upserts one tenant row. | Yes. |

The SQL migrations are a production-safe baseline, not a claim that every deployment should use the same indexes or retention periods. Load testing and tenant-level access patterns should determine partitioning, archival, and query plans.
