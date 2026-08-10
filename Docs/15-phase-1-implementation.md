# Phase 1 implementation

This slice turns the architecture contracts into a runnable, provider-neutral service.

## Runtime boundary

`POST /v1/responses` accepts a normalized request with messages, optional tools, structured-output requirements, streaming, and policy hints. The HTTP layer validates input, creates a request-local cancellation signal, and never exposes provider-specific response shapes.

The service composes five replaceable parts:

1. `DeterministicRouter` extracts request features, filters models by hard constraints, and ranks eligible candidates.
2. `RequestExecutor` reserves budget, invokes the selected provider, records usage, and updates health.
3. `ProviderAdapter` hides provider-specific transport and normalization.
4. `ModelRegistry` and stores provide the control-plane data boundary; memory implementations make local tests deterministic.
5. `RequestClassifier` produces a validated semantic demand vector before automatic production routing.

## Simulator first

The simulator is intentionally the default provider. It exercises complete and SSE paths without credentials, network calls, or billing. Real adapters can be added behind the same `ProviderAdapter` interface after their contract tests exist.

## Routing behavior

Each model can carry a versioned multidimensional capability vector. Automatic async routing merges deterministic request facts with a validated DeepSeek V4 Flash demand vector, applies hard policy and quality constraints, Pareto-prunes only safe same-provider supersets, and selects the cheapest qualifying candidate. Deep-reasoning support is deliberately checked after initial selection; an incompatible candidate is promoted to the next cheapest reasoning-capable option.

The synchronous `decide()` path remains available for deterministic replay and offline evaluation. Classifier timeout or invalid output can either degrade to that path or fail closed according to `CLASSIFIER_MODE`.

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
