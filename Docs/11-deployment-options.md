# Deployment options

Status: Proposed.

## Goal

Remain cloud-neutral while allowing managed infrastructure where it provides clear operational value. Core contracts must work in self-hosted, managed, and hybrid environments.

## Option A: portable managed Kubernetes

Components run as containers on a managed Kubernetes service. Use managed relational database, cache, object storage, secret manager, event stream, and observability services through portable interfaces.

Advantages:

- Strong operational ecosystem
- Horizontal scaling and regional cells
- Workload identity and policy controls
- Easier managed data durability

Disadvantages:

- Kubernetes operational complexity
- Cloud-service differences still require abstraction
- Potential cost at small scale

Recommended for the primary large-scale managed deployment after the service boundaries stabilize.

## Option B: simpler container platform

Run stateless services on a managed container platform with managed databases and queues.

Advantages:

- Faster MVP operations
- Lower platform burden
- Automatic scaling

Disadvantages:

- Streaming limits and networking behavior vary
- Less control over connection-heavy workloads
- Migration may be needed at high scale

Recommended for early production when expected load is moderate and constraints are verified.

## Option C: fully self-hosted

Deploy containers, PostgreSQL-compatible storage, object storage, event streaming, and telemetry in customer infrastructure.

Advantages:

- Data sovereignty
- Private provider endpoints
- Customer-controlled operations

Disadvantages:

- Upgrade and support complexity
- Environment variability
- Harder global analytics and evaluation management

Required for enterprise and regulated use cases, but not necessarily the first implementation.

## Option D: hybrid control plane

Cosmy hosts management, registry, and evaluation services; customer-hosted data-plane cells process request content and provider credentials.

Advantages:

- Central product updates
- Customer data-plane control
- Lower content exposure

Disadvantages:

- Secure snapshot and telemetry protocols required
- Split responsibility during incidents
- Version skew management

This is the preferred long-term enterprise architecture.

## Portable service choices

| Capability | Managed option | Portable option |
|---|---|---|
| Transactional data | Cloud relational DB | PostgreSQL |
| Cache/rate limits | Managed platform cache | Portable cache interface |
| Object snapshots | Cloud object store | S3-compatible storage |
| Event streaming | Managed stream | Kafka-compatible system |
| Secrets | Cloud secret manager | Vault-compatible system |
| Metrics | Managed monitoring | Prometheus-compatible |
| Traces | Managed tracing | Portable tracing interface |
| Logs | Managed logging | Structured log store |

Interfaces should preserve semantics, not promise effortless vendor swaps.

## Environments

- Local: single-process or compose-based dependencies, synthetic providers
- Development: shared non-production services
- Staging: production topology at reduced capacity
- Production: isolated regional cells and controlled control plane
- Evaluation: isolated budgets and credentials; no side-effecting tools

## Infrastructure as code

Infrastructure definitions include networks, identity, compute, storage, encryption, observability, backups, budgets, and policy. Changes pass plan review and environment promotion.

## Deployment strategy

- Immutable images
- Signed artifacts
- Rolling or canary data-plane rollout
- Schema expansion before code dependency
- Snapshot compatibility check
- Automatic health and rollback gates
- Separate adapter and ranker feature flags

## Configuration

Static process configuration comes from environment or mounted files. Dynamic routing configuration comes only from signed snapshots. Secrets come from the secret broker.

## Autoscaling

Scale on active streams, provider concurrency, queue delay, CPU, memory, and event-buffer pressure. Use predictive or scheduled capacity for known bursts. Keep minimum warm capacity to protect time to first token.

## Cost controls

- Per-environment provider budgets
- Shadow-traffic ceilings
- Autoscaling maximums
- Storage lifecycle policies
- Evaluation scheduling by priority
- Tenant cost attribution
- Infrastructure cost included in route economics for private models

## Local development

Provide:

- Provider simulators
- Deterministic stream fixtures
- Local policy and registry snapshots
- In-memory or containerized dependencies
- Trace viewer
- Decision explain command
- Replay command with redacted fixtures

Developers should not require real provider spend for unit and contract tests.

## Recommendation

Begin with a modular monolith for control-plane APIs plus independently scalable router workers and adapter modules. Use PostgreSQL, object storage, and vendor-neutral observability contracts. Add distributed caching or tracing only when measured load and operational requirements justify them. Split services only where scaling, security, ownership, or failure isolation justifies the operational cost.

Avoid premature microservices. The production design defines boundaries now so extraction later is controlled.
