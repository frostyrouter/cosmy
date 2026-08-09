# Tenant security quick guide

Status: implemented foundation.

## What is guaranteed

| Boundary | Behavior |
|---|---|
| API keys | Runtime configuration stores SHA-256 digests, not plaintext tenant keys. |
| Tenant identity | `/v1/responses` derives the billing tenant from the authenticated credential. |
| Caller overrides | A different `policy.tenantId` is rejected with HTTP 403. |
| Authorization | Response callers need `responses:create`; operators use separate `admin:read` or `admin:write` credentials. |
| Production startup | Startup fails closed without credentials unless `ALLOW_UNAUTHENTICATED=true` is explicit. |
| Probes | `/healthz` and `/readyz` stay unauthenticated and unmetered. |

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

The client sends `Authorization: Bearer <plaintext-key>`. Disable a key by adding `"disabled": true` and restarting the current static configuration. The legacy `COSMY_API_KEY` variable remains available for migration and maps to tenant `default`; new deployments should not use it.

## Safe rollout

| Step | Check | Rollback |
|---|---|---|
| Add digested credentials | Valid key returns 200; invalid key returns 401. | Restore the previous credential set. |
| Move clients | Billing reservations show the credential tenant. | Temporarily retain both old and new digests. |
| Remove legacy key | No traffic uses tenant `default`. | Restore the legacy key from the secret manager. |
| Enforce production | `ALLOW_UNAUTHENTICATED` is absent or false. | Emergency override only; treat it as a security incident. |

## Administrative separation

Do not add admin scopes to ordinary application credentials. `admin:write` can publish the full model registry and change tenant limits; it implies `admin:read`. Duplicate enabled key digests fail startup so one bearer key can never resolve to two tenant identities. See [Control-plane operations](23-control-plane-operations.md).

## Next security milestone

Static credentials are the safe bootstrap path, not the final identity plane. Planned work adds durable hashed project keys, rotation without restart, OAuth/workload identity, and immediate revocation. Administrative mutations are already scope-controlled and durably audited.
