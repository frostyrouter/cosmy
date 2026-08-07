---
name: ai-harness-architect
description: Design, review, or implement production-grade AI application harnesses and coding-agent runtimes. Use when building agent loops, tool registries, permission gates, durable session state, prompt/context systems, compaction, memory, eval/observability loops, multi-agent orchestration, or any app layer that mediates LLMs, tools, users, and execution environments.
---

# AI Harness Architect

## Purpose

Use this skill to design the harness around an AI application, not just the prompt inside it. A harness is the deterministic software boundary that selects context, calls models, executes tools, stores state, handles user control, and proves behavior with traces and evals.

## First Move

Before designing or editing code, classify the application:

- **Workflow**: known path, bounded branches, predictable tools. Prefer deterministic orchestration with LLM calls at decision points.
- **Agent**: open-ended task, dynamic tool choice, multi-turn environment feedback. Use an agent loop with strict control surfaces.
- **Assistant surface**: chat or UI action layer. Prefer progressive context, narrow tools, repair passes, and user-facing confirmations.
- **Automation**: unattended or recurring work. Require durable state, replayable events, idempotency, permissions, and kill switches.
- **Evaluator or improvement loop**: harness is judging or evolving another harness. Require trace schemas, task suites, falsifiable predictions, and rollback.

If the task involves implementation, inspect the existing codebase first: current model calls, tool definitions, state storage, prompts, auth, permissions, logging, and failure handling.

## Core Workflow

1. Map the harness boundary: inputs, model providers, tools, execution environment, state stores, user approval channels, and outputs.
2. Choose the smallest viable control pattern: single call, fixed workflow, agent loop, multi-agent router, or durable automation.
3. Define state explicitly: model-visible context, durable transcript/events, hidden runtime metadata, memory, queues, and pending operations.
4. Specify tool contracts: schemas, permissions, idempotency, side effects, output bounds, progress, cancellation, and recovery semantics.
5. Build context as data: source registry, precedence, freshness, token budget, compaction, and provenance.
6. Add safety gates: least privilege, human review for high-impact actions, sandbox/container boundaries, and prompt-injection handling.
7. Instrument the loop: lifecycle events, traces, tool-call records, cost/tokens, errors, and evidence links.
8. Test with scripted providers and fixtures before live models; then add eval tasks from real user workflows.

## Rules

- Keep prompts owned by code, versioned, inspectable, and testable. Do not hide core behavior inside opaque framework defaults.
- Convert natural language to structured tool calls, then let deterministic code execute and validate side effects.
- Snapshot turn state before each provider request. Runtime changes apply at safe boundaries, not mid-request.
- Persist accepted user inputs, tool calls, tool results, errors, and compactions before relying on them.
- Record a tool call before side effects begin. Never silently replay a side-effecting call after a crash.
- Treat tool outputs as untrusted input. Bound size, label stderr/errors, preserve exact identifiers, and keep large blobs out of the prompt.
- Use progressive disclosure for skills, references, memory, and long docs: advertise summaries first, load detail only when relevant.
- Separate model-visible state from durable audit state. The transcript can be richer than the next prompt.
- Add a repair pass only for objective contract failures: invalid JSON, missing required tool, impossible schema, unsafe action claim, or failed validation.
- Prefer workflows for predictable tasks and agents only when dynamic planning/tool choice materially improves outcomes.

## References

Read [references/harness-rules.md](references/harness-rules.md) when designing a new harness, reviewing an existing harness, or making nontrivial code changes.

Read [references/patterns.md](references/patterns.md) when choosing between fixed workflows, agent loops, durable coding-agent sessions, extension/plugin systems, or self-improving harnesses.

Read [references/validation.md](references/validation.md) before finishing a design or implementation.
