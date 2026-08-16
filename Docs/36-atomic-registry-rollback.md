# Atomic registry rollback

Operators can restore any older durable model-registry snapshot without reconstructing manifests by hand.

```http
POST /v1/admin/models/rollback
Authorization: Bearer <admin-write-key>
If-Match: <current-registry-version>
Content-Type: application/json

{"targetVersion": 42, "reason": "provider regression incident"}
```

The target must exist, be older than the current version, contain at least one enabled model, and reference only providers configured in the receiving router. `If-Match` is mandatory: if another publication or rollback wins first, Cosmy returns `409 registry_version_conflict` instead of applying a stale operator command.

Rollback never mutates history. PostgreSQL takes the same advisory lock as normal publication, copies the target manifests into a new monotonically increasing snapshot, and writes a `models.rollback` audit event in the same transaction. The local router loads the committed snapshot immediately; other instances converge through `REGISTRY_REFRESH_SECONDS` polling. A retry with the old `If-Match` value is safely rejected.

Apply migration `013_registry_rollback.sql` before using the endpoint. The audit event records target version, previous version, reason, and model count without prompts, provider credentials, or request content.
