# Tenant security quick guide

Status: implemented for static bootstrap keys, durable PostgreSQL credential rotation/revocation, and cached OIDC JWT workload identity.

## What is guaranteed

| Boundary | Behavior |
|---|---|
| API keys | Runtime configuration stores SHA-256 digests, not plaintext tenant keys. |
| OIDC tokens | Exact issuer/audience, pinned asymmetric algorithms, signature, subject, expiry, issued-at time, tenant claim, and optional token type are verified locally against a bounded cached JWKS. |
| Tenant identity | `/v1/responses` derives the billing tenant from the authenticated credential. |
| Caller overrides | A different `policy.tenantId` is rejected with HTTP 403. |
| Authorization | Response callers need `responses:create`; operators use separate `admin:read` or `admin:write` credentials. |
| Production startup | Startup fails closed without credentials unless `ALLOW_UNAUTHENTICATED=true` is explicit. |
| Probes | `/healthz` and `/readyz` stay unauthenticated and unmetered. |
| Metrics | `/metrics` requires a dedicated `metrics:read` or administrative scope. |

## Configure it

1. Generate a high-entropy API key in your secret manager.
2. Store its lowercase SHA-256 digest in `COSMY_API_CREDENTIALS`.
3. Give the plaintext key to the client once; do not put it in this repository or logs.

```json
[
  {
    "id": "project-a-primary",
    "tenantId": "tenant-a",
    "keySha256": "<64 lowercase hex characters>",
    "scopes": ["responses:create"]
  }
]
```

The client sends `Authorization: Bearer <plaintext-key>`. Static bootstrap credentials still require configuration restart, but PostgreSQL-backed credentials can be created and disabled through the audited admin API without restarting routers. Only SHA-256 digests cross the admin boundary or enter PostgreSQL; operators must generate high-entropy plaintext keys outside Cosmy and deliver them through an approved secret channel. The legacy `COSMY_API_KEY` variable remains available for migration and maps to tenant `default`; new deployments should not use it.

## Safe rollout

| Step | Check | Rollback |
|---|---|---|
| Add digested credentials | Valid key returns 200; invalid key returns 401. | Restore the previous credential set. |
| Move clients | Billing reservations show the credential tenant. | Temporarily retain both old and new digests. |
| Remove legacy key | No traffic uses tenant `default`. | Restore the legacy key from the secret manager. |
| Enforce production | `ALLOW_UNAUTHENTICATED` is absent or false. | Emergency override only; treat it as a security incident. |

## Administrative separation

Do not add admin scopes to ordinary application credentials. `admin:write` can publish the full model registry and change tenant limits; it implies `admin:read`. Duplicate enabled key digests fail startup so one bearer key can never resolve to two tenant identities. See [Control-plane operations](23-control-plane-operations.md).

## Workload identity

Static credentials remain the bootstrap path. Durable hashed project keys and bounded cross-instance revocation are described in [durable credential lifecycle](35-durable-credential-lifecycle.md). For short-lived service identity, configure the OIDC issuer, audience, and JWKS URI together and map only provider-managed claims. Key retrieval happens at startup and in the background, never on the known-key request path. See [cached OIDC workload identity](39-oidc-workload-identity.md).
