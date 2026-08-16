# Emergency model disable

Operators can remove one model from routing immediately without editing or resubmitting a full registry snapshot.

```http
POST /v1/admin/models/disable
Authorization: Bearer <admin-write-key>
If-Match: <current-registry-version>
Content-Type: application/json

{"modelId": "provider:model-id", "reason": "elevated provider error rate"}
```

Cosmy requires the current registry version, rejects stale commands, refuses to disable the last enabled model, and returns `404` if the model is absent. Repeating a disable against the current version is an idempotent no-op. A retry using the pre-mutation version returns `409 registry_version_conflict`, preventing duplicate incident commands from overwriting newer operator work.

The operation does not mutate the model version or an existing snapshot. It copies the current registry into a new monotonic snapshot and changes only the target model's `enabled` lifecycle flag. PostgreSQL serializes it with publication and rollback, then commits the snapshot and `models.disable` audit event atomically. The local router activates it immediately; other instances converge through normal registry polling.

Apply migration `014_emergency_model_disable.sql`. The audit event includes model ID/version, provider, previous registry version, and operator reason. Re-enable through a normal validated publication so promotion evidence and immutable-version checks remain enforced.
