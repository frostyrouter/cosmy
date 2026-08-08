# Phase 1 implementation

This slice turns the architecture contracts into a runnable, provider-neutral service.

## Runtime boundary

`POST /v1/responses` accepts a normalized request with messages, optional tools, structured-output requirements, streaming, and policy hints. The HTTP layer validates input, creates a request-local cancellation signal, and never exposes provider-specific response shapes.

The service composes four replaceable parts:

1. `DeterministicRouter` extracts request features, filters models by hard constraints, and ranks eligible candidates.
2. `RequestExecutor` reserves budget, invokes the selected provider, records usage, and updates health.
3. `Provider` hides provider-specific transport and normalization.
4. `ModelRegistry` and stores provide the control-plane data boundary; memory implementations make local tests deterministic.

## Simulator first

The simulator is intentionally the default provider. It exercises complete and SSE paths without credentials, network calls, or billing. Real adapters run behind the same asynchronous `Provider` interface and have contract tests.

## Routing behavior

The 2D coordinates remain explainability metadata. Eligibility is always decided before scoring. A model can only score if it satisfies context, output, capabilities, modality, data-class, region, quality, and lifecycle constraints. Ranking then combines quality, cost, latency, and distance from inferred request coordinates.

## Development commands

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m ruff check cosmy tests scripts
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m uvicorn cosmy.app:app --reload
```

The service listens on `http://localhost:8080` by default. A minimal request is:

```json
{"messages":[{"role":"user","content":"Rewrite this email politely"}]}
```

Use `"stream": true` to receive Server-Sent Events. Disconnecting the client stops stream iteration and releases its reservation.
