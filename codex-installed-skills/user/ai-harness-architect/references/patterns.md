# Harness Patterns

Use this reference when choosing or explaining an architecture.

## Fixed Workflow

Use when the task path is known.

Shape:

```text
input -> normalize -> retrieve/context -> model step -> deterministic validation -> optional repair -> output/review
```

Good for support replies, extraction, mini-app generation, summaries, form filling, and approval-gated communications.

Rules:

- Keep control flow in code.
- Give each model call a typed contract.
- Add repair only for objective validation failures.
- Store intermediate artifacts for debugging.

## Agent Loop

Use when the model must choose tools dynamically.

Shape:

```text
admit user input
while not done and within budget:
  assemble context snapshot
  provider request
  persist assistant output/tool calls
  authorize and execute tools
  persist tool results
  refresh state at safe boundary
```

Rules:

- Bound steps, tool calls, output size, and wall time.
- Let tools be deterministic and typed.
- Keep steering/follow-up queues explicit.
- Stop on repeated identical failing actions.

## Durable Coding-Agent Session

Use for code editing, long tasks, remote sessions, or resumable work.

Core pieces:

- Append-only session/event log.
- Project/location identity.
- Context epoch or snapshot.
- Tool registry materialized per turn.
- Permission requests tied to session, agent, tool call, and resource.
- Compaction checkpoint that preserves full transcript externally.
- Run coordinator that serializes one session while allowing other sessions to run.

Rules:

- Persist input before making it model-visible.
- Record local tool calls before execution.
- Fail interrupted tools on startup before continuing.
- Reload projected history after tool settlement and compaction.
- Keep ephemeral streaming deltas out of durable cursors.

## Progressive Skill/Reference System

Use when many specialized instructions exist.

Rules:

- Advertise only name, description, and location in the baseline prompt.
- Load the full skill body only when the task matches.
- Resolve relative paths against the skill directory.
- Validate frontmatter and name collisions.
- Permission-filter available skills for the active agent.

## Extension Or Plugin System

Use when users need to add tools, hooks, UI, providers, or context sources.

Rules:

- Treat extensions as code with host permissions.
- Load project-local extensions only after project trust.
- Scope registrations and remove them on unload.
- Await hooks at lifecycle boundaries instead of fire-and-forget mutation.
- Provide facades, not raw internals, to avoid reentrancy and ordering bugs.
- Record provenance for registered tools/context/resources.

## Self-Improving Harness

Use only after a working eval suite exists.

Loop:

1. Run tasks and capture traces.
2. Distill failures into evidence.
3. Propose a specific harness edit.
4. State a prediction before applying it.
5. Re-run evals.
6. Keep, revert, or revise based on measured outcome.

Rules:

- Make editable components explicit and revertible.
- Improve tools, middleware, context, memory, and permissions before prompt prose.
- Avoid benchmark-specific hacks.
- Track token/cost impact as a first-class metric.

## Anti-Patterns

- Giant system prompt with no typed tools or tests.
- Hidden framework defaults that own prompts and control flow.
- Tools that accept arbitrary strings when structured input is possible.
- Unbounded shell/browser/network tools in unattended automations.
- Replaying side effects after crashes.
- Mixing live stream deltas with replayable event history.
- Summaries that drop paths, IDs, commands, or error strings.
- Evals that judge only final text and ignore tool/process failures.
