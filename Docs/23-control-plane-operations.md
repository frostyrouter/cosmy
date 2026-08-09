# Control-plane operations

Status: Implemented for model snapshots, tenant budgets, and audit reads.

## What operators can change

| Endpoint | Scope | Effect |
|---|---|---|
| `GET /v1/admin/models` | `admin:read` | Read the active immutable registry snapshot |
| `PUT /v1/admin/models` | `admin:write` | Validate and atomically publish a complete snapshot |
| `GET /v1/admin/tenants/:id/budget` | `admin:read` | Read limit, reserved spend, and settled spend |
| `PUT /v1/admin/tenants/:id/budget` | `admin:write` | Set a hard USD limit without dropping below current usage |
| `GET /v1/admin/audit?limit=100` | `admin:read` | Read newest administrative mutations, maximum 500 |

`admin:write` implies read access. Ordinary `responses:create` credentials cannot call these routes. Administrative routes always require authentication, even when the response API is allowed to run unauthenticated in development.

## Safe model publication

Publication replaces the whole registry; it is not a partial patch.

```json
{
  "source": "release:2026-08-09",
  "models": [{ "...": "complete validated model manifest" }]
}
```

Cosmy rejects empty snapshots, duplicate IDs, invalid numeric bounds, output limits larger than context windows, snapshots with no enabled model, and enabled models whose provider is unavailable in the publishing process. PostgreSQL writes manifests and the actor audit event in one transaction, then the router loads that committed version.

Other instances poll the latest snapshot every `REGISTRY_REFRESH_SECONDS` (default 15). Set it to zero only when an external restart/reload mechanism exists. Provider credentials and adapter configuration must be uniform across instances before enabling a new provider.

## Safe budget changes

```http
PUT /v1/admin/tenants/tenant-a/budget
Authorization: Bearer <admin-write-key>
Content-Type: application/json

{"limitUsd": 250.0}
```

Budget creation and request reservation share a tenant advisory lock. Existing reservation rows are locked while usage is measured, preventing a first-time limit from racing unlimited admission. A limit below `reservedUsd + spentUsd` returns `409 budget_below_usage`. An explicit API limit of zero blocks new paid reservations; this differs from the legacy `TENANT_BUDGET_USD=0` environment default, which means no default limit.

## Audit guarantee

PostgreSQL stores the mutation and its audit event in the same transaction. Events contain actor credential ID, actor tenant, action, target, safe details, and timestamp—never bearer keys or provider secrets.

| Failure | Result |
|---|---|
| Validation or authorization fails | No mutation, no audit row |
| Audit insert fails | Mutation rolls back |
| Process dies after commit | Other routers discover the committed registry version |
| Budget is below current usage | `409`, previous budget remains unchanged |

## Rollout checklist

1. Apply managed migration `005_admin_audit.sql`.
2. Create separate admin credentials; avoid giving application callers admin scopes.
3. Publish a snapshot first in a non-production environment and execute one request per enabled provider.
4. Use `GET /v1/admin/models` to record the resulting version.
5. Monitor refresh failures and audit every production mutation.

## Current boundary

This API manages model metadata and tenant spending. Credential lifecycle, policy bundles, audit export pagination, rollback shortcuts, and workload identity remain later control-plane work. Rollback today means republishing a previously recorded complete snapshot, producing a new monotonic version and audit event.
