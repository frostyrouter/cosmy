# Testing Rules

## Table Of Contents

- Test selection
- Unit tests
- Integration and harness tests
- Snapshot tests
- Regression tests
- Mocks, fakes, and fixtures
- Edge-case coverage
- Verification commands
- Anti-patterns

## Test Selection

Choose tests by behavior risk:

```text
Pure decision or parser            -> unit test
Config merge or schema             -> unit plus fixture test
Filesystem/path/policy behavior    -> unit plus temp-dir integration
CLI flag/output behavior           -> CLI integration or command test
Agent/tool/session behavior        -> harness integration with fake provider
TUI/terminal rendering             -> snapshot plus interaction test
Protocol/server behavior           -> request/response integration
Concurrency/race behavior          -> focused async integration
Generated schema/output            -> generator check plus fixture/snapshot
```

Prefer the smallest test that proves the contract. Add a broader test when the behavior crosses process, IO, policy, UI, or agent-turn boundaries.

## Unit Tests

Write unit tests for:

- Parsers.
- Normalizers.
- Validators.
- Policy decisions.
- Config merge functions.
- Error formatting.
- Small state transitions.
- Serialization and deserialization compatibility.

Rules:

- Compare whole objects when possible.
- Name tests by behavior, not implementation.
- Include both valid and invalid representative inputs.
- Keep setup local and explicit.
- Avoid testing constants or static values.
- Avoid tests that only mirror implementation branches.

## Integration And Harness Tests

Use integration or harness tests when behavior depends on:

- Agent loop turns.
- Model/provider responses.
- Tool scheduling.
- Approval flow.
- CLI process behavior.
- Filesystem layout.
- Network/server requests.
- Persistent state.
- Background subprocesses.
- UI rendering lifecycle.

Use fake providers, local servers, temp dirs, and in-memory stores. Do not call real model providers, paid APIs, or production systems.

Good harnesses expose:

- Configurable fake responses.
- In-memory settings/auth/session stores.
- Temp workspace.
- Event capture.
- Cleanup.
- Helpers to inspect user/assistant/tool messages.

## Snapshot Tests

Use snapshots when text or visual layout matters:

- TUI screens.
- CLI help or command output.
- Tool model declarations.
- Protocol fixtures.
- Rendered diffs or summaries.

Rules:

- Review snapshot diffs manually.
- Keep snapshots deterministic.
- Do not snapshot secrets, absolute temp paths, unstable IDs, or timestamps unless normalized.
- Add a focused assertion when a snapshot is too broad to explain the behavior.

## Regression Tests

Add regression tests for bug fixes when:

- The failure could reappear through refactoring.
- The bug involved edge-case input.
- The bug crossed package or process boundaries.
- The bug caused data loss, security risk, or user-visible breakage.

Name regression tests after the behavior or issue pattern. Keep them focused on the bug contract, not the incidental old implementation.

## Mocks, Fakes, And Fixtures

Prefer fakes over mocks when interaction order is not the behavior. Prefer mocks when confirming a collaborator call is the behavior.

Rules:

- Mock at external boundaries, not every internal function.
- Keep fixtures small but realistic.
- Use temp dirs for filesystem tests and clean them up.
- Stub environment variables through the repo's test helper when available.
- Avoid mutating global state without restoring it in `afterEach` or equivalent.
- Use local test servers for HTTP behavior.
- Keep test resources available to both primary build systems when the repo uses more than one build system.

## Edge-Case Coverage

For each changed behavior, pick relevant cases from this matrix:

- Happy path.
- Invalid input.
- Missing input.
- Permission denied.
- Boundary size or empty collection.
- Cancellation/abort.
- Timeout or transient failure.
- Legacy payload or config.
- Concurrent/race case.
- Cleanup after failure.
- Platform variant.

Do not force all cases into one test. Split by reason to fail.

## Verification Commands

Follow the repository's local guidance. General default:

1. Format changed language scope.
2. Run typecheck/lint for changed package or crate.
3. Run targeted tests for changed files.
4. Run broader package/crate tests if shared contracts changed.
5. Run full suite only when the change touches central infrastructure or the repo asks for it.

When a test file is created or modified, run that test if feasible and iterate until it passes.

## Anti-Patterns

Avoid:

- Testing implementation-private helper call counts when output behavior is enough.
- Adding test-only production exports without a test-support pattern.
- Using real external services.
- Sleeping in tests when a deterministic signal/event would work.
- Ignoring flaky race behavior because it is hard to reproduce.
- Updating snapshots without reading the diff.
- Adding broad tests that pass even if the feature is broken.
- Deleting or weakening tests to make a change pass.
