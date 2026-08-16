# Cosmy architecture documentation

This directory is the design authority for Cosmy. It describes what the platform must do, why each subsystem exists, how components communicate, which invariants implementations must preserve, and how the design can be tested.

The documentation deliberately separates product intent from implementation details. Model names, prices, and provider features change frequently. Stable routing concepts belong in core contracts; volatile provider facts belong in versioned model-registry records.

## Reading order

1. [Product charter](00-product-charter.md)
2. [Requirements and service objectives](01-requirements-slos.md)
3. [System architecture](02-system-architecture.md)
4. [Routing engine](03-routing-engine.md)
5. [Model registry and onboarding](04-model-registry.md)
6. [Public API contracts](05-api-contracts.md)
7. [Provider adapter contracts](06-provider-adapters.md)
8. [Data architecture](07-data-architecture.md)
9. [Reliability and scaling](08-reliability-scaling.md)
10. [Security, privacy, and governance](09-security-privacy.md)
11. [Observability and evaluations](10-observability-evals.md)
12. [Deployment options](11-deployment-options.md)
13. [Delivery roadmap](12-delivery-roadmap.md)
14. [Function and module catalog](13-function-catalog.md)
15. [Alternatives and trade-offs](14-alternatives.md)
16. [Contribution and release policy](CONTRIBUTING.md)

## Fast operator guides

- [Durable persistence and budgets](20-durable-persistence.md)
- [Tenant security](21-tenant-security.md)
- [Safe retries and response caching](22-idempotency-and-cache.md)
- [Control-plane operations](23-control-plane-operations.md)
- [Operational observability](24-operational-observability.md)
- [Model promotion gates](25-model-promotion-gates.md)
- [Controlled canary rollouts](26-controlled-rollouts.md)
- [Safe shadow evaluation](27-safe-shadow-evaluation.md)
- [Routing query APIs and durable decisions](28-routing-query-apis.md)
- [Live health and output validation](29-live-health-and-output-validation.md)
- [Normalized tools and streaming events](30-normalized-tools-and-events.md)
- [Tool-result continuations](31-tool-result-continuations.md)
- [End-to-end deadlines](32-end-to-end-deadlines.md)
- [Shared provider health](33-shared-provider-health.md)
- [Complete decision evidence](34-complete-decision-evidence.md)
- [Durable credential lifecycle](35-durable-credential-lifecycle.md)
- [Atomic registry rollback](36-atomic-registry-rollback.md)
- [Emergency model disable](37-emergency-model-disable.md)
- [Durable tenant policy bundles](38-durable-tenant-policy-bundles.md)
- [Cached OIDC workload identity](39-oidc-workload-identity.md)
- [Provider bulkheads and load shedding](40-provider-bulkheads.md)
- [Tamper-evident administrative audit](41-tamper-evident-audit.md)

## Decision status vocabulary

- **Accepted**: implementation should follow the decision unless superseded by an ADR.
- **Proposed**: preferred direction, awaiting evidence or implementation feedback.
- **Experimental**: safe only behind a feature flag or in shadow traffic.
- **Rejected**: considered and deliberately excluded.
- **Deferred**: valid idea outside the current delivery phase.

## Architecture principles

### Policy before optimization

Privacy, legal, safety, tenant, modality, context, and capability requirements are hard constraints. A utility score cannot override them.

### Quality is measured, not assumed

Marketing labels such as “frontier,” “fast,” or “reasoning” are discovery metadata. Production routing profiles come from reproducible evaluations and observed production outcomes.

### The 2D graph is an explanation layer

Technical depth and creativity are useful dimensions for visualization and coarse task understanding. They are not sufficient for routing. The production feature vector also includes task family, modality, context size, tool requirements, risk, stakes, latency sensitivity, budget, expected output size, privacy, and evaluation evidence.

### Provider neutrality

The public API and internal request model do not expose one provider’s object model as the universal truth. Provider-specific features are represented as declared extensions with explicit portability rules.

### Fail closed on policy and fail over on infrastructure

If policy cannot be proven, reject the route. If a compliant provider is temporarily unavailable, use an eligible fallback when the request permits it.

### Every routing decision is explainable

The decision record must identify applied constraints, considered candidates, normalized scores, selected configuration, fallback plan, registry version, and policy version. Explanations must never expose hidden model reasoning.

### Cost per successful task

Raw token cost is not the primary business metric. The platform minimizes expected cost while meeting quality, safety, reliability, and latency targets. A cheap response that causes retries or human rework is not a saving.

## Stable and volatile information

Stable documentation includes:

- Internal request and response contracts
- Routing stages and invariants
- Failure semantics
- Security boundaries
- Evaluation methodology
- Data ownership and retention rules

Volatile registry data includes:

- Model IDs and aliases
- Provider prices
- Context and output limits
- Supported modalities and tools
- Region availability
- Rate limits
- Deprecation dates
- Measured latency and quality

## Source policy

Provider capabilities must be sourced from primary provider documentation and verified by contract tests. Current references used during this milestone include:

- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI model comparison](https://developers.openai.com/api/docs/models/compare)
- [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Gemini API reference](https://ai.google.dev/api)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)

References inform adapters but do not replace automated compatibility tests.

## Documentation acceptance criteria

A subsystem design is implementation-ready when it defines:

- Purpose and non-goals
- Inputs, outputs, and ownership
- Public and internal contracts
- State transitions
- Security and privacy boundaries
- Timeouts, retries, and idempotency
- Failure modes and fallbacks
- Metrics and service objectives
- Capacity assumptions
- Test strategy
- Rollout and rollback behavior

## Change control

Architectural changes require an ADR when they alter a public contract, security boundary, persistence model, routing invariant, tenancy model, or deployment topology. Typographical and explanatory improvements do not require an ADR.
