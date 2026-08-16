# Reliability and scaling

Status: Proposed.

## Reliability model

The router depends on external providers it does not control. Reliability is achieved through isolation, deadlines, bounded retries, eligible fallbacks, cached configuration, and rapid model/provider revocation.

Per-provider in-process bulkheads and single-probe half-open circuit recovery are implemented; see [provider bulkheads and load shedding](40-provider-bulkheads.md).

## Scaling unit

The primary data-plane scaling unit is a stateless router worker inside a regional cell. Workers scale by:

- Active requests
- Active streaming connections
- CPU used for normalization and scoring
- Memory used by buffers and snapshots
- Provider-specific concurrency
- Event-buffer pressure

Request count alone is insufficient because long streams consume connections for much longer than short tasks.

## Load shedding

Admission control occurs before expensive work. The system may reject or defer requests based on:

- Tenant quota
- Global cell saturation
- Provider concurrency
- Budget authority saturation
- Stream connection capacity
- Priority class
- Deadline feasibility

Load shedding returns typed retry guidance. It does not queue unbounded work in memory.

## Deadlines

One request deadline is divided into stage budgets:

- Authentication and normalization
- Budget reservation
- Classification
- Provider queue
- Time to first token
- Generation or tools
- Validation
- Fallback reserve

Downstream calls receive the remaining deadline, not a fresh timeout.

## Retries

Retries require:

- Retryable classification
- Remaining deadline
- Remaining attempt budget
- Remaining monetary reservation
- No unsafe visible-output duplication
- Idempotency support or known pre-acceptance failure

Use exponential backoff with jitter for background/control operations. Interactive requests use short provider-aware backoff or immediate fallback.

## Circuit breakers

Circuits are segmented by provider, endpoint, region, model, and error class. Credential failures are tenant-local; provider 5xx and protocol failures affect shared circuits.

States:

```text
CLOSED -> OPEN -> HALF_OPEN -> CLOSED
                 |            |
                 +-> OPEN <---+
```

Health probes and limited real traffic close circuits. Manual isolation overrides automatic state.

## Bulkheads

Separate resource pools for:

- Tenants and priority tiers
- Provider endpoints
- Streaming and non-streaming requests
- Online routing and offline evaluation
- Tool-enabled and simple generation
- Administrative and data-plane traffic

One slow provider cannot exhaust every router connection.

## Fallback rules

Fallbacks preserve all hard constraints. They are selected before execution when possible. Dynamic provider health may remove a fallback, but cannot add an unevaluated or prohibited one.

Fallback is appropriate for pre-stream infrastructure failure. Mid-stream fallback requires explicit continuation semantics or a new attempt visible to the caller.

## Backpressure

- Provider reads pause when client buffers are full.
- Per-stream buffers have hard byte and event limits.
- Slow clients may be disconnected with a resumable status where supported.
- Telemetry export uses bounded queues and disk-backed spill for critical events.
- Offline consumers cannot block response streaming.

## Hot configuration

Signed snapshots are loaded off the request path, validated, and atomically swapped. A malformed snapshot is rejected without affecting the current version.

Emergency revocations use a small high-priority channel and override ordinary snapshot activation.

## Disaster recovery

- Regional cells are independently deployable.
- DNS or global traffic management removes unhealthy regions.
- Control-plane data replicates to a recovery region.
- Signed snapshots are stored across failure domains.
- Provider credentials can be reissued without application changes.
- Recovery exercises include policy and budget correctness, not only traffic restoration.

## Capacity testing

Test dimensions include:

- Short versus long responses
- Streaming connection duration
- Tool-call pauses
- Large schemas and context
- Mixed tenant priorities
- Provider rate-limit waves
- Registry snapshot size
- Telemetry degradation
- Cancellation storms

Tests report saturation point and graceful-degradation behavior.

## Graceful degradation

Possible degraded modes:

- Deterministic routing only
- Cached classification only
- Reduced explain detail
- Delayed noncritical analytics
- Disabled shadow traffic
- Disabled semantic validation for low-risk policies
- Single-region control-plane writes

Security, policy, budget, and billing correctness do not degrade silently.

## Operational runbooks

Required runbooks:

- Disable model configuration
- Isolate provider region
- Rotate provider credential
- Roll back registry snapshot
- Resolve budget-authority failure
- Drain router cell
- Recover telemetry backlog
- Handle provider protocol change
- Investigate quality regression
- Perform regional failover

## Tests

- Deadline propagation
- Retry and idempotency properties
- Circuit segmentation
- Bulkhead saturation
- Backpressure memory bounds
- Snapshot rollback
- Regional failover
- Chaos provider responses
- Long-lived stream soak tests
