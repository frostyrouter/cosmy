# Durable persistence boundary

The persistence package currently provides PostgreSQL implementations without adding infrastructure-specific dependencies to the routing core.

`buildApp` accepts `registry`, `usage`, `health`, `providers`, and `metrics` dependencies. This is the startup seam for production composition: the default remains in-memory, while a deployment composition root can construct SQL adapters and inject them without modifying request routing.

## PostgreSQL responsibilities

PostgreSQL is the source of truth for model-registry snapshots, manifests, health events, reservations, and usage records. Registry publication must write a complete snapshot in one transaction, then expose it as current only after all manifests are committed. Reservation reconciliation must be idempotent by reservation ID so retries cannot double-count spend.

Caching and distributed coordination are deliberately deferred. The current runtime uses PostgreSQL for durable reservations and in-memory state for local health, metrics, and optional response caching.

The SQL migration in `migrations/001_control_plane.sql` is a starting schema, not a claim that every production deployment should use the same indexes or retention periods. Load testing and tenant-level access patterns should determine partitioning, archival, and query plans.
