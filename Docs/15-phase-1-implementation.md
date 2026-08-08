# Phase 1 implementation

This slice turns the architecture contracts into a runnable, provider-neutral service.

## Runtime boundary

`POST /v1/responses` accepts a normalized request with messages, optional tools, structured-output requirements, streaming, and policy hints. The HTTP layer validates input, creates a request-local cancellation signal, and never exposes provider-specific response shapes.

The service composes four replaceable parts:

1. `DeterministicRouter` extracts request features, filters models by hard constraints, and ranks eligible candidates.
2. `RequestExecutor` reserves budget, invokes the selected provider, records usage, and updates health.
3. `ProviderAdapter` hides provider-specific transport and normalization.
4. `ModelRegistry` and stores provide the control-plane data boundary; memory implementations make local tests deterministic.

## Simulator first

The simulator is intentionally the default provider. It exercises complete and SSE paths without credentials, network calls, or billing. Real adapters can be added behind the same `ProviderAdapter` interface after their contract tests exist.

## Routing behavior

The 2D coordinates remain explainability metadata. Eligibility is always decided before scoring. A model can only score if it satisfies context, output, capabilities, modality, data-class, region, quality, and lifecycle constraints. Ranking then combines quality, cost, latency, and distance from inferred request coordinates.

## Development commands

```bash
npm install
npm run lint
npm test
npm run build
npm run dev
```

The service listens on `http://localhost:8080` by default. A minimal request is:

```json
{"messages":[{"role":"user","content":"Rewrite this email politely"}]}
```

Use `"stream": true` to receive Server-Sent Events. Disconnecting the client aborts provider work through the request-local `AbortSignal`.
