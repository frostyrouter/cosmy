# Durable persistence boundary

The persistence package defines contracts for PostgreSQL and Redis implementations without adding infrastructure-specific dependencies to the routing core.

`buildApp` accepts `registry`, `usage`, `health`, `providers`, and `metrics` dependencies. This is the startup seam for production composition: the default remains in-memory, while a deployment composition root can construct SQL/Redis adapters and inject them without modifying request routing.

## PostgreSQL responsibilities

PostgreSQL is the source of truth for model-registry snapshots, manifests, health events, reservations, and usage records. Registry publication must write a complete snapshot in one transaction, then expose it as current only after all manifests are committed. Reservation reconciliation must be idempotent by reservation ID so retries cannot double-count spend.

## Redis responsibilities

Redis is suitable for short-lived response caching, distributed circuit state, rate-limit counters, and hot registry snapshots. Recommended key families are:

- `cosmy:registry:current`
- `cosmy:registry:snapshot:{version}`
- `cosmy:health:{provider}:{model}`
- `cosmy:budget:{tenant}:reserved`
- `cosmy:response:{cache-key}`

Every key needs an explicit TTL or a documented retention policy. Never place raw prompts, outputs, API keys, or restricted user data in an unencrypted cache by default.

The SQL migration in `migrations/001_control_plane.sql` is a starting schema, not a claim that every production deployment should use the same indexes or retention periods. Load testing and tenant-level access patterns should determine partitioning, archival, and query plans.
