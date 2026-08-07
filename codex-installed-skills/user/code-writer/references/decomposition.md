# Decomposition Rules

## Table Of Contents

- Function splitting
- Helper count
- Types and API shape
- State machines and orchestration
- Async and concurrency
- Error handling
- Data parsing and validation
- Comments and documentation

## Function Splitting

Split by responsibility, not by line count alone.

A good function should usually do one of:

- Convert data from one representation to another.
- Validate a specific contract.
- Decide one policy outcome.
- Execute one side effect.
- Orchestrate a short sequence of named steps.
- Render one output shape.

Split a function when it contains three or more of:

- Boundary parsing plus core decisions plus IO.
- Repeated nested branches.
- Separate success, error, and cancellation paths.
- A loop with non-trivial per-item logic.
- Multiple comments explaining different phases.
- State mutation that must stay in a specific order.
- A section that needs independent tests.

Do not split when:

- The helper would simply restate the caller.
- The helper hides one line and has one callsite.
- The helper forces many parameters because it does not own a coherent concept.
- The split makes control flow harder to audit.

## Helper Count

Use this default budget:

- 0 helpers for a small branch or UI copy change.
- 1-2 helpers for parse/format/validate additions.
- 2-5 helpers for a normal feature touching one module.
- More than 5 helpers means consider a new module, class, trait/interface, or staged implementation.

Prefer private helpers first. Promote to public only when another production module needs it.

Helper quality test: the helper name plus signature should explain why it exists. If the caller still needs a comment to explain the helper, the split may be wrong.

## Types And API Shape

Make illegal states hard to represent:

- Use discriminated unions, enums, result types, or structured error variants for distinct outcomes.
- Use options objects for parameters that are optional, mode-specific, or likely to grow.
- Use enums/newtypes/named methods instead of boolean traps like `run(false)` or ambiguous `None`.
- Keep external protocol types separate from internal domain types when validation or compatibility logic exists.
- Use branded/validated path, URL, command, model, policy, or permission types when raw strings would be unsafe.

Design callsites for readability:

```ts
executeTool({ abortSignal, shellExecutionConfig, updateOutput });
```

Prefer this over positional arguments when more than two arguments are optional, mode-specific, or easy to swap.

For Rust, prefer:

```rust
ExecApprovalRequest {
    command,
    approval_policy,
    permission_profile,
    windows_sandbox_level,
    sandbox_permissions,
    prefix_rule,
}
```

over long positional calls.

## State Machines And Orchestration

When behavior has phases, name the phases explicitly. Examples:

- `queued -> running -> awaiting_approval -> completed`
- `start -> stream_delta -> tool_calls -> tool_results -> next_turn -> end`
- `load -> parse -> validate -> apply -> persist -> refresh_cache`

Rules:

- Keep the state owner singular. Avoid updating the same state from several unrelated modules.
- Emit events at phase boundaries, not randomly inside low-level helpers.
- Preserve ordering when callers observe order. Parallelize only where results can be reassembled deterministically.
- Treat partial state as a real state, especially for streaming model responses, background processes, and interrupted turns.
- Make cancellation idempotent. A second cancel or late event should not corrupt state.

## Async And Concurrency

Async code must identify:

- What can run in parallel.
- What must stay ordered.
- What happens when one task fails.
- What happens when the caller aborts.
- How resources are cleaned up.

Rules:

- Thread `AbortSignal`, cancellation token, or shutdown signal through every long-running path.
- Avoid unbounded task creation. Add queue limits, semaphores, or bounded buffers where input can grow.
- Use locks around shared mutable state only for the shortest necessary section.
- Avoid holding locks across IO or await points unless the lock is explicitly designed for that.
- Preserve output ordering if the protocol, UI, or tests depend on it.
- Make retries narrow and intentional. Do not retry non-idempotent operations unless the operation has an idempotency key or safe recovery path.

## Error Handling

Use layered errors:

- Low-level adapters preserve source errors.
- Domain logic maps sources into meaningful variants.
- UI/API edges render concise, actionable messages.

Rules:

- Include path, command, URL host, config layer, request ID, or field name in errors when relevant.
- Do not swallow parse errors and continue with defaults unless the product contract says warnings are acceptable.
- When degraded behavior is allowed, surface a warning and test the degraded path.
- Treat permission denial differently from not found, invalid input, timeout, abort, and internal failure.
- Keep panic/throw for impossible programmer errors, not user-controlled input.

## Data Parsing And Validation

Boundary data is hostile until proven otherwise:

- Parse JSON/YAML/TOML/frontmatter with a parser.
- Validate schema before using fields.
- Canonicalize paths before access checks.
- Resolve symlinks when policy depends on real filesystem location.
- Normalize command wrappers before policy checks.
- Validate host, origin, protocol, redirect, and local binding behavior for network calls.
- Keep legacy field handling close to protocol parsing.

Avoid partial validation such as checking only extension names, prefixes, or substring matches when structured parsing is available.

## Comments And Documentation

Write comments for invariants, non-obvious compatibility choices, security rationale, generated-code ownership, or concurrency ordering.

Do not write comments that narrate syntax.

For new traits/interfaces, document:

- The role of the abstraction.
- Who implements it.
- Whether implementations may perform IO.
- Cancellation and error expectations.

For public functions, document behavior at boundaries. Private helpers only need comments when the invariant is not obvious from the name and signature.
