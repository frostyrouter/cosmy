# Cached OIDC workload identity

Status: implemented for signed JWT bearer access tokens.

## Purpose and boundary

Cosmy exposes one authentication surface: `Authorization: Bearer <credential>`. The authenticator first checks configured static/durable API keys, then verifies OIDC JWTs. Both resolve to the same internal principal shape (`credentialId`, `tenantId`, and scopes), so routing and authorization remain independent of credential type.

Cosmy verifies tokens; it does not run an authorization-code flow, issue or refresh tokens, discover an issuer dynamically, introspect opaque tokens, or manage an identity provider. Opaque OAuth tokens are not accepted.

## Required token profile

The deployment explicitly configures an HTTPS issuer, expected audience, and HTTPS JWKS URI. A token must have:

- a signature made by a current cached asymmetric JWKS key with a unique `kid`;
- an allowed algorithm (`RS256` by default; optionally `PS256`, `ES256`, or `EdDSA`);
- exact `iss` and `aud` matches plus non-empty `sub`, `exp`, and `iat` claims;
- age no greater than `OIDC_MAX_TOKEN_AGE_SECONDS`, subject to the configured clock tolerance;
- a syntactically safe string tenant claim; and
- the configured `typ` header when `OIDC_TOKEN_TYPE` is set.

The principal identifier is a stable truncated SHA-256 digest of issuer and subject, so raw external subject values do not enter Cosmy audit records. Only recognized Cosmy permissions with `OIDC_SCOPE_PREFIX` are mapped. With the default prefix, `cosmy:responses:create` becomes `responses:create`; unrelated claims are ignored. Treat any identity-provider rule capable of issuing `cosmy:admin:write` as privileged production infrastructure.

## Low-latency and rotation model

Startup synchronously fetches and validates one JWKS. Failure aborts startup. Successful key material is compiled into a local verifier; ordinary requests perform local signature and claim verification with no network or database call.

The router refreshes keys in the background every `OIDC_JWKS_REFRESH_SECONDS`. An unknown `kid` fails that request immediately and triggers a single-flight background refresh—it never makes the request wait on the identity provider. After rotation is fetched, new tokens succeed and removed keys fail. A refresh error preserves the last known-good keys until `OIDC_MAX_JWKS_STALE_SECONDS`; after that bound, OIDC authentication fails closed. `oidc_jwks_refresh_failure` records scheduled and unknown-key refresh failures.

This trades the first request after an unannounced rotation for predictable request latency. Identity-provider operators should overlap old and new public keys for at least the refresh interval plus clock skew. Keep access tokens short-lived; Cosmy has no per-token revocation or introspection call.

## Configuration

Configure all three identity values or none:

```dotenv
OIDC_ISSUER=https://identity.example.com
OIDC_AUDIENCE=cosmy-router
OIDC_JWKS_URI=https://identity.example.com/.well-known/jwks.json
OIDC_ALGORITHMS=RS256
OIDC_TENANT_CLAIM=tenant_id
OIDC_SCOPE_CLAIM=scope
OIDC_SCOPE_PREFIX=cosmy:
OIDC_TOKEN_TYPE=at+jwt
OIDC_MAX_TOKEN_AGE_SECONDS=3600
OIDC_CLOCK_TOLERANCE_SECONDS=5
OIDC_JWKS_REFRESH_SECONDS=300
OIDC_MAX_JWKS_STALE_SECONDS=86400
OIDC_REQUEST_TIMEOUT_MS=2000
```

Do not derive `OIDC_JWKS_URI` from an untrusted token or accept symmetric algorithms. Pin configuration through reviewed deployment manifests and restrict outbound traffic to the expected identity endpoint.

## Rollout and rollback

1. Create a dedicated audience and tenant/scope claim mapping in the identity provider.
2. Start a non-production router with OIDC plus an existing admin API key. Confirm a correct token succeeds, a wrong audience returns 401, and a cross-tenant override returns 403.
3. Run `npm run bench:oidc` on deployment-class hardware and compare it with the end-to-end SLO. The script asserts exactly one JWKS fetch.
4. Alert on `oidc_jwks_refresh_failure`; test a key overlap rotation and identity-provider outage before production.
5. Roll back by removing all three required OIDC settings and restarting. Existing API-key authentication is unaffected.

## References

- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)
- [OpenID Connect Discovery 1.0](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [RFC 8725: JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725)
- [`jose` JWT/JWK implementation](https://github.com/panva/jose)
