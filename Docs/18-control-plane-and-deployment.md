# Control plane and deployment contracts

The router’s data plane now depends on small interfaces that can be backed by durable infrastructure without changing routing code.

## Versioned model registry

`VersionedModelRegistry` publishes immutable snapshots with a monotonically increasing version, source label, timestamp, and cloned model manifests. A future PostgreSQL implementation can persist manifests and atomically publish a new version; workers can cache a snapshot and report the version used for every route decision.

Never mutate a model manifest in place. Publish a new snapshot for pricing, capability, health, or policy changes. This makes rollback and audit straightforward.

## Health snapshots

`HealthSnapshotStore` records success/failure counts, last observed latency, and update time. The in-memory implementation is deterministic for tests. Production deployments should use a shared store or aggregate process-local events centrally so multiple workers do not make contradictory health decisions.

## Container and CI boundary

The container runs Uvicorn with FastAPI as a non-root user, using uvloop and httptools on Linux. CI installs the Python package, runs Ruff checks, verifies formatting, and runs pytest. No provider API keys are required because provider calls are mocked or simulated.
