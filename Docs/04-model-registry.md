# Model registry and onboarding

Status: Proposed.

## Purpose

The model registry is the source of truth for executable model configurations and their evidence. It allows model additions, updates, deprecations, and emergency disables without changing application code or retraining the router.

## Core records

### Provider

Defines provider identity, adapter type, endpoints, supported authentication modes, regions, status source, billing source, and organizational ownership.

### Model

Defines provider model ID, immutable version or alias behavior, modalities, context limits, output limits, tool features, structured-output support, lifecycle dates, and primary documentation references.

### Model configuration

Defines selectable controls such as reasoning effort, service tier, region, cache mode, tool mode, and output cap. The router scores configurations because these controls materially change quality, cost, and latency.

### Pricing schedule

Defines effective time, currency, unit prices, cache prices, tool charges, long-context multipliers, batch or priority pricing, and contractual overrides.

### Evaluation profile

Defines measured quality by task family, feature bucket, evaluation suite, dataset version, grader version, sample count, uncertainty, and execution environment.

### Operational profile

Defines observed latency, errors, throughput, rate limits, circuit state, and regional health.

## Example manifest

```yaml
apiVersion: registry.cosmy.ai/v1alpha1
kind: Model
metadata:
  id: provider/model-version
  owner: model-platform
spec:
  adapter: provider-messages-v1
  lifecycle: shadow
  modalities:
    input: [text, image]
    output: [text]
  capabilities:
    streaming: true
    tools: true
    parallelTools: true
    structuredOutput: true
  limits:
    contextTokens: 200000
    maxOutputTokens: 32000
  regions: [region-a, region-b]
  documentation:
    - https://provider.example/docs/model
```

Prices and measured results are separate records so they can change independently.

## Lifecycle

```text
DRAFT -> CONFORMANCE -> EVALUATING -> SHADOW -> CANARY -> ACTIVE
   |          |              |           |         |
   +----------+--------------+-----------+---------+-> REJECTED
ACTIVE -> DRAINING -> DEPRECATED -> RETIRED
ACTIVE -------------------------------> DISABLED
```

### Draft

Metadata is incomplete and unavailable to routing.

### Conformance

Adapter tests verify request translation, streaming, tools, errors, cancellation, and usage parsing.

### Evaluating

Offline suites measure capabilities and task quality.

### Shadow

Production requests are scored or duplicated under strict privacy and budget controls, but responses are not served.

### Canary

A small eligible traffic percentage receives the model with automatic rollback gates.

### Active

The model can be selected according to policy.

### Draining

No new sessions begin; compatible existing sessions may finish.

### Disabled

Emergency state distributed through the revocation channel. No route may select the configuration.

## Onboarding workflow

1. Submit provider and model manifests.
2. Validate schema and documentation sources.
3. Probe capabilities in a non-production project.
4. Run adapter conformance tests.
5. Run standard evaluation suites.
6. Generate an initial quality profile with uncertainty.
7. Verify pricing and usage reconciliation.
8. Enable shadow scoring.
9. Review distribution-shift and safety results.
10. Canary with explicit traffic and cost caps.
11. Promote after acceptance gates pass.

No router training is required. The registry snapshot changes and the existing filter/ranker consumes the new evidence.

## Automatic metadata refresh

Automated jobs may discover provider model lists, limits, and status. Discovered changes remain proposed until validation. Automatic jobs must never silently widen tenant access or replace a pinned immutable model version.

## Alias policy

Aliases may move to new underlying versions. Production policies choose among:

- Immutable version required
- Provider alias allowed
- Cosmy-managed stable alias
- Automatic latest after evaluation gate

Every decision records the requested alias and provider-reported resolved model when available.

## Deprecation policy

- Detect provider notices from primary sources.
- Mark impact and replacement candidates.
- Run replacement evaluations.
- Notify affected tenants.
- Support dual-running and replay.
- Block new projects before existing projects when appropriate.
- Drain before provider shutdown.

## Registry consistency

Registry mutations create immutable versions. A signed snapshot is activated atomically in each router cell. Requests never combine records from multiple versions.

## Ownership and approvals

- Provider integration owner approves adapter metadata.
- Evaluation owner approves quality profiles.
- Finance owner approves pricing rules.
- Security owner approves regions, retention, and credential mode.
- Operations owner approves canary and active lifecycle states.

Separation of duties can be relaxed in development but is mandatory for production governance.

## Tests

- Manifest schema tests
- Duplicate and alias-cycle detection
- Effective-date pricing tests
- Capability probe comparison
- Snapshot signature and rollback tests
- Lifecycle transition tests
- Emergency-disable propagation tests
- Historical decision reconstruction tests
