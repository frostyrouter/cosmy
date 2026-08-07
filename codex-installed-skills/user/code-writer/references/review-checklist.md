# Review Checklist

Use this checklist before finalizing a meaningful code change.

## Structure

- The code lives in the package, crate, module, or service that owns the behavior.
- Dependency direction remains clean.
- Central files did not grow when a focused module would be clearer.
- New public API is minimal and documented when needed.
- Generated files were updated through their generator or schema.

## Decomposition

- Functions have a clear single role or orchestration purpose.
- Single-use trivial helpers were not introduced.
- More than five new helpers were justified by a real module/concept split.
- Side effects are isolated from pure decisions where practical.
- State transitions and event ordering are explicit.

## Types And Data

- Invalid states are rejected early or represented explicitly.
- New APIs avoid boolean traps and ambiguous positional parameters.
- Structured parsers/schemas are used for structured data.
- Paths, commands, URLs, config, permissions, and protocol data are normalized before use.
- User-facing and internal error messages are separated when appropriate.

## Edge Cases

- Empty, missing, invalid, and large inputs were considered.
- Cancellation, timeout, retry, and cleanup were considered for long-running work.
- Permission and policy failures fail closed.
- Legacy compatibility surfaces were searched when CLI/API/config/protocol/storage changed.
- Secrets and private data are not logged, snapshotted, or returned unnecessarily.

## Tests

- Tests prove changed behavior, not just implementation shape.
- The smallest useful test level was chosen.
- Boundary behavior has integration/harness coverage when needed.
- Security or permission changes include denial tests.
- UI/TUI/text output changes have snapshot or equivalent coverage.
- Tests avoid real providers, paid APIs, production services, and unstable globals.

## Verification

- Formatter ran for changed code where applicable.
- Targeted tests ran for modified behavior.
- Typecheck/lint ran when code changed.
- Broader checks ran or were explicitly skipped with a reason.
- Remaining risk is stated in the final response.
