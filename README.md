# Cosmy Model Router

Cosmy is a planned provider-neutral AI model routing platform. Applications send one normalized request to Cosmy; Cosmy selects an eligible provider, model, reasoning configuration, and fallback path using explicit policy, measured quality, cost, latency, and reliability data.

The repository is currently in the architecture-definition milestone. Start with [Docs/README.md](Docs/README.md).

## Project status

- Phase: runnable phase-1 router on `corelogic`
- Implementation: provider-neutral API, classifier-assisted hybrid routing, provider adapters, fallback, persistence, and evaluation harness
- Deployment assumption: cloud-neutral, horizontally scalable, multi-tenant
- Primary optimization target: cost per successful task, subject to quality and policy constraints
- Branch policy: focused commits; draft pull requests only for reasonably reviewable milestones

## Governing principle

The router must choose the least expensive configuration that is predicted to satisfy the request, validate the result where practical, and escalate when evidence indicates that the chosen configuration did not meet the required outcome.
