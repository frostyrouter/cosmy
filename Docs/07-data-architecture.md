# Data architecture

Status: Proposed.

## Data domains

Cosmy separates transactional control data, hot routing snapshots, billing records, audit events, telemetry, evaluation artifacts, and optional request content.

No single database is required to serve every access pattern.

## Classification

| Class | Examples | Default retention | Access |
|---|---|---:|---|
| Public metadata | Provider documentation URLs | Indefinite | Public/read-only |
| Internal metadata | Model profiles, policies | Versioned | Service and admin |
| Confidential | Prices, tenant configuration | Contractual | Tenant-scoped |
| Secret | Provider credentials | Until rotation/deletion | Secret broker only |
| Customer content | Prompts, outputs, attachments | Disabled by default | Explicit policy |
| Audit | Administrative mutations | Long-lived | Security/auditor |
| Billing | Reservations and usage | Financial retention | Finance and tenant |

## Transactional store

Relational storage holds:

- Tenants, projects, principals, and scopes
- Policy definitions and versions
- Registry source records
- Credential references, never plaintext secrets
- Evaluation suite definitions
- Experiments and rollout state
- Idempotency records
- Budget accounts and reservations

Strong consistency is required for authorization, policy publication, lifecycle transitions, and budget reservations.

## Snapshot store

Published snapshots are immutable content-addressed objects. Each includes schema version, payload digest, signature, creation time, activation time, expiry, and parent version.

Router cells cache current and previous known-good snapshots. Snapshot activation is atomic within a process.

## Decision record

```ts
interface RoutingDecisionRecord {
  decisionId: string;
  requestId: string;
  tenantId: string;
  projectId: string;
  createdAt: string;
  policyVersion: string;
  registryVersion: string;
  pricingVersion: string;
  featureVersion: string;
  rankerVersion: string;
  featureDigest: string;
  acceptedCandidates: CandidateSummary[];
  rejectedCandidates: RejectionSummary[];
  selectedConfiguration: string;
  routePlanDigest: string;
  confidence: number;
  attempts: AttemptSummary[];
  validation: ValidationSummary;
  retentionClass: string;
}
```

Content is referenced only when retention policy permits. Digests support reconstruction without retaining raw prompts.

## Billing ledger

The ledger is append-only and double-entry inspired. Event types include:

- Budget reserved
- Reservation adjusted
- Provider usage observed
- Tool charge observed
- Router overhead charged
- Reservation released
- Cost reconciled
- Credit or correction applied

Every monetary event records currency, pricing version, source, idempotency key, and accounting scope. Corrections append entries rather than rewriting history.

## Telemetry pipeline

High-volume events flow through a durable event bus to:

- Metrics aggregation
- Trace storage
- Operational logs
- Cost analytics
- Evaluation sampling
- Abuse detection
- Customer usage exports

Delivery is at least once. Consumers deduplicate using event ID and source sequence.

## Evaluation store

Evaluation data includes suite, dataset, case, model configuration, run, output reference, grader result, environment, seed/control settings, and cost/latency metrics.

Datasets and graders are immutable once used for a promotion decision. Corrections create new versions.

## Content storage

Raw request content is not required for normal routing records. When enabled:

- Store encrypted objects separately from metadata.
- Use tenant-specific encryption context.
- Record lawful purpose and retention class.
- Support selective deletion.
- Prevent content from entering general logs or metrics.
- Use synthetic content in development.

## Partitioning

- Transactional control data partitions primarily by tenant where scale requires.
- Decisions partition by event date and tenant hash.
- Billing partitions by account and accounting period.
- Telemetry partitions by time and service.
- Evaluation artifacts partition by suite and run.

Hot partitions are mitigated with generated IDs and shard-aware ingestion.

## Data lifecycle

1. Classify at creation.
2. Apply encryption and access policy.
3. Retain for minimum necessary period.
4. Compact or aggregate where raw detail is no longer required.
5. Delete according to policy and legal hold.
6. Record deletion evidence without retaining deleted content.

## Migrations

- Use expand-and-contract schema changes.
- Readers tolerate old and new fields during rollout.
- Backfills are rate-limited and observable.
- Snapshot schema upgrades provide compatibility readers.
- Billing migrations require reconciliation fixtures.
- Destructive migrations require backup and tested rollback.

## Recovery objectives

- Control-plane transactional data: low RPO and tested point-in-time recovery.
- Billing and audit: no acknowledged event loss.
- Telemetry: bounded loss may be acceptable by service tier.
- Cached snapshots: reconstructible from signed object storage.
- Evaluation outputs: reproducible or durably stored when used for governance.

## Tests

- Tenant isolation queries
- Concurrent budget reservations
- Ledger idempotency and reconciliation
- Snapshot atomic activation
- At-least-once event deduplication
- Retention and deletion workflows
- Backup restore drills
- Cross-version migration tests
