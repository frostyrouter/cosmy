# Durable credential lifecycle

PostgreSQL deployments can rotate and revoke tenant credentials without restarting the router or adding a database query to request authentication.

## API

All endpoints require `admin:write`, except listing, which accepts `admin:read`.

- `GET /v1/admin/credentials` lists durable credential metadata without key digests.
- `POST /v1/admin/credentials` accepts `id`, `tenantId`, a lowercase 64-character `keySha256`, and one or more scopes.
- `POST /v1/admin/credentials/{id}/disable` idempotently disables a durable credential.

Cosmy never generates, receives, logs, stores, or returns the plaintext key through this API. Generate at least 256 bits of cryptographically secure entropy externally, distribute the plaintext once through an approved secret manager, and submit only its SHA-256 digest.

## Runtime behavior

Startup merges enabled static bootstrap credentials with enabled rows from `api_credentials` into an immutable in-memory digest map. Authentication remains one SHA-256 calculation and one map lookup. A successful local create/disable refreshes the map immediately. Other instances poll every `CREDENTIAL_REFRESH_SECONDS` (default 2), so the cross-instance revocation window is bounded by that interval plus query time. Refresh failure increments `credential_refresh_failure` and preserves the previous known-good snapshot.

Mutations and their `credential.create` or `credential.disable` audit event commit in one PostgreSQL transaction. Exact create retries return the existing row; disable retries return the already-disabled row. Conflicting IDs/digests return `409`. An advisory transaction lock prevents concurrent operations from disabling every durable `admin:write` credential.

## Bootstrap and rotation

1. Start with a high-entropy static `admin:write` bootstrap credential.
2. Create two durable administrative credentials.
3. Verify both on every router instance.
4. Remove the static bootstrap value from deployment configuration and perform one final rolling restart; static credentials remain configuration-owned and cannot be revoked by the durable API.
5. Rotate application keys by creating the replacement, moving clients, observing successful use, then disabling the old durable key.

Migration `012_api_credentials.sql` stores only digests, validates identifiers and scopes, and never references plaintext secrets. OAuth/workload identity and push-based invalidation remain outside this milestone.
