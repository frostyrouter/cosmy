# Routing engine

Status: Proposed.

## Objective

Select the executable model configuration with minimum expected total cost that satisfies hard policy constraints and reaches the required probability of task success within the latency objective.

The unit of selection is a `ModelConfiguration`, not merely a model ID. A configuration includes provider, endpoint, model version, reasoning mode, output limit, tool mode, cache policy, service tier, region, and validation plan.

## Routing stages

### Stage 0: request normalization

Normalization produces provider-neutral content, tool, output, and session semantics. If a requested semantic cannot be represented safely, routing stops with `unsupported_feature`.

### Stage 1: deterministic feature extraction

Rules inspect:

- Endpoint and requested operation
- Input modalities
- Output schema
- Tool declarations
- Prompt length and attachment metadata
- Explicit task hints
- Safety and data classifications
- Session history and prior route

Rules produce features and confidence. Obvious transformations such as grammar correction, short summarization, translation, embeddings, transcription, and schema extraction should normally avoid a classifier call.

### Stage 2: bounded semantic classification

If rule confidence is below the effective threshold, invoke an inexpensive classifier with:

- A compact prompt
- No unnecessary tools
- Strict structured output
- Small output limit
- Short deadline
- A classifier version recorded in the decision

Classifier output is untrusted data and must pass schema and range validation.

### Stage 3: hard filtering

Candidate filtering applies:

1. Tenant and project provider allowlists
2. Region and data-processing restrictions
3. Modality support
4. Tool and structured-output support
5. Context and output limits
6. Safety and assurance requirements
7. Model lifecycle state
8. Provider health and circuit state
9. Session-continuation compatibility
10. Maximum estimated cost
11. Latency feasibility
12. Concurrency and quota availability

No weighted score may restore a filtered candidate.

### Stage 4: utility scoring

For request `r`, configuration `m`, and policy `p`:

```text
utility(m,r,p) =
    quality_value(m,r,p)
  - cost_penalty(m,r,p)
  - latency_penalty(m,r,p)
  - reliability_penalty(m,r,p)
  - switching_penalty(m,r,p)
  + cache_benefit(m,r,p)
  + diversity_benefit(m,r,p)
```

The quality term is based on evaluation evidence for similar tasks. The 2D technicality/creativity distance may contribute to similarity but never replaces task-family and capability evidence.

### Stage 5: route-plan construction

The ranker returns:

- Primary configuration
- Zero or more fallback configurations
- Optional escalation configuration
- Validation plan
- Attempt deadlines
- Maximum attempts
- Maximum total cost
- Confidence and score margin

### Stage 6: execution feedback

Provider errors, latency, usage, validation, and application feedback update telemetry. They do not mutate the current request’s algorithm midway except through explicit state transitions.

## Request feature vector

```ts
interface RequestFeatures {
  schemaVersion: string;
  extractorVersion: string;
  taskFamily: TaskFamily;
  taskTags: string[];
  technicalDepth: number;
  creativity: number;
  reasoningDepth: number;
  factualityRequirement: number;
  stakes: number;
  ambiguity: number;
  toolComplexity: number;
  contextTokens: number;
  expectedOutputTokens: number;
  modalities: Modality[];
  requiresStructuredOutput: boolean;
  latencySensitivity: number;
  costSensitivity: number;
  dataClassification: DataClassification;
  confidence: number;
  evidence: FeatureEvidence[];
}
```

Continuous scores are normalized to `[0,1]`. Their meaning is defined by versioned calibration fixtures.

## Quality estimation

Initial quality estimation uses hierarchical lookup:

1. Exact task-family, model-configuration, and evaluation-version evidence
2. Task-family evidence with feature-distance adjustment
3. Parent task-category evidence
4. Model capability prior with high uncertainty

Each estimate includes mean, lower confidence bound, sample count, recency, and distribution-shift indicators. Risk-averse policies rank by a lower confidence bound rather than mean quality.

## Cost estimation

Expected cost includes:

- Uncached input tokens
- Cache write and cache read tokens
- Output tokens
- Reasoning or hidden-compute usage when reported
- Image, audio, video, or document units
- Provider tool charges
- Expected retry and fallback cost
- Router classifier and grader cost
- Currency conversion and contractual adjustments

