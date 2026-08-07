# Delivery roadmap

Status: Proposed.

## Delivery philosophy

Build correctness and evidence before optimization. Each phase produces a deployable, testable capability and explicit exit criteria. Dates depend on team size; gates are more important than calendar promises.

## Phase 0: architecture and threat model

Deliverables:

- Approved public and internal contracts
- Initial threat model
- Data classification and retention policy
- Service objectives and capacity envelope
- Provider documentation matrix
- Evaluation taxonomy
- Architecture decision records for major choices

Exit criteria:

- Security, platform, data, and product owners approve boundaries.
- Open questions have owners and deadlines.
- No implementation depends on an undefined security or billing invariant.

## Phase 1: vertical slice

Build one normalized text endpoint with two provider adapters and deterministic routing.

Deliverables:

- Authentication and project API keys
- Canonical request/response types
- Non-streaming and SSE streaming
- Provider adapter interface
- Static signed registry snapshot
- Deterministic capability filtering
- Basic cost estimation and usage ledger
- Structured logs and traces
- Provider simulators

Exit criteria:

- Golden contract tests pass.
- Cancellation and timeout behavior is defined and tested.
- Every request creates a reconstructible decision record.
- No provider key appears in logs or responses.

## Phase 2: policy and budget control

Deliverables:

- Hierarchical policy resolution
- Provider, model, region, retention, and modality rules
- Strong budget reservations and reconciliation
- Explain and simulate endpoints
- Administrative audit log
- Emergency model disable

Exit criteria:

- Property tests show filtered candidates cannot be selected.
- Concurrent budget tests prevent overspend beyond documented tolerance.
- Snapshot rollback and emergency revocation are demonstrated.

## Phase 3: measured router

Deliverables:

- Request feature extraction
- Bounded structured classifier
- Evaluation data model and runner
- Quality, latency, cost, and reliability profiles
- Utility ranker and deterministic replay
- Route confidence and score explanations

Exit criteria:

- Router beats static baselines on held-out cost per successful task.
- Classification overhead is bounded.
- Quality estimates include uncertainty and freshness.
- Routing decisions replay identically from recorded versions.

## Phase 4: validation and cascades

Deliverables:

- Schema and deterministic validators
- Semantic grader framework
- Escalation route plans
- Attempt and total-cost ceilings
- Application callback validation option

Exit criteria:

- Cascades improve cost without violating quality floors.
- Stop conditions prevent loops and budget overrun.
- Mid-stream failure behavior is visible and tested.

## Phase 5: production hardening

Deliverables:

- Regional cells
- Circuit breakers, bulkheads, and load shedding
- Durable event pipeline
- Multi-region snapshot distribution
- Runbooks, dashboards, alerts, and on-call rotation
- Backup, restore, and disaster-recovery automation
- Penetration and load testing

Exit criteria:

- Target load and burst tests pass with graceful degradation.
- Provider and regional failure exercises pass.
- Security findings are resolved or explicitly accepted.
- Operational SLOs are measurable end to end.

## Phase 6: model lifecycle automation

Deliverables:

- Manifest submission and schema validation
- Capability probes
- Automated conformance and evaluation runs
- Shadow and canary state machine
- Promotion and rollback gates
- Deprecation workflows

Exit criteria:

- A new model reaches canary without router code changes.
- An intentionally degraded model rolls back automatically.
- Alias drift is detected and recorded.

## Phase 7: enterprise and hybrid deployment

Deliverables:

- Workload identity federation
- Tenant-managed provider credentials
- Regional and zero-retention controls
- Customer-hosted data-plane cell
- Private provider connectivity
- Usage and audit export

Exit criteria:

- Tenant isolation and deletion workflows pass external review.
- Hybrid version skew and disconnected operation are tested.
- Customer data-plane upgrades have rollback support.

## Phase 8: constrained adaptive routing

Deliverables:

- Propensity-aware shadow data
- Constrained contextual bandit experiment
- Drift and poisoning protections
- Tenant opt-in and exploration budgets

Exit criteria:

- Adaptive policy improves held-out and canary utility.
- Hard constraints remain independently enforced.
- Operators can disable learning without disabling routing.

## Team structure

Suggested initial team:

- Platform/API engineers
- Routing and evaluation engineers
- Provider integration engineers
- Data/ledger engineer
- Security engineer
- Site reliability engineer
- Product manager and technical writer

At larger scale, provider adapters and evaluation domains can have dedicated owners.

## Release policy

- Development uses synthetic providers by default.
- Staging uses isolated provider projects and budgets.
- Production changes begin as shadow or canary when behavior changes.
- Ranker, classifier, adapter, policy, and registry versions roll out independently behind compatibility contracts.
- Rollback is defined before rollout begins.

## Definition of done

A feature is complete only when code, tests, telemetry, security review, documentation, rollout, rollback, and operational ownership are present.
