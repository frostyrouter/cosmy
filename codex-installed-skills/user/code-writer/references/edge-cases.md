# Edge-Case Rules

## Table Of Contents

- General checklist
- Filesystem and paths
- Commands and subprocesses
- Config and policy
- Network and backend APIs
- Agent/tool loops
- UI/CLI/TUI
- Persistence and migrations
- Compatibility
- Security

## General Checklist

For every non-trivial change, decide which of these apply:

- Empty input.
- Missing optional field.
- Null versus omitted.
- Invalid type.
- Unknown enum or mode.
- Duplicate item.
- Out-of-order event.
- Partial result.
- Aborted operation.
- Timeout.
- Permission denied.
- Path outside workspace.
- Network disabled or unavailable.
- Retry after transient failure.
- Legacy payload.
- Concurrent calls.
- Cleanup after failure.
- Large input or output.
- Secret-bearing data.

Do not test every item blindly. Test the applicable ones that could break the contract.

## Filesystem And Paths

Rules:

- Resolve paths relative to the intended root before use.
- Canonicalize or normalize before policy checks when symlinks, `..`, case, or drive roots matter.
- Validate read and write separately.
- Include allowed roots in denial messages when helpful.
- Treat project temp directories as explicit exceptions, not accidental global write access.
- Avoid assuming POSIX paths. Consider Windows drive prefixes, UNC paths, executable extensions, and path separators.
- For generated or temporary files, use unique names and cleanup paths.
- For durable writes, write atomically when interrupted writes would corrupt state.

Tests to consider:

- Path inside workspace.
- Path outside workspace.
- Relative traversal.
- Symlink or canonical path mismatch where supported.
- Missing parent directory.
- Existing file conflict.
- Windows path behavior if the project supports Windows.

## Commands And Subprocesses

Rules:

- Parse shell wrappers before policy decisions where the system supports shell execution.
- Distinguish safe command, prompt-required command, forbidden command, and sandbox-denied command.
- Preserve command tokens in structured form as long as possible.
- Avoid string-concatenating commands from untrusted input.
- Pass environment explicitly when policy or tests depend on it.
- Bound output size and stream updates.
- Treat background processes as resources with lifecycle, ID, output buffer, and cleanup.
- Handle exit code, signal, spawn failure, timeout, and cancellation separately.

Tests to consider:

- Allowed command skips approval.
- Prompt-required command asks.
- Forbidden command is denied.
- Approval persistence updates policy.
- Complex shell command does not create unsafe auto-approval.
- Background command emits initial output and completion.
- Output truncation or summarization keeps bounded size.

## Config And Policy

Rules:

- Define precedence from lowest to highest explicitly.
- Keep disabled or untrusted layers visible to trust logic but excluded from execution logic when required.
- Prevent workspace/project settings from overriding admin, managed, or user-only policy fields unless intended.
- Validate settings before using them.
- Keep config schema and generated docs in sync when types change.
- Treat environment variables as input layer, not hidden global state.

Tests to consider:

- Default config.
- User config.
- Workspace config.
- Trusted versus untrusted project.
- Admin/managed config cannot be bypassed.
- Invalid config emits precise error.
- Legacy config still loads or fails with migration guidance.

## Network And Backend APIs

Rules:

- Validate URLs, protocols, hosts, redirects, and local binding rules.
- Apply auth before side effects.
- Distinguish 4xx user/actionable errors from 5xx/transient errors.
- Add timeouts to outbound calls.
- Do not retry non-idempotent writes without an idempotency strategy.
- Keep request/response protocol structs typed and versioned.
- Bound body sizes and streamed content.
- Avoid logging tokens, cookies, auth headers, exact secrets, or private payloads.

Tests to consider:

- Missing auth.
- Invalid host/origin.
- Timeout.
- Retryable server error.
- Non-retryable client error.
- Redirect denied.
- Legacy response field.
- Network unavailable.

## Agent And Tool Loops

Rules:

- Keep model-visible context bounded.
- Transform context at one boundary before provider calls.
- Store partial assistant messages carefully during streaming and replace them with final messages.
- Validate tool arguments before execution.
- Preserve tool result ordering even if execution is parallel.
- Support sequential-only tools.
- Treat tool denial, approval, execution error, abort, and terminate as distinct outcomes.
- Keep follow-up and steering messages ordered.
- Make loops stop with explicit conditions.

Tests to consider:

- Tool call with invalid arguments.
- Sequential tool order.
- Parallel tool order preservation.
- Tool result terminates loop.
- Assistant stream error.
- Abort during response.
- Follow-up message after agent would otherwise stop.
- Pending approval pauses state.
- Race between approval and cancellation.

## UI, CLI, And TUI

Rules:

- Keep rendering separate from behavior.
- Parse flags and commands at the CLI edge, then call core services.
- Snapshot terminal/TUI output when visual/text output changes.
- Avoid hardcoded key handling when keybindings are configurable.
- Keep user-facing copy stable and test important strings through snapshots or focused assertions.
- Handle narrow terminal widths, long paths, long command output, and non-interactive mode.

Tests to consider:

- Command registration and help.
- Non-interactive output.
- Error rendering.
- Snapshot for changed screen/output.
- Keyboard or command shortcut path.
- Terminal width wrapping.

## Persistence And Migrations

Rules:

- Version persisted formats when they may change.
- Keep migrations small, ordered, and idempotent.
- Test old data loading.
- Test failed write or partial read where practical.
- Do not mutate persisted state before validation succeeds.
- Keep in-memory cache update consistent with durable write.

Tests to consider:

- Empty store.
- Existing current-version store.
- Old-version store.
- Corrupt store.
- Atomic update.
- Cache reflects persisted update.

## Compatibility

Compatibility surfaces include:

- CLI flags and output used by scripts.
- Config keys and precedence.
- Protocol events and request/response fields.
- Stored session or rollout files.
- Plugin/extension/skill APIs.
- Public package exports.

Before changing any surface:

- Search callers and docs.
- Decide whether to preserve, migrate, warn, or intentionally break.
- Add tests for legacy payloads when preserving behavior.
- Add changelog/docs only where the repo expects them.

## Security

Security-sensitive code requires stricter rules:

- Default deny when policy cannot be evaluated.
- Fail closed on malformed approval responses.
- Keep local-only HTTP protections such as host/origin checks.
- Validate archive/plugin/package names as path segments, not arbitrary strings.
- Do not allow config from less-trusted layers to add permissions.
- Do not expand sandbox/filesystem/network access silently.
- Redact secrets in logs, telemetry, errors, snapshots, and test fixtures.
- Treat dependency and lockfile changes as code changes.

Security tests should include denial paths, not only successful paths.