The estimate references a pricing snapshot. Actual usage is reconciled later.

## Latency estimation

Latency models are segmented by provider, endpoint, model configuration, region, service tier, request-size bucket, output-size bucket, tool mode, and time window.

Predictions include queue time, time to first token, generation rate, tool round trips, and completion latency. A request with a strict deadline may prefer a lower-mean but higher-reliability route.

## Confidence policy

Low confidence occurs when:

- Feature extraction is uncertain
- No relevant model evaluations exist
- Candidate scores are close
- Provider conditions differ from evaluation conditions
- A model or provider is newly onboarded
- Input distribution is anomalous

Policy responses include:

- Choose conservative configuration
- Execute cheap route with synchronous validation
- Shadow one or more alternatives
- Ask the caller for clarification
- Require an explicit model
- Reject high-stakes automatic routing

## Cascades

A cascade is appropriate when a deterministic or inexpensive validator can detect failure more cheaply than always using the strongest model.

Example:

1. Use a fast model for structured extraction.
2. Validate JSON schema and business constraints.
3. If invalid, retry once with repair context or escalate.
4. Stop when success, cost ceiling, attempt ceiling, or deadline is reached.

Cascades are not appropriate when failure is hard to detect, partial output causes irreversible action, or the second attempt would miss the deadline.

## Session stickiness

The router adds a switching penalty when a conversation already has a successful route. Switching is allowed when:

- The task family changes materially
- Required capabilities change
- The provider becomes unhealthy
- Budget policy changes
- The current model repeatedly fails validation
- The caller requests reevaluation

Provider-managed state is represented by an opaque continuation handle. A route cannot switch providers unless canonical replay state is available or the application accepts context loss.

## Cache strategy

Cacheable elements include deterministic classification, token estimates, policy resolution, model eligibility, and stable prompt prefixes. Final generations are cached only when tenant policy and request semantics explicitly allow it.

Cache keys include tenant, policy version, registry version, normalized task signature, tool-schema digest, and relevant request controls. Cross-tenant prompt caches are forbidden.

## Exploration and learning

Production exploration starts in shadow mode. Later, a constrained contextual bandit may select among already eligible candidates. It must obey:

- Hard policy filters
- Maximum exploration budget
- Minimum known quality
- Tenant opt-in
- No exploration for prohibited high-stakes categories
- Reproducible logging of propensity and candidate set

Online learning never directly edits provider capabilities or policy.

## Pseudocode

```ts
async function buildRoutePlan(request: CanonicalRequest, context: RouteContext): Promise<RoutePlan> {
  const policy = await resolveEffectivePolicy(request, context);
  const estimate = estimateRequestUsage(request, policy);
  const reservation = await reserveBudget(estimate, policy, context);

  try {
    const features = await extractRequestFeatures(request, policy, context);
    const configurations = expandModelConfigurations(context.registrySnapshot);
    const eligibility = filterEligibleConfigurations(configurations, request, features, policy, context);
    assertCandidateSetNotEmpty(eligibility);
    const scores = scoreEligibleConfigurations(eligibility.accepted, request, features, policy, context);
    return constructRoutePlan(scores, reservation, request, features, policy, context);
  } catch (error) {
    await releaseBudgetReservation(reservation, error);
    throw error;
  }
}
```

## Routing invariants

- Scoring receives only eligible candidates.
- Every score is reproducible from versioned inputs.
- Every rejected candidate has a machine-readable reason.
- The primary and fallback configurations independently satisfy policy.
- Route-plan cost cannot exceed the reservation envelope.
- The ranker cannot inspect provider credentials or raw tenant secrets.
- Hidden model reasoning is never required for explainability.

## Test strategy

- Property tests for hard-constraint preservation
- Golden fixtures for feature extraction
- Deterministic replay tests
- Score monotonicity tests
- Budget and deadline boundary tests
- Distribution-shift simulations
- Cascade stop-condition tests
- Session-switch compatibility tests
- Shadow-routing comparison tests
- Adversarial classifier-output tests
