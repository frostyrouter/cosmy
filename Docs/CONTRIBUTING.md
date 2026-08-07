# Contribution and release policy

## Branches

- Architecture and implementation work starts from the default branch.
- Agent-created branches use `agent/<short-description>`.
- Branches contain one coherent milestone.
- Avoid mixing provider adapters, routing behavior, infrastructure, and unrelated cleanup in one review.

## Commits

Commit whenever a coherent, reviewable unit is complete. Good commit boundaries include:

- Documentation foundation
- One subsystem contract
- One provider adapter
- One schema migration
- One test suite
- One operational capability

Commit messages are terse, imperative descriptions such as `Define routing engine contracts`.

Do not create meaningless commits for individual formatting edits. “Frequent” means easy to review and revert, not a fixed timer.

## Pull requests

- Pull requests are drafts unless explicitly promoted.
- A PR should represent a reasonably large, coherent update.
- The working target is approximately 3,000–4,000 meaningful changed lines for large foundation milestones.
- The threshold is a planning heuristic, not permission to pad code or documentation.
- Security fixes, isolated production defects, dependency emergencies, and small contract corrections may require smaller PRs.
- Very large changes should be split when reviewers cannot reason about them safely.

## Required PR description

Every PR explains:

- What changed
- Why it changed
- User and developer impact
- Architectural decisions or trade-offs
- Validation performed
- Rollout and rollback plan
- Known limitations and follow-up work

## Documentation standard

Public functions and modules must document:

- Responsibility
- Inputs and outputs
- Invariants
- Side effects
- Errors
- Timeout and cancellation behavior
- Idempotency behavior
- Metrics
- Tests

Function-level documentation describes contracts and rationale. It must not restate obvious syntax line by line.

## Review gates

- Formatting and link validation
- Unit and contract tests
- Security review for trust-boundary changes
- Data review for schema and retention changes
- Load test for hot-path changes
- Evaluation regression check for routing changes
- Migration and rollback verification

## Compatibility

Breaking public API changes require versioning, migration guidance, and a deprecation window. Internal contracts may evolve faster but must remain compatible during rolling deployment.

## Secrets

Never commit provider keys, access tokens, customer content, production endpoints, or unredacted traces. Test fixtures use synthetic data.
