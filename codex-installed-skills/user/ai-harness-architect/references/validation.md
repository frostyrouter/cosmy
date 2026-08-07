# Harness Validation

Run this checklist before declaring an AI harness design or implementation complete.

## Design Review

- The loop pattern is explicitly named and justified.
- The model-visible context is distinct from durable transcript/audit state.
- Each context source has a key, loader, renderer, precedence, and bound.
- Each tool has input/output schemas, permission resources, timeouts, and output bounds.
- Side-effecting tools have idempotency and recovery policy.
- Approval and interrupt paths are defined.
- Compaction preserves the durable full transcript and only changes model-visible context.
- Memory has scope, provenance, retention, and retrieval rules.
- Observability events can reconstruct what happened.

## Code Review

- Prompts are versioned in files/code and covered by tests or snapshots.
- Provider calls happen behind one boundary.
- Tool calls are validated and recorded before execution.
- Tool output is validated, bounded, and labeled.
- Stale tool calls are rejected after tool registry changes.
- User input admission is durable before execution is scheduled.
- Run coordination prevents concurrent mutation of the same session.
- Runtime config changes apply at safe turn boundaries.
- Errors are represented in the transcript or event log, not swallowed.

## Test Matrix

Include tests for:

- Happy path with one tool call.
- Multiple tool calls, parallel and sequential if supported.
- Invalid tool input.
- Tool throws or returns invalid output.
- Permission allow, ask, deny, and remembered approval.
- User interrupt during provider stream and during tool execution.
- Context overflow or compaction threshold.
- Oversized tool output.
- Provider error before assistant output.
- Provider error after partial assistant output.
- Crash/restart reducer for pending input and running tool calls if durable.
- Prompt injection in retrieved/tool/file content.

## Evals

Minimum scenario suite:

- One easy task expected to complete cheaply.
- One task requiring relevant file/context lookup.
- One task requiring a safe refusal or confirmation.
- One task with misleading external content.
- One task with a failing tool followed by recovery.
- One long task that triggers compaction or memory retrieval.

For each scenario, record:

- Expected final outcome.
- Required and forbidden tool calls.
- Evidence that must support the answer.
- Max budget or step count.
- Human-readable failure modes.

## Output Contract

When presenting a harness design, include:

- Architecture map.
- Chosen loop and alternatives rejected.
- State model.
- Tool and permission model.
- Context and compaction model.
- Observability and eval plan.
- Implementation plan in small slices.
- Known residual risks.
