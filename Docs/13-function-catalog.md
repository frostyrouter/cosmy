# Function and module catalog

Status: Proposed implementation contract.

This catalog names the initial modules and public functions. Names may change during implementation, but responsibilities and boundaries should remain stable unless an ADR supersedes them.

## `api/authenticateRequest`

Purpose: authenticate the caller and return immutable tenant, project, principal, environment, and scope context.

Inputs: authorization headers, mTLS identity, endpoint, request metadata.

Outputs: `AuthContext`.

Errors: missing credential, invalid credential, expired credential, revoked principal, unsupported auth mode.

Invariants: never returns provider credentials; never logs raw credentials.

Tests: key hash verification, scope matrix, revocation, tenant isolation, malformed headers.

## `api/authorizeOperation`

Purpose: verify that an authenticated principal may invoke an endpoint and requested feature.

Inputs: `AuthContext`, operation, resource identifiers.

Outputs: `AuthorizationDecision` with policy evidence.

Errors: forbidden operation or resource.

Tests: complete role/scope matrix and deny precedence.

## `api/normalizeRequest`

Purpose: transform normalized or compatibility payloads into `CanonicalRequest`.

Inputs: endpoint dialect, parsed payload, content headers.

Outputs: immutable canonical request and compatibility warnings.

Errors: invalid schema, unsupported semantic, oversized content, unsafe reference.

Invariants: no silent semantic loss; deterministic for the same input and schema version.

## `api/encodeResponseEvent`

Purpose: serialize a canonical event into the selected public API dialect.

Inputs: canonical event, API version, compatibility mode.

Outputs: bytes and event metadata.

Errors: unsupported event mapping.

Tests: golden event streams, multibyte boundaries, unknown forward-compatible events.

## `policy/resolveEffectivePolicy`

Purpose: merge organization, tenant, project, credential, session, and request constraints.

Inputs: policy snapshot, `AuthContext`, canonical request.

Outputs: immutable `EffectivePolicy` and provenance.

Invariants: deny overrides allow; request cannot relax parent policy.

Tests: precedence property tests and unauthorized relaxation attempts.

## `usage/estimateRequestUsage`

Purpose: estimate tokens, media units, tools, output size, expected cost, and worst-case cost.

Inputs: canonical request, model configuration candidates, pricing snapshot.

Outputs: `UsageEnvelope` with uncertainty.

Errors: unsupported tokenizer, missing pricing under strict policy.

Tests: tokenizer fixtures, media fixtures, long-context multipliers, cache cases.

## `budget/reserveBudget`

Purpose: atomically reserve allowed spend before provider execution.

Inputs: account scope, usage envelope, effective policy, idempotency key.

Outputs: `BudgetReservation`.

Errors: budget exceeded, account locked, authority unavailable.

Invariants: concurrent reservations cannot exceed configured tolerance.

## `budget/reconcileBudget`

Purpose: convert provider usage into ledger entries and settle a reservation.

Inputs: reservation, canonical usage, pricing version, attempt records.

Outputs: reconciliation summary.

Invariants: idempotent; corrections append; unknown usage is not zero.

## `features/applyDeterministicRules`

Purpose: classify obvious tasks and derive features without model invocation.

Inputs: canonical request, rule bundle.

Outputs: partial features, evidence, and confidence.

Tests: versioned fixtures for task families, languages, modalities, and adversarial prompts.

## `features/classifyRequest`

Purpose: fill uncertain semantic features using a bounded classifier.

Inputs: redacted canonical request, partial features, classifier configuration.

Outputs: schema-validated classifier result.

Errors: timeout, invalid output, provider unavailable.

Invariants: classifier cannot modify policy; output ranges are validated.

## `features/extractRequestFeatures`

Purpose: orchestrate deterministic rules, optional classifier, token estimates, and evidence composition.

Inputs: canonical request, effective policy, route context.

Outputs: complete `RequestFeatures`.

Tests: classifier bypass, fallback behavior, confidence calibration.

## `registry/expandModelConfigurations`

Purpose: expand registry models into selectable configurations.

Inputs: immutable registry snapshot.

Outputs: ordered model configurations.

Invariants: deterministic ordering; disabled lifecycle states excluded or marked.

## `routing/filterEligibleConfigurations`

Purpose: apply all hard constraints and record rejection reasons.

Inputs: configurations, canonical request, features, policy, provider health.

Outputs: accepted candidates and rejected candidates.

Invariants: accepted candidates satisfy every hard constraint.

Tests: one property test per constraint plus combinations and empty-set behavior.

## `routing/estimateCandidateQuality`

Purpose: estimate task success from evaluation profiles and feature similarity.

Inputs: candidate, request features, evaluation snapshot.

Outputs: mean, lower bound, uncertainty, evidence references, freshness.

Errors: insufficient evidence under strict quality policy.

## `routing/estimateCandidateLatency`

Purpose: predict time to first token and completion distributions.

Inputs: candidate, request size, expected output, current operational profile.

Outputs: latency quantiles and deadline probability.

## `routing/estimateCandidateCost`

Purpose: estimate total route cost including cache, tools, router overhead, and expected fallback.

