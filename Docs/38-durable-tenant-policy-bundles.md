# Durable tenant policy bundles

PostgreSQL-backed tenant policies enforce non-relaxable routing constraints without adding a database query to each response.

## Administrative API

```http
GET /v1/admin/tenants/{tenantId}/policy
PUT /v1/admin/tenants/{tenantId}/policy
Authorization: Bearer <admin-credential>
If-Match: <current-policy-version>
X-Change-Reason: <ticket-or-explanation>
```

Use `If-Match: 0` to create the first policy. Every successful full replacement increments its tenant-local version; stale or duplicate mutations return `409 policy_version_conflict`. `X-Change-Reason` is required and committed in the audit event. An empty object is a valid replacement that clears all constraints while retaining version history and audit evidence.

Supported constraints are provider/model allowlists and denylists, allowed regions and data classes, maximum request cost and latency, minimum quality, and fallback permission. Request fields may tighten these values: allowlists intersect, denylists union, numeric maxima take the lower value, quality takes the higher value, and either side can disable fallback. A request cannot expand an operator bundle.

## Runtime and consistency

Routers load all policy bundles into an immutable in-memory map. A successful local update replaces the snapshot immediately; peers poll every `POLICY_REFRESH_SECONDS` (default 2). Only the newest-started refresh may apply, so a slow stale query cannot overwrite a newer snapshot. Failures preserve the prior known-good policy map and increment `policy_refresh_failure`.

The response hot path performs one tenant map lookup and bounded set operations—never a policy database read. Model discovery uses the same provider/model visibility constraints. Routing decisions stamp the tenant policy version into `policyVersion`, supporting replay and audit correlation.

Apply migration `015_tenant_policy_bundles.sql`. Policy mutation and `policy.set` audit commit in one transaction under a tenant-specific advisory lock. OAuth identity claims, legal-purpose rules, retention/deletion workflows, and push-based invalidation remain separate milestones.
