# Product charter

Status: Accepted for architecture milestone.

## Problem

AI applications frequently bind every request to one manually selected model. This produces several forms of waste:

- Simple tasks are sent to expensive frontier models.
- Complex or high-stakes tasks are sent to models that cannot reliably satisfy them.
- Applications duplicate provider integration, retries, budgets, telemetry, and fallbacks.
- Model upgrades require code changes in every consuming application.
- Teams optimize token price without measuring task success or downstream rework.
- Provider outages become application outages.

Cosmy solves these problems with a neutral routing control plane and a high-throughput execution data plane.

## Vision

Any application should be able to send a request to one stable API and receive a response from the least expensive eligible model configuration that is likely to meet explicit quality, latency, privacy, safety, and reliability requirements.

Adding a model should be a registry and evaluation operation, not a router retraining project or application release.

## Target users

### Application developers

Developers want one SDK, one authentication model, consistent streaming, stable errors, typed tool calls, and transparent billing metadata.

### Platform teams

Platform teams want centralized budgets, provider governance, regional policy, credentials, audit logs, and outage control.

### Evaluation teams

Evaluation teams want reproducible comparisons, shadow routing, candidate promotion rules, and evidence that cost reductions preserve quality.

### Finance and operations

Finance teams want cost attribution by tenant, application, route, task family, provider, model, and environment.

### Security and compliance

Security teams want provider allowlists, retention controls, data classification, immutable audit records, and enforceable geographic restrictions.

## Product surfaces

### Router API

The Router API receives normalized generation requests and supports synchronous, server-sent event, and asynchronous execution patterns.

### Compatibility APIs

Compatibility endpoints reduce migration cost for applications using common provider formats. Compatibility is intentionally bounded; unsupported provider-specific semantics must fail explicitly rather than be silently discarded.

### Control plane

The control plane manages tenants, policies, model profiles, credentials, budgets, experiments, evaluation suites, provider health, and deployment configuration.

### Explain and simulate APIs

The explain API returns a safe decision summary for a completed route. The simulate API predicts a route without invoking a provider, enabling policy testing and cost forecasting.

### Evaluation service

The evaluation service runs offline benchmarks, shadow comparisons, regression suites, and candidate promotion workflows.

## Primary user journey

1. A tenant creates a project and routing policy.
2. The tenant stores or references provider credentials.
3. The application replaces its provider base URL with Cosmy or uses the normalized SDK.
4. A request arrives with `model: auto` and optional route constraints.
5. Cosmy authenticates, normalizes, classifies, filters, ranks, and executes.
6. Cosmy streams a normalized response.
7. Usage, route evidence, cost, latency, and validation outcomes are recorded.
8. Offline evaluation updates measured model profiles without changing application code.

## Goals

- Support thousands of tenants and high concurrent request volume.
- Remain provider-neutral and cloud-neutral.
- Route text and tool-use workloads first; add richer modalities through capability contracts.
- Reduce expected cost while maintaining tenant-defined quality floors.
- Preserve streaming behavior end to end.
- Support deterministic policy enforcement before probabilistic optimization.
- Make every routing decision auditable and reproducible.
- Onboard new models without retraining the routing service.
- Tolerate individual provider, region, and model failures.
- Enable self-hosted, managed, and hybrid deployment options.

## Non-goals for the first production release

- Training foundation models.
- Becoming a general workflow-orchestration engine.
- Hosting arbitrary customer code inside the request path.
- Guaranteeing semantic equivalence across every provider feature.
- Automatically sending sensitive data to new providers.
- Using production traffic for unconstrained online learning.
- Replacing application-specific business validation.
- Building a consumer chat product.

## Product invariants

### Invariant 1: no ineligible route

The selected configuration must satisfy every hard constraint in the effective policy and request.

### Invariant 2: bounded spend

The router must reserve estimated spend before provider execution and reconcile actual spend afterward. Requests that cannot fit the allowed budget fail before invocation unless an authorized override exists.

### Invariant 3: immutable decision evidence

Every executed route references immutable policy, registry, classifier, and ranker versions.

### Invariant 4: no silent semantic loss

If the normalized request asks for a feature an adapter cannot preserve, the adapter is ineligible or returns a typed capability error.

### Invariant 5: safe fallback

A fallback must independently pass the same hard constraints. Provider availability cannot weaken policy.

### Invariant 6: explicit uncertainty

Low-confidence classification and close candidate scores are recorded. Policy determines whether to choose conservatively, validate, ask for clarification, or reject.

## Success measures

### Quality

- Task success rate by task family
- Quality-floor violation rate
- Validation failure rate
- User retry and correction rate
- Human escalation rate

### Efficiency

- Cost per successful task
- Cost avoided versus configured baseline
- Input, cached-input, output, reasoning, and tool costs
- Router overhead as a fraction of total latency and cost

### Reliability

- Successful request availability
- P50, P95, and P99 time to first token
- P50, P95, and P99 completion latency
- Fallback recovery rate
- Provider circuit-breaker activation rate

### Adoption

- Active tenants and projects
- Requests routed through `auto`
- Models onboarded without application releases
- Percentage of traffic covered by evaluated task families

## Planning changes from the initial concept

The initial technicality-versus-creativity graph remains useful, but the production plan changes in five important ways:

1. The graph becomes a projection for explanation and coarse quality estimation, not the sole router.
2. Capability and governance filters execute before scoring.
3. Routing selects a configuration—not only a model—including reasoning, output limit, tools, cache policy, region, and fallback.
4. Validation and escalation become first-class stages.
5. New models are admitted through manifests, conformance tests, evaluations, shadow traffic, and promotion gates.

These changes make the design testable and defensible at large scale.
