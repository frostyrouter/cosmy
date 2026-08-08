# Alternatives and trade-offs

Status: Proposed decisions.

## Pure 2D nearest-region router

Decision: Rejected as production decision engine; retained as visualization.

Advantages:

- Easy to understand
- Easy to add a model point
- Fast deterministic selection

Problems:

- Cannot represent modality, context, tools, privacy, risk, latency, or reliability
- Regions become hand-tuned and politically difficult
- No uncertainty or evaluation evidence
- A nearby model may be technically ineligible

## One classifier that directly returns a model ID

Decision: Rejected for the authoritative route.

Advantages:

- Simple implementation
- Can understand nuanced language

Problems:

- Model IDs and providers change
- Hard to prove policy preservation
- Classifier cost on every request
- Weak explainability and replay
- Susceptible to prompt injection and distribution drift

Allowed use: bounded feature extraction followed by deterministic filtering and scoring.

## Rules-only router

Decision: Accepted for initial vertical slice; insufficient as final system.

Advantages:

- Predictable and cheap
- Easy to test
- Strong policy control

Problems:

- Rule explosion
- Poor handling of ambiguous tasks
- Slow adaptation to new workloads

## Embedding nearest-neighbor routing

Decision: Experimental quality signal.

Advantages:

- Cheap similarity to evaluated examples
- New models do not require router retraining

Problems:

- Similar wording does not guarantee similar difficulty
- Embedding model changes affect routing
- Hard constraints still require separate enforcement

## Supervised router model

Decision: Deferred.

Advantages:

- Can learn complex interactions
- Low inference cost when trained well

Problems:

- Requires representative labels
- Model and pricing churn create retraining pressure
- Selection bias in historical logs
- Harder governance and explanation

## Contextual bandit

Decision: Experimental after shadow/evaluation maturity.

Advantages:

- Learns from outcomes
- Balances exploration and exploitation

Problems:

- Feedback is delayed and noisy
- Unsafe exploration risk
- Requires propensity logging and anti-poisoning controls

Hard filters remain outside the bandit.

## Cheapest-first cascade

Decision: Accepted only when validation is reliable.

Advantages:

- Strong cost savings for detectable failures
- Simple quality floor enforcement

Problems:

- Doubles latency on escalation
- Can cost more when failure rate is high
- Subjective errors may escape validation

## Always use frontier model

Decision: Supported as a tenant policy, rejected as platform default.

Advantages:

- Operationally simple
- Reduces routing mistakes

Problems:

- High cost and latency
- Wastes specialized and efficient models
- Still does not solve provider availability

## Proxy-only architecture

Decision: Rejected as complete product; accepted as one compatibility surface.

A transparent proxy cannot safely normalize every provider-specific feature. The normalized API is the source of full Cosmy behavior; compatibility endpoints publish explicit limits.

## Microservices from day one

Decision: Rejected.

Begin with a modular control-plane application plus independently scalable router workers. Extract services when scale, security, ownership, or failure isolation provides evidence.

## Serverless-only data plane

Decision: Not the universal default.

Serverless containers can support early workloads, but long streams, connection pools, predictable warm capacity, and high-throughput event handling must be validated. The architecture remains deployable there where constraints fit.

## Single cloud managed services

Decision: Allowed implementation option, not a core contract.

Managed services reduce operational risk. Portability interfaces and self-hosted equivalents preserve strategic options, but perfect drop-in portability is not promised.

## Build versus adopt an existing gateway

Existing AI gateways can accelerate provider connectivity, observability, and compatibility. Options should be evaluated against:

- Semantic normalization quality
- Policy and tenant isolation
- Routing extensibility
- Evaluation integration
- Streaming and tool fidelity
- Billing correctness
- Self-hosting and licensing
- Operational maturity

Cosmy may use libraries or gateway components behind its adapter contract. Core decision evidence, policy, model lifecycle, and evaluation requirements remain product-specific.

## Recommendation summary

Use a hybrid router:

1. Deterministic normalization and rules
2. Optional bounded semantic classifier
3. Hard eligibility filters
4. Evidence-based utility scoring
5. Validation and escalation where economical
6. Shadow evaluation and constrained learning later

This architecture is more complex than a 2D graph, but each layer is independently testable and the model-onboarding goal remains intact.
