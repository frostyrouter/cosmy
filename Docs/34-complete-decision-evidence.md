# Complete decision evidence

Cosmy persists enough content-free evidence to explain both routing rejection and provider fallback without retaining prompts or outputs.

## Decision states

- `planned`: a route is durably recorded before budget reservation or generation.
- `completed`: execution or cache replay completed; provider attempts and normalized outcome are attached.
- `failed`: a route existed but execution failed.
- `cancelled`: a route existed but the caller cancelled execution.
- `rejected`: trusted request admission completed, but semantic validation, classification, deadline, health, capability, rollout, cost, or latency constraints prevented a route.

A rejected record has no `route`. Its `rejection` contains only the normalized code, HTTP status, retryability, and content-free model rejection reason codes where available. The request ID is generated before routing and returned in the error, allowing an authorized caller to query the record.

## Candidate attempts

Terminal routed records contain an ordered `attempts` array. Each item contains:

- fallback index;
- immutable Cosmy model ID, configured provider model name, and provider;
- `completed`, `failed`, or `cancelled` status;
- provider-call latency and start/completion timestamps;
- normalized error code, never the raw provider message;
- normalized usage when the provider supplied it.

The list is accumulated in memory during one request and included in the existing terminal decision update, avoiding an additional database write per fallback. The planned record remains available after process failure, but attempts that occurred before a process crash and before the terminal update cannot be reconstructed. PostgreSQL retention/export policy remains deployment-owned.

## Boundaries

Malformed transport JSON, request-body schema failures, authentication/authorization failures, and rate limiting happen before trusted routing admission, so they do not create routing decisions. They must be covered by access logs and operational metrics. Provider wrapper retries are aggregated into one candidate attempt; the history explains model fallback, not every network retry.

Migration `011_decision_attempts_and_rejections.sql` makes `route` nullable only for rejected records and adds database constraints that reject inconsistent state/payload combinations.
