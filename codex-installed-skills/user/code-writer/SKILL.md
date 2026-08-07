---
name: code-writer
description: Rule-based production code writing guidance inspired by the structure and engineering practices of earendil-works/pi, openai/codex, and google-gemini/gemini-cli. Use when Codex is asked to implement, refactor, design, review, or test non-trivial code and needs concrete rules for repository structure, backend/service boundaries, function decomposition, helper count, edge-case handling, API design, concurrency, validation, and test selection.
---

# Code Writer

## Core Posture

Write code as if the next maintainer must safely change it under pressure.

First preserve the existing system shape. Read the surrounding package, module, tests, and local guidance before choosing abstractions. Prefer local patterns over generic taste. Keep the diff reviewable, behavior-driven, and easy to verify.

This skill is based on recurring patterns in three production agent codebases:

- `earendil-works/pi`: TypeScript packages split into agent, AI provider, coding-agent, orchestrator, and TUI layers.
- `openai/codex`: Rust/Bazel workspace split into many small crates for core, protocol, config, policy, tools, app-server, TUI, and utilities.
- `google-gemini/gemini-cli`: TypeScript monorepo split into CLI UI, core logic, A2A server, SDK, devtools, test utilities, and VS Code companion.

## Reference Loading

Read only the references needed for the task:

- For package layout, backend boundaries, dependency direction, and file/module structure, read `references/architecture.md`.
- For function splitting, helper count, types, APIs, state, async work, and implementation style, read `references/decomposition.md`.
- For validation, errors, permissions, concurrency, filesystem, network, compatibility, and other edge cases, read `references/edge-cases.md`.
- For what tests to write and how to choose unit, integration, snapshot, harness, or regression coverage, read `references/testing.md`.
- Before finalizing a meaningful implementation, read `references/review-checklist.md`.

## Working Loop

1. Map the existing ownership boundary.
   Identify the package, crate, module, or service that already owns the behavior. Add code there unless doing so would bloat a central module or violate dependency direction.

2. Define the behavior contract.
   State inputs, outputs, side effects, invariants, failure modes, and compatibility surface before writing code. For user-visible behavior, include exact CLI/UI/API effects. For backend behavior, include persistence, retry, cancellation, authorization, and observability effects.

3. Choose the smallest durable structure.
   Keep ordinary changes in existing files. Create a new file/module when a concept has independent tests, a stable name, a separate boundary, or would push a high-touch file further into bloat.

4. Implement from the boundary inward.
   Validate and normalize inputs at the boundary. Move pure decisions into small functions. Keep IO, process spawning, network calls, persistence, and UI rendering in adapters around the core behavior.

5. Write tests that prove behavior, not implementation trivia.
   Cover the changed contract, important edge cases, regression risks, and boundary interactions. Use a harness or integration test when the behavior depends on agent turns, CLI process behavior, filesystem state, policy, permissions, concurrency, or UI output.

6. Run targeted verification first.
   Run formatter/linter/typecheck and the smallest relevant test command. Escalate to broader suites only when shared contracts, central modules, or cross-package behavior changed.

## Non-Negotiable Rules

- Do not add a helper just to name one line. Inline single-use helpers unless the helper isolates a real concept, error path, side effect, or reusable decision.
- Do not grow a central module by default. If a file is already large or high-touch, prefer a new sibling module with tests near it.
- Do not make boolean or ambiguous positional APIs for new code when an enum, options object, builder, newtype, or named method would make callsites self-documenting.
- Do not parse untrusted structured data with ad hoc string logic when a schema, typed parser, or structured API is available.
- Do not let invalid, unauthorized, or unsupported states travel deep into core logic. Reject or normalize at the boundary.
- Do not write broad catch-all error handling that hides root causes. Preserve source errors, attach context, and present clean user-facing messages at the edge.
- Do not use real provider APIs, paid tokens, live services, or production resources in tests when a faux provider, local server, fixture, or mock can prove the behavior.
- Do not add tests for constants, deleted behavior, or implementation details that make refactors painful without proving behavior.

## Size Budgets

Use these budgets as defaults, not rigid laws:

- Function: target one screen or less; split after roughly 40-70 lines unless the code is a simple linear parser or table-driven mapping.
- Helper count: a typical feature should need 0-5 new private helpers. More than 5 usually means the concept deserves a module, type, strategy object, or smaller staged change.
- File: target under 500 lines excluding tests. Avoid adding substantial logic to files over roughly 800 lines unless the local architecture clearly demands it.
- Change size: target under 500 changed lines for complex logic and under 800 for normal non-mechanical changes. Split larger work into coherent stages.
- Public API: expose the minimum needed. Keep test-only helpers out of public exports unless the repository already has an explicit test-support pattern.

## Backend Service Rules

Backend code should separate contracts, policy, orchestration, and effects:

- Put wire formats, request/response types, event names, and compatibility shims in protocol/schema modules.
- Put config loading and layered precedence in config modules. Keep merge rules explicit and tested.
- Put authorization, approvals, sandboxing, policy, and path access decisions before execution or persistence.
- Put process execution, network clients, database/storage, and filesystem IO behind interfaces or adapters that tests can replace.
- Put orchestration loops in one place, but extract independent decisions so cancellation, retries, follow-ups, and partial state are testable.
- Make persistence atomic when partial writes would corrupt future reads.
- Treat migrations and generated files as first-class code: update generators or schemas, then include generated diffs.

## Output Discipline

When finishing an implementation, report:

- What changed.
- Which rule-shaped boundary or invariant the code now preserves.
- Which tests or checks ran.
- Any verification gaps or residual risk.
