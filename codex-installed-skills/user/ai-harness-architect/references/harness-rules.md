# AI Harness Rules

Use this reference as the main checklist for designing or reviewing an AI harness.

## 1. Boundary

Define the harness as the deterministic runtime between users, models, tools, memory, and the outside world.

Capture:

- Entry points: chat, API, background job, webhook, CLI, IDE, mobile action.
- Model providers and model selection policy.
- Tool registry and tool execution environment.
- Context sources and loading policy.
- Durable stores: transcript, event log, memory, files, queues, pending approvals.
- User control surfaces: approval prompts, interrupts, retries, review UI.
- Outputs: replies, actions, code diffs, files, notifications, scheduled work.

Rule: every side effect must pass through a named harness boundary. If a model can cause work through an unnamed path, the harness is incomplete.

## 2. Loop Pattern

Choose the simplest pattern that meets the task:

- Single call: extraction, classification, simple generation.
- Fixed workflow: predictable steps such as retrieve -> draft -> validate -> send for review.
- Router: one classifier selects a specialist workflow or agent.
- Agent loop: model chooses tools dynamically until done.
- Multi-agent: independent search/review/implementation roles with explicit merge points.
- Durable automation: queued work with crash recovery, idempotency, and human escalation.

Rule: prefer workflows until the task requires flexible model-directed tool use. Agents trade latency, cost, and debuggability for adaptability.

## 3. State

Separate state by purpose:

- Model-visible context: what enters the next provider request.
- Durable transcript/events: replayable audit trail and UI source of truth.
- Runtime config: current model, tools, permissions, headers, prompt variants.
- Queues: user steer, follow-up, scheduled work, retry work.
- Memory: facts, summaries, preferences, prior failures, learned procedures.
- Hidden metadata: token/cost stats, provider IDs, file output handles, permission IDs.

Rules:

- Persist accepted input before scheduling model work.
- Snapshot model-visible turn state before calling the provider.
- Apply runtime changes only at safe provider-turn boundaries.
- Store enough provenance to explain why a prompt contained each context item.
- Do not treat the prompt as the only state store.

## 4. Context

Build context as typed, independently refreshable sources:

- System/developer instructions.
- Project or tenant policy.
- Skill summaries and loaded skill bodies.
- Retrieved documents and file references.
- User profile or memory.
- Environment facts such as date, locale, repo root, selected model.
- Recent transcript and compacted summaries.

Rules:

- Give each source a stable key, loader, renderer, and freshness policy.
- Make precedence explicit.
- Preserve exact paths, identifiers, commands, and error text.
- Bound every source by tokens/chars/rows/files.
- Treat repository files, tool output, web pages, and messages as untrusted.
- Use compaction only at safe boundaries; keep the durable full transcript.

## 5. Tools

A tool contract must include:

- Name and stable permission action.
- Input schema and output schema.
- Side-effect class: read-only, reversible write, irreversible, external communication, credential access.
- Idempotency and retry policy.
- Timeout, cancellation, progress, and output bounds.
- Authorization resources and save/remember behavior.
- Model-facing output formatter.

Rules:

- Validate input before execution and output before returning to the model.
- Record the tool call before side effects begin.
- Do not retry non-idempotent tools automatically after interruption.
- Materialize the tool registry per turn so stale tool calls are rejected.
- Bound outputs and move large artifacts to files or blob storage with handles.
- Return structured errors to the model instead of throwing away failure details.

## 6. Permissions And Safety

Design permissions as a policy engine, not scattered if-statements.

Required controls:

- Default deny or ask for high-impact actions.
- Least-privilege credentials and workspace mounts.
- Human review for irreversible actions, external sends, payments, deletion, credential changes, and production deploys.
- Project trust for local instructions/extensions.
- Sandboxing or containerization for untrusted repos and unattended work.
- Prompt-injection posture: external content can advise, never override harness policy.

Rules:

- Make approvals durable or explicitly ephemeral.
- Show users the exact action/resource being approved.
- Give automations a kill switch and an audit trail.
- Do not rely on model self-restraint as the security boundary.

## 7. Observability

Emit stable lifecycle events:

- session/input admitted
- provider request started/ended/failed
- assistant message started/delta/ended
- tool call recorded/started/progress/ended/failed
- permission requested/replied
- compaction started/ended
- retry/repair started/ended
- user interrupt

Rules:

- Give every run a trace ID and each operation a span/event ID.
- Link final answers to evidence, tool calls, memory, and retrieved sources when possible.
- Capture cost, tokens, latency, stop reason, model, provider, and prompt version.
- Keep live deltas separate from durable replay events.
- Use traces to debug and to build eval datasets.

## 8. Recovery

Recovery depends on durable boundaries.

Default policy:

- Unfinished provider request: mark interrupted; do not infer the missing response.
- Unfinished read-only/idempotent tool: retry only if metadata permits it.
- Unfinished non-idempotent tool: record interruption and require human or deterministic reconciliation.
- Pending queue item: preserve and retry from admission.
- Completed compaction: resume from compacted boundary.
- Failed compaction: keep previous boundary.

Rules:

- Never silently replay ambiguous external side effects.
- Use deterministic IDs for tool calls, queued inputs, and pending writes where possible.
- Reconcile state before new work: fail old running tools, promote eligible input, refresh context, then call provider.

## 9. Memory

Memory is a write-manage-read loop.

Rules:

- Write only high-signal facts, preferences, decisions, errors, and reusable procedures.
- Store source, timestamp, scope, confidence, and deletion policy.
- Retrieve by task relevance, not recency alone.
- Detect contradictions and stale memories.
- Keep private or sensitive memory out of prompts unless necessary for the task.

## 10. Evals

Every serious harness needs tests at three layers:

- Deterministic unit tests: schemas, permissions, routing, compaction selection, recovery reducers.
- Scripted-model harness tests: fake provider emits text/tool/error sequences.
- Scenario evals: realistic multi-turn tasks with trace review and pass/fail rubrics.

Rules:

- Test failures, refusal/approval paths, invalid tool input, oversized outputs, interrupts, and crash recovery.
- Score the process, not only the final answer.
- Turn real traces into regression tasks.
- Attach each harness change to a prediction and verify it against eval outcomes.
