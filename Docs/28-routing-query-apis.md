# Routing decision, simulation, and model query APIs

Status: Implemented for tenant-scoped decision reads, deterministic simulation, and rollout-visible model discovery.

## Authorization

All three query endpoints require the `routing:read` scope when authentication is configured. Decision lookup always includes the authenticated tenant in the storage key; knowing another tenant's decision ID is insufficient to retrieve it.

## Durable decision records

`GET /v1/routing/decisions/{decisionId}` returns the route feature vector, eligible selection, alternatives, rejection reason codes, policy version, registry version, a content-free terminal outcome, and candidate-level execution attempts. Prompts, model output, provider error messages, authorization data, provider request IDs, and arbitrary metadata are never stored in the record.

PostgreSQL mode applies migrations `009_route_decisions.sql` and `011_decision_attempts_and_rejections.sql`. It writes a planned decision before budget reservation or generation. Routing and semantic-validation failures write a route-less `rejected` record before returning the error. A failed required write returns `decision_store_error`; terminal execution updates remain best effort so a telemetry outage cannot turn a successful provider response into a client failure. Memory mode uses a bounded 10,000-record store for development and single-process testing.

Each execution attempt records its fallback index, immutable model identity, provider, status, provider-call latency, timestamps, normalized error code, and usage when available. Provider-internal retries are aggregated into their route-candidate attempt. Cache hits have an empty attempt list because no provider executes. See [complete decision evidence](34-complete-decision-evidence.md).

## Deterministic simulation

`POST /v1/routing/simulate` accepts the normalized response request and returns `{ "nonBinding": true, "decision": ... }`. It performs deterministic feature extraction, policy filtering, rollout admission, and ranking without invoking a generation provider or external classifier. The result is non-binding because production classification and health can change the eventual route.

## Visible model discovery

`GET /v1/models` returns enabled models admitted for the authenticated tenant's current rollout assignment. Model IDs and versions are immutable registry identities. Callers must not treat the list as a guarantee that every model can satisfy every request; request-specific policy and capability filtering still applies.

## Operational boundaries

- Decision records currently use the request ID as the decision ID; callers that supply request IDs must keep them unique within a tenant.
- PostgreSQL decision retention and export pagination require deployment-specific lifecycle policy.
- Malformed JSON, body-schema rejection, authentication failure, and rate limiting occur before trusted routing admission and are not routing-decision records; they remain observable through HTTP/operational telemetry.
- Attempt history is candidate-level; retry counts inside a provider adapter are represented by the candidate's final normalized result.
