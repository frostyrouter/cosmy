# Routing decision, simulation, and model query APIs

Status: Implemented for tenant-scoped decision reads, deterministic simulation, and rollout-visible model discovery.

## Authorization

All three query endpoints require the `routing:read` scope when authentication is configured. Decision lookup always includes the authenticated tenant in the storage key; knowing another tenant's decision ID is insufficient to retrieve it.

## Durable decision records

`GET /v1/routing/decisions/{decisionId}` returns the route feature vector, eligible selection, alternatives, rejection reason codes, policy version, registry version, and a content-free terminal outcome. Prompts, model output, authorization data, provider request IDs, and arbitrary metadata are never stored in the record.

PostgreSQL mode applies migration `009_route_decisions.sql` and writes the planned decision before budget reservation or provider execution. A failed initial write returns `decision_store_error` before billable work. Terminal updates are best effort: the planned record remains reconstructible and `decision_store_failure` alerts operators if completion metadata cannot be written. Memory mode uses a bounded 10,000-record store for development and single-process testing.

## Deterministic simulation

`POST /v1/routing/simulate` accepts the normalized response request and returns `{ "nonBinding": true, "decision": ... }`. It performs deterministic feature extraction, policy filtering, rollout admission, and ranking without invoking a generation provider or external classifier. The result is non-binding because production classification and health can change the eventual route.

## Visible model discovery

`GET /v1/models` returns enabled models admitted for the authenticated tenant's current rollout assignment. Model IDs and versions are immutable registry identities. Callers must not treat the list as a guarantee that every model can satisfy every request; request-specific policy and capability filtering still applies.

## Operational boundaries

- Decision records currently use the request ID as the decision ID; callers that supply request IDs must keep them unique within a tenant.
- Rejected requests that never produce a route plan do not yet create a decision record.
- PostgreSQL decision retention and export pagination require deployment-specific lifecycle policy.
- Streaming records preserve the planned route and terminal usage, but detailed per-attempt fallback history remains future work.
