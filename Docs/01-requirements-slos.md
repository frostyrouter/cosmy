# Requirements and service objectives

Status: Proposed. Numeric targets must be calibrated with load tests and business requirements before general availability.

## Capacity model

The architecture must not assume a small private deployment. Initial capacity planning uses the following design envelope:

- 10,000 tenants
- 100,000 projects
- 10,000 sustained routed requests per second globally
- 50,000 request-per-second burst capacity
- 100 million decision records per day
- Multi-region active-active API ingress
- Provider fan-out bounded to one primary attempt plus policy-approved fallbacks
- Streaming connections lasting from seconds to tens of minutes

These are design targets, not launch commitments. Components must scale horizontally and expose saturation metrics.

## Functional requirements

### FR-001: normalized generation

The service accepts normalized messages, multimodal content references, tool declarations, output schemas, generation controls, and routing policy hints.

### FR-002: compatibility modes

The service offers documented compatibility endpoints for selected external API shapes. Compatibility behavior is covered by golden contract tests.

### FR-003: deterministic constraints

The service filters candidates using effective tenant policy, request requirements, model capabilities, deployment region, provider health, context size, and budget.

### FR-004: classification

The service derives a versioned request feature vector using deterministic rules first and a bounded classifier only when required.

### FR-005: utility ranking

The service ranks eligible configurations using measured quality, estimated cost, latency, reliability, cache likelihood, and switching cost.

### FR-006: streaming

The service preserves incremental output, tool-call deltas, usage updates, terminal status, cancellation, and backpressure across provider adapters.

### FR-007: validation and escalation

Policies may require schema, deterministic, model-based, or application-provided validation. Failed validation may trigger an eligible escalation route.

### FR-008: idempotency

Mutating and billable operations accept idempotency keys. Retries cannot create uncontrolled duplicate provider charges.

### FR-009: budgets

The service enforces project, tenant, user, route, and time-window budgets with reservation and reconciliation.

### FR-010: model lifecycle

Operators can register, test, shadow, canary, activate, drain, deprecate, and disable model configurations without router deployment.

### FR-011: policy simulation

Operators can replay historical request features through proposed policies and registries without provider invocation.

### FR-012: explainability

Authorized users can retrieve decision summaries that contain constraints, candidate scores, selected route, and versions without revealing secrets or hidden reasoning.

### FR-013: tenant isolation

Credentials, caches, logs, budgets, policies, and evaluation data are isolated by tenant and project.

### FR-014: auditability

Administrative changes and routing decisions produce tamper-evident audit events.

### FR-015: cloud neutrality

Core services run on standard containers and open protocols. Managed services may be used through interfaces with documented self-hosted alternatives.

## Non-functional requirements

### Availability

- Router ingress monthly availability target: 99.99%
- Control-plane monthly availability target: 99.9%
- A provider outage must not make the router unavailable when an eligible fallback exists.
- Administrative control-plane degradation must not stop data-plane requests using cached signed snapshots.

### Latency

- Router processing overhead, excluding classifier and provider: P95 below 25 ms within a region
- Deterministic classification and candidate filtering: P95 below 10 ms
- Cached route decision: P95 below 5 ms
- Classifier invocation is excluded from the base overhead SLO and separately budgeted.
- The router must not buffer a complete provider response before streaming.

### Durability

- Accepted policy and registry changes: no acknowledged-loss target
- Billing ledger and audit records: durable before final reconciliation acknowledgement
- High-volume telemetry may use at-least-once delivery with deduplication.

### Consistency

- Route decisions use one immutable registry snapshot and one immutable policy snapshot.
- Budget reservations require strongly consistent accounting within the budget scope.
- Analytics may be eventually consistent.

### Security

- TLS for every network hop
- Envelope encryption for provider credentials
- Short-lived workload identity between services
- No raw provider key exposure to applications or logs
- Explicit authorization for explain, replay, and administrative APIs

### Privacy

- Content logging disabled by default
- Configurable zero-retention execution mode
- Regional processing and storage controls
- Redaction before observability export
- Tenant-defined provider and feature allowlists

### Maintainability

- Each provider adapter owns its translation and conformance suite.
- Routing algorithms are versioned and replayable.
- Public APIs use explicit versioning and compatibility policy.
- Schema changes support rolling deployment.

## Service-level indicators

### Request availability SLI

Successful terminal outcomes divided by eligible requests. Client validation errors and policy rejections are reported separately and do not hide infrastructure failures.

### Time-to-first-event SLI

Elapsed time from accepted request to first normalized stream event, segmented into router queue, classification, provider queue, and provider generation time.

### Completion latency SLI

Elapsed time from accepted request to terminal event. Report by task family, provider, model, streaming mode, and output size.

### Routing correctness SLI

Percentage of executed decisions that satisfy all reconstructed hard constraints. Target is 100%; any violation is a severity-one defect.

### Quality-floor SLI

Percentage of evaluated production samples that meet tenant-defined quality floors.

### Cost accuracy SLI

Difference between provider-reported usage cost and ledger-computed cost, accounting for delayed provider billing adjustments.

## Error budget policy

- Routing correctness has no normal error budget.
- Availability and latency error budgets control release velocity.
- Quality regressions stop model promotion and can automatically drain a model profile.
- Budget-accounting uncertainty causes conservative reservation or rejection, not unlimited execution.

## Load and chaos scenarios

The release test plan must cover:

- Sudden 10x tenant traffic burst
- One provider returning rate limits globally
- One provider region failing mid-stream
- Slow provider streams that exhaust connection pools
- Registry distribution lag
- Budget-store partial outage
- Telemetry pipeline outage
- Classifier timeout
- Invalid provider event sequences
- Duplicate client retries
- Long-context requests near model limits
- Tool calls with very large schemas
- Cancellation during classification, provider streaming, tool wait, and fallback

## Acceptance gates for implementation

General availability requires evidence that:

- Hard constraints are reconstruction-tested from decision records.
- Provider adapters pass golden request, response, stream, tool, usage, and error tests.
- Budget enforcement remains correct under concurrent reservations.
- Regional failover preserves tenant policy.
- Registry rollback completes without application deployment.
- Shadow evaluations detect an intentionally degraded model.
- On-call operators can isolate a provider or model within minutes.