Inputs: candidate, usage envelope, pricing and operational profiles.

Outputs: expected and upper-bound cost.

## `routing/scoreEligibleConfigurations`

Purpose: compute normalized utility for eligible candidates.

Inputs: candidates with estimates, effective objective weights.

Outputs: deterministic ordered scores and component breakdown.

Invariants: cannot receive rejected candidates; tie-breaker is stable.

## `routing/constructRoutePlan`

Purpose: choose primary, fallbacks, validation, deadlines, and attempt ceilings.

Inputs: ranked scores, reservation, policy, confidence.

Outputs: immutable `RoutePlan`.

Invariants: every attempt is eligible and total plan fits budget/deadline envelopes.

## `execution/executeRoutePlan`

Purpose: run attempts, stream events, invoke validation, and stop correctly.

Inputs: route plan, canonical request, cancellation signal.

Outputs: canonical response stream and terminal outcome.

Side effects: provider calls, ledger events, decision updates.

Tests: cancellation races, provider failure, validation escalation, deadline exhaustion.

## `execution/acquireProviderPermit`

Purpose: enforce provider, endpoint, model, tenant, and priority concurrency limits.

Inputs: attempt configuration and remaining deadline.

Outputs: lease with expiry.

Errors: queue timeout, circuit open, load shed.

## `execution/runAttempt`

Purpose: invoke one adapter and enforce attempt-level protocol and deadlines.

Inputs: attempt, request, credential lease, cancellation signal.

Outputs: canonical provider-event iterable and attempt summary.

Invariants: exactly one terminal attempt status; buffers remain bounded.

## `validation/validateResponse`

Purpose: execute the route plan’s validators in defined order.

Inputs: canonical response, request, validation plan.

Outputs: pass, fail, indeterminate, evidence, and escalation recommendation.

Invariants: grader output is untrusted; deterministic failures cannot be overridden by prose.

## `adapters/validate`

Purpose: prove that a provider adapter can preserve request semantics without network I/O.

Inputs: canonical request and model configuration.

Outputs: support result, issues, and safe transformations.

## `adapters/execute`

Purpose: translate and execute a native provider request and emit canonical events.

Inputs: `AttemptContext` containing request, config, credentials, deadlines, and trace context.

Outputs: asynchronous canonical event sequence.

Errors: only normalized provider errors escape the adapter boundary.

## `adapters/normalizeError`

Purpose: map native status, body, headers, and transport failures into retry semantics.

Inputs: unknown native error and attempt context.

Outputs: `CanonicalProviderError`.

Invariants: secrets and unsafe provider content are redacted.

## `adapters/reconcile`

Purpose: map provider usage units to versioned cost entries.

Inputs: canonical provider usage and pricing schedule.

Outputs: cost breakdown with source evidence.

## `decisions/recordDecision`

Purpose: persist the immutable route decision and attempt summaries.

Inputs: decision record and retention policy.

Outputs: durable acknowledgement and event IDs.

Invariants: content handling follows retention class; billing-critical data is durable.

## `snapshots/verifySnapshot`

Purpose: validate signature, digest, schema, validity window, and version progression.

Inputs: encoded snapshot and trusted signing metadata.

Outputs: verified immutable snapshot.

Errors: invalid signature, incompatible schema, rollback violation, expired snapshot.

## `snapshots/activateSnapshot`

Purpose: atomically replace the active router snapshot after verification and warmup.

Inputs: verified snapshot.

Outputs: activation record.

Invariants: in-flight requests retain their original snapshot reference.

## `registry/promoteModel`

Purpose: perform an authorized lifecycle transition after checking gates.

Inputs: model configuration, target state, evaluation evidence, approvals.

Outputs: new registry version and audit event.

Errors: invalid transition, stale evidence, missing approval, failed gate.

## `evals/runEvaluationSuite`

Purpose: execute versioned cases against configurations and graders.

Inputs: suite, candidate configurations, run controls, budget.

Outputs: immutable evaluation run with metrics and artifacts.

Invariants: side-effecting customer tools are disabled; provenance is complete.

## `evals/computeModelProfile`

Purpose: aggregate evaluation evidence into task quality distributions.

Inputs: accepted evaluation runs and statistical configuration.

Outputs: versioned evaluation profile with confidence bounds.

## `operations/updateCircuitState`

Purpose: update segmented circuit state from errors, probes, and recovery traffic.

Inputs: current state, observation, policy, timestamp.

Outputs: new state and transition event.

Tests: deterministic state-machine and clock-boundary cases.

## `operations/revokeConfiguration`

Purpose: rapidly prevent new selection of a compromised or failing configuration.

Inputs: configuration ID, scope, reason, actor, expiry.

Outputs: signed revocation event and audit record.

Invariants: propagation bypasses ordinary publication delays; revocation cannot enable access.

## Cross-cutting requirements

Every asynchronous function accepts cancellation and deadline context. Every external side effect has idempotency behavior. Every error is typed. Metrics avoid unbounded tenant/model labels. Sensitive values are redacted before logging. Public functions have unit or contract tests and ownership metadata.
