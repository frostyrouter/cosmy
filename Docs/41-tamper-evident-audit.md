# Tamper-evident administrative audit

Status: implemented for PostgreSQL administrative mutations.

## Integrity model

Migration 016 adds a monotonic sequence, predecessor hash, and SHA-256 event hash to every administrative audit row. It backfills the existing history in `(occurred_at, id)` order, then makes all chain fields mandatory. Every later writer calls one PostgreSQL function inside the same transaction as its control-plane mutation.

The function takes a transaction-level advisory lock, reads the current head, assigns the next sequence, canonicalizes all event fields as PostgreSQL `jsonb`, calculates the hash, and inserts the row. This prevents concurrent model, policy, budget, rollout, shadow, or credential mutations from forking the chain. An audit failure still rolls back its associated mutation.

`GET /v1/admin/audit/verify` requires `admin:read`. It scans the complete chain and verifies:

- sequences are contiguous from one;
- the genesis predecessor is 64 zeroes;
- every later predecessor equals the prior event hash; and
- every stored event hash matches a fresh calculation over all event fields.

A valid response includes `checkedEvents`, `headSequence`, and `headHash`. Corruption returns HTTP 409 with `valid: false`. The verification scan is control-plane work and adds nothing to message-routing latency.

## Operations

Apply migration 016 in a maintenance window. Backfill updates every historical audit row and requires the `pgcrypto` extension; measure duration and WAL/storage impact on a production-sized copy first. Do not delete individual audit events, because a missing sequence intentionally invalidates the chain.

Run verification after migration, periodically, before compliance exports, and after restoration exercises. Alert on HTTP 409. Persist signed head-hash checkpoints in a separately administered immutable system so later full-database rewriting is detectable.

## Security boundary

The chain detects content edits, deletion, insertion, reordering, and partial hash rewriting. By itself it cannot stop a database superuser from recomputing every hash. External signed/WORM anchoring, database access controls, backups, and restricted retention operations remain necessary. Memory-mode audit is non-durable and reports only its current in-process count; it is not the compliance implementation.
