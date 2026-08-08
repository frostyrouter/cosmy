# Project updates

This file is the shared implementation record for the Cosmy router. New feature and change entries must follow the rules in [`agent.md`](../agent.md).

## 2026-08-08 - Update tracking established

- Change: Added the repository rule requiring implementation updates for every feature or change, with a consolidated entry at least every two merged pull requests.
- Impact: Contributors now have one chronological place to understand shipped work, validation, limitations, and follow-up tasks.
- Validation: Documentation-only change; no runtime behavior changed.
- Follow-up: Add the next implementation entry when the next feature or fix is merged.

## 2026-08-08 - Provider runtime and production persistence

- Change: Added provider adapters for OpenAI, Anthropic, and Gemini; retry, timeout, health, fallback, metrics, evaluation, PostgreSQL persistence, startup migrations, and Docker integration.
- Change: Corrected tenant reservation reconciliation, simulator total-token accounting, HTTP cancellation handling, and the production container build.
- Impact: The router can execute through configured external providers or the simulator, fail over safely, reconcile budgets, and run with PostgreSQL-backed reservations.
- Files or subsystems: Provider adapters, execution, routing, HTTP API, persistence, configuration, Docker, CI, evaluation, and tests.
- Validation: 27 automated tests, TypeScript lint, production build, and PostgreSQL-backed Docker Compose smoke test.
- Limitations and follow-up: Health snapshots and registry publication remain in-memory at runtime; production provider credentials and deployment secrets must be supplied through the environment.
