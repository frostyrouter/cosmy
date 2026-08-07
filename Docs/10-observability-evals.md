# Observability and evaluations

Status: Proposed.

## Observability goals

Operators must distinguish router latency from provider latency, policy rejection from infrastructure failure, cheap success from cheap failure, and model regression from traffic-distribution change.

## Trace model

One request trace contains spans for:

- Edge admission
- Authentication and authorization
- Normalization
- Policy resolution
- Token and cost estimation
- Budget reservation
- Feature extraction and classifier
- Candidate filtering
- Ranking
- Provider queue and execution attempts
- Tool round trips
- Validation
- Ledger reconciliation
- Event publication

Provider request IDs are recorded as protected attributes. Prompt content is excluded by default.

## Metrics

### Router

- Requests and active streams
- Stage latency
- Candidate counts and rejection reasons
- Route confidence and score margin
- Classifier invocation rate
- Cache hits
- Cancellation and fallback rate

### Provider

- Time to first token
- Completion latency
- Output rate
- Rate limits and errors
- Protocol failures
- Reported usage
- Circuit state

### Quality

- Validation pass rate
- Task success estimate
- Quality-floor violations
- User retry/correction signals
- Escalation success
- Shadow disagreement

### Cost

- Estimated and actual cost
- Cost per successful task
- Cost by tenant/task/provider/model
- Reservation variance
- Cache savings
- Router overhead

## Logs

Logs are structured and contain request ID, decision ID, attempt ID, tenant-safe identifier, component, event, outcome, and version references. Content and secrets are excluded unless an explicitly authorized diagnostic session enables scoped capture.

## Alerts

Page on symptoms requiring immediate action:

- Routing constraint violation
- Widespread request failure
- Budget enforcement failure
- Credential exposure indicator
- Billing ledger loss
- Severe latency regression
- Provider protocol incompatibility
- Quality rollback gate

Ticket lower-urgency conditions such as gradual cost drift or evaluation staleness.

## Evaluation taxonomy

### Conformance evaluations

Verify provider and adapter semantics.

### Capability evaluations

Verify modality, tools, structured output, context, and specialized behavior.

### Task-quality evaluations

Measure success on representative user tasks.

### Routing evaluations

Measure whether the router chooses the best eligible configuration under policy.

### Safety and policy evaluations

Verify prohibited routes and high-risk handling.

### Operational evaluations

Measure latency, throughput, reliability, and cost.

## Dataset design

Datasets contain task family, input, required capabilities, expected properties, deterministic checks, reference answers when appropriate, difficulty, risk, language, modality, and provenance.

Split data into development, validation, and hidden holdout sets. Prevent production feedback leakage into holdouts.

## Graders

Preferred order:

1. Exact deterministic checks
2. Schema and programmatic validators
3. Domain-specific rules
4. Human review
5. Model graders with calibration

Model graders use versioned prompts, models, and sampling controls. Their agreement with expert labels is measured.

## Routing metrics

### Regret

Difference between selected-route utility and best eligible observed utility.

### Constraint accuracy

Percentage of decisions that satisfy reconstructed hard constraints. Must be 100%.

### Calibration

Among routes predicted to succeed with probability `p`, approximately `p` should pass the defined outcome.

### Coverage

Fraction of traffic represented by sufficiently recent evaluation evidence.

### Escalation efficiency

Quality recovered by escalation divided by incremental escalation cost and latency.

## Offline promotion gate

A candidate configuration must:

- Pass adapter conformance
- Meet quality floors on required task families
- Stay within cost and latency envelopes
- Show no material safety regression
- Have enough samples for confidence bounds
- Pass holdout evaluation
- Produce reproducible results

## Shadow evaluation

Shadow execution is sampled, budgeted, privacy-checked, and excluded from user responses. Outputs are compared asynchronously. Shadow traffic must not execute customer tools or side effects.

## Canary gate

Canary promotion monitors quality, latency, errors, cost, user retries, and route distribution. Automatic rollback occurs on predefined thresholds with minimum sample safeguards.

## Evaluation freshness

Profiles decay in confidence as provider versions, prompts, traffic, or time change. Stale evidence can lower route confidence or make a configuration ineligible for strict policies.

## Reproducibility

Every run records dataset, model configuration, adapter, provider endpoint class, prompt, grader, policy, code revision, time, and environment. Non-determinism is reported with repeated samples.

## Feedback

User ratings are weak labels. Stronger signals include task completion, accepted edits, test results, retries, model override, support escalation, and downstream business outcomes. Feedback use requires privacy and anti-poisoning controls.
