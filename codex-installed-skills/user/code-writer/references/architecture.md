# Architecture Rules

## Table Of Contents

- Ownership boundaries
- Repository structure
- Dependency direction
- Backend boundaries
- File and module creation
- Generated code and configuration
- Naming rules

## Ownership Boundaries

Start by finding the owner of the behavior. In the studied repos, ownership is usually visible from package or crate names:

- UI/CLI packages adapt terminal input, render output, parse command flags, and call core services.
- Core packages own business behavior, agent/session logic, tool execution, prompts, context construction, policy decisions, and model interactions.
- Protocol/schema packages own wire contracts and backward compatibility.
- Config packages own layered config, validation, defaults, migrations, and generated schemas.
- Tool packages own tool declarations, validation, confirmation, execution, and result formatting.
- Transport/client/server packages own RPC, HTTP, websocket, Unix socket, or process boundaries.
- Test-utils packages own reusable harnesses and fake providers.

Rule: move behavior toward the layer that owns the invariant, not toward the layer where the bug was observed.

## Repository Structure

Use structure that communicates dependency direction:

```text
repo/
  packages/ or crates/
    cli/          # user commands and presentation
    core/         # behavior and orchestration
    protocol/     # cross-process/API types
    config/       # settings, layers, validation
    tools/        # tool declarations and execution
    transport/    # IO/RPC/websocket/process adapters
    test-utils/   # reusable fakes, rigs, fixtures
```

For a new package or crate, require at least one of:

- A new public contract or runtime boundary.
- A concept needed by multiple existing packages without forcing a dependency cycle.
- A central module is already bloated and the concept can be named cleanly.
- Tests need an isolated harness or fake around the new boundary.

Avoid a package if it only hides two files that are owned by an existing module.

## Dependency Direction

Prefer this direction:

```text
UI/CLI -> application service -> core decisions -> protocol/types/utilities
transport/adapters -> core interfaces
tests -> test-utils -> public/test-support APIs
```

Avoid:

- Core importing UI.
- Protocol importing application services.
- Config loading importing execution logic.
- Utility packages importing domain packages.
- Test-only helpers leaking into production API.
- One central `core` module becoming the landing place for every new concept.

If a dependency direction is awkward, introduce a narrow trait/interface/type in the lower layer and implement it in the higher layer.

## Backend Boundaries

Backend code should have explicit boundary stages:

1. Decode input.
2. Validate shape and permissions.
3. Normalize paths, commands, URLs, model IDs, or settings.
4. Evaluate policy.
5. Execute side effects.
6. Persist state atomically.
7. Emit events or return protocol results.
8. Render user-facing messages at the edge.

Do not mix all stages in one function unless the behavior is tiny.

For server or daemon code:

- Keep request processors thin.
- Put durable state in a store/service layer with explicit error types.
- Keep wire-level compatibility tests for omitted, null, renamed, or legacy fields.
- Treat cancellation and disconnect as normal paths.
- Make logs/tracing structured enough to diagnose a failed request without leaking secrets.

## File And Module Creation

Create a new file/module when:

- The name describes a durable concept, not a temporary implementation detail.
- The code can own its own tests.
- The code has a different reason to change than the caller.
- The caller is already large or high-touch.
- The code introduces a new state machine, parser, policy, scheduler, adapter, cache, or protocol surface.

Keep code in the same file when:

- The change is a small branch inside an existing function.
- The helper would have one callsite and no independent invariant.
- Splitting would force public exports or circular dependencies.
- Existing local style keeps similar cases together.

For Rust:

- Prefer private modules and explicit public exports.
- Use sibling `*_tests.rs` files for new test modules when the repo follows that pattern.
- Put crate-level API in `lib.rs` or focused modules, not scattered re-exports.

For TypeScript:

- Prefer explicit exports from package entrypoints.
- Keep `src/` for implementation, `test/` or colocated `*.test.ts` for tests based on local convention.
- Keep CLI command registration, command implementation, and command UI separable when they have distinct tests.

## Generated Code And Configuration

Generated code is owned by its generator:

- Change the generator or schema, then regenerate.
- Include generated diffs when the repo expects them.
- Do not manually patch generated outputs unless the repo explicitly permits it.
- Update lockfiles and build metadata when dependency or compile-time resource changes require them.

Config code needs extra structure:

- Keep precedence and merge rules explicit.
- Treat user, workspace/project, session, managed/admin, and environment settings as distinct layers.
- Test both trusted and untrusted sources.
- Prevent workspace config from overriding admin or policy-controlled fields unless explicitly intended.

## Naming Rules

Use names that reveal responsibility:

- `parse*` returns structured data from text or bytes and can fail.
- `validate*` checks rules and returns errors without changing state.
- `normalize*` converts equivalent inputs into canonical form.
- `resolve*` may consult config, filesystem, registry, or environment.
- `load*` reads external state.
- `build*` constructs an object from already available data.
- `execute*` performs side effects.
- `render*` converts internal state into user-facing output.
- `*_policy`, `*_schema`, `*_protocol`, `*_transport`, `*_store`, and `*_test_support` should mean exactly that.

Avoid vague names like `manager`, `helper`, `utils`, or `common` unless the surrounding repo already uses them for a bounded role.
