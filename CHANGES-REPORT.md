# Cosmy Repo Change Report

Generated: 2026-08-08
Repository: https://github.com/frostyrouter/cosmy
Local checkout: `/Users/administrator/Cosmy` on branch `sync-main-report` (synced to `origin/main` @ `1731e3a`)

## 1. What happened locally

- `/Users/administrator/Cosmy` was not a git repository; it contained only `.DS_Store` and a
  pre-existing `codex-installed-skills/` folder.
- The repo was initialized with `git init`, the `origin` remote was added, and `main` was fetched.
- A **separate branch `sync-main-report`** was created from `origin/main` and checked out, so the
  local folder now contains the exact contents of the repo's `main` branch.
- Local-only leftovers that are NOT part of the repo: `codex-installed-skills/` and `.DS_Store`
  (both untracked; `codex-installed-skills` was historically in the repo and was later removed —
  see commit history below).

## 2. Project overview

Cosmy is a provider-neutral AI model routing platform (in architecture + phase-1 vertical slice
stage). Applications send one normalized request; Cosmy selects an eligible provider/model using
policy, measured quality, cost, latency, and reliability data. The governing principle: choose the
least expensive configuration predicted to satisfy the request, validate where practical, and
escalate when evidence shows the chosen config did not meet the requirement.

## 3. Full commit history (what was added / removed / modified)

### 8794621e — "Initial commit" (2026-08-07 17:28)
- ADDED: `README.md`

### d8d460c2 — "Update README.md" (2026-08-07 17:29)
- MODIFIED: `README.md`

### f87e1271 — "Add Codex installed skills export" (2026-08-07 17:59)
- ADDED: `codex-installed-skills/README.md` plus the full export of installed Codex skills
  (`openai-bundled` browser/computer-use/sites/visualize plugins; `openai-curated-remote`
  data-analytics, github, openai-templates, remotion plugins — several hundred files:
  SKILL.md, agents/openai.yaml, references, scripts, templates, assets).

### 7e2cd14a — "Remove exported Codex skills" (2026-08-07 18:17)
- REMOVED: `README.md` and the ENTIRE `codex-installed-skills/` tree (all skill files above).
- Net effect: repo wiped back to (almost) empty.

### PR #1 — agent/production-router-architecture (merged aae15edf, 2026-08-07 19:26)
Commits 4099a2c8, 741a4c3f, 66c020e8, ab9372c9 added the full architecture documentation set:
- ADDED: `README.md` (project overview, status, governing principle)
- ADDED: `Docs/README.md` (docs index)
- ADDED: `Docs/CONTRIBUTING.md` (contribution and release policy)
- ADDED: `Docs/00-product-charter.md` — product charter
- ADDED: `Docs/01-requirements-slos.md` — requirements and SLOs
- ADDED: `Docs/02-system-architecture.md` — system architecture
- ADDED: `Docs/03-routing-engine.md` — routing engine design
- ADDED: `Docs/04-model-registry.md` — model registry and onboarding
- ADDED: `Docs/05-api-contracts.md` — public API contracts
- ADDED: `Docs/06-provider-adapters.md` — provider adapter contracts
- ADDED: `Docs/07-data-architecture.md` — data architecture
- ADDED: `Docs/08-reliability-scaling.md` — reliability and scaling
- ADDED: `Docs/09-security-privacy.md` — security, privacy, governance
- ADDED: `Docs/10-observability-evals.md` — observability and evaluations
- ADDED: `Docs/11-deployment-options.md` — deployment options
- ADDED: `Docs/12-delivery-roadmap.md` — delivery roadmap
- ADDED: `Docs/13-function-catalog.md` — function/module catalog
- ADDED: `Docs/14-alternatives.md` — alternatives and trade-offs

### PR #2 — agent/phase-1-vertical-slice-router (merged 1731e3a, 2026-08-08 05:49)
The repo moved from docs-only to an executable TypeScript implementation:

- **99d9cb36 "Establish router runtime contracts"** ADDED:
  `.gitignore`, `package.json`, `package-lock.json`, `tsconfig.json`,
  `src/config.ts`, `src/domain/errors.ts`, `src/domain/types.ts`,
  `src/ports/provider.ts`, `src/ports/stores.ts`, `src/util/ids.ts`
- **f9825b87 "Add executable response API vertical slice"** ADDED:
  `Docs/15-phase-1-implementation.md`, `src/api/http.ts`, `src/api/schemas.ts`,
  `src/app.ts`, `src/execution/executor.ts`, `src/index.ts`,
  `src/providers/simulator.ts`, `src/server.ts`, `src/service/router-service.ts`,
  `src/stores/memory-health-store.ts`, `src/stores/memory-usage-ledger.ts`,
  `test/http.test.ts`, `test/routing.test.ts`, `test/stores.test.ts`
- **a8c99633 "Add development environment template"** ADDED:
  `.env.example`; MODIFIED: `.gitignore`
- **88448ac5 "Reconcile budget reservations and usage totals"** MODIFIED:
  `src/execution/executor.ts`, `src/ports/stores.ts`, `src/providers/simulator.ts`,
  `src/stores/memory-usage-ledger.ts`, `test/http.test.ts`, `test/stores.test.ts`;
  ADDED: `test/usage-reconciliation.test.ts`

Note: merge commit 1731e3a's combined diff also shows `src/routing/features.ts`,
`src/routing/policy.ts`, `src/routing/router.ts`, `src/registry/default-models.ts`,
`src/registry/memory-registry.ts` (routing/registry code present in the merged tree).

## 4. Current file inventory (every file, what it does)

### Root
| File | Purpose |
|---|---|
| `README.md` | Project overview: what Cosmy is, status (architecture + phase 1 slice), governing principle |
| `.env.example` | Environment template: `HOST`, `PORT`, `LOG_LEVEL`, `ROUTER_ENV` |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.env`, coverage, logs |
| `package.json` | Node >= 20, ESM; deps: fastify, @fastify/cors, @fastify/rate-limit, pino, zod; dev: typescript, tsx, vitest. Scripts: build/dev/start/test/lint |
| `package-lock.json` | Locked dependency tree |
| `tsconfig.json` | Strict TS config, ES2022/NodeNext, `dist` output |

### src/domain — core types & errors
| File | Purpose |
|---|---|
| `src/domain/types.ts` | All domain contracts: modalities/capabilities/data classes, `ChatMessage`, `ResponseRequest`, `PolicyHints`, `ModelConfiguration`, `RequestFeatures`, `RouteCandidate`, `RouteDecision`, `Usage`, `ResponseResult`, `ResponseChunk` |
| `src/domain/errors.ts` | `RouterError` base + `InvalidRequestError`, `NoRouteError`, `ProviderError`, `RequestCancelledError` with HTTP status codes |

### src/ports — interfaces (dependency inversion)
| File | Purpose |
|---|---|
| `src/ports/provider.ts` | `ProviderAdapter` interface: listModels/complete/stream, plus `ProviderRequest`/`ProviderResponse` |
| `src/ports/stores.ts` | `ModelRegistry`, `UsageLedger` (reserve/reconcile), `UsageReservation`, `HealthStore` interfaces |

### src/routing — the router itself
| File | Purpose |
|---|---|
| `src/routing/features.ts` | Extracts `RequestFeatures` from a request: token estimates, keyword-based technicality/creativity/reasoning scores, modality/tool/stream/structured-output detection |
| `src/routing/policy.ts` | Eligibility filtering (context window, capabilities, data class, region, quality floor...) and weighted score ranking (quality/cost/latency/creativity/technicality/reasoning); `defaultPolicy` |
| `src/routing/router.ts` | `DeterministicRouter`: picks explicit model if requested, else best ranked candidate; emits `RouteDecision` with alternatives and rejections |

### src/registry — model catalog
| File | Purpose |
|---|---|
| `src/registry/default-models.ts` | Three seeded simulated models: `sim-small-text` (cheap), `sim-balanced`, `sim-frontier` (expensive, full capabilities) |
| `src/registry/memory-registry.ts` | `InMemoryModelRegistry`: snapshot/get/replace backed by a Map |

### src/providers — LLM provider implementations
| File | Purpose |
|---|---|
| `src/providers/simulator.ts` | `SimulatorProvider`: deterministic fake completions ("Rewritten: ...", JSON answer) + streaming; `providerForModel()` lookup |

### src/execution — request execution
| File | Purpose |
|---|---|
| `src/execution/executor.ts` | `RequestExecutor`: reserves budget, calls provider (complete or SSE stream), reconciles actual cost, records health success/failure; `abortAfter()` timeout helper |

### src/stores — in-memory state
| File | Purpose |
|---|---|
| `src/stores/memory-usage-ledger.ts` | `InMemoryUsageLedger`: per-tenant budget reservation, reconcile reservation to actual spend, spent/reserved queries |
| `src/stores/memory-health-store.ts` | `InMemoryHealthStore`: per-model success/failure counters |

### src/api, src/service, src/util
| File | Purpose |
|---|---|
| `src/api/schemas.ts` | Zod validation schema for `POST /v1/responses` request body |
| `src/api/http.ts` | Fastify routes: `GET /healthz`, `GET /readyz`, `POST /v1/responses` (JSON or SSE streaming), error normalization |
| `src/service/router-service.ts` | `RouterService`: orchestrates decide → execute (complete or stream), request ID generation |
| `src/util/ids.ts` | `requestId()` (req_UUID), `nowIso()`, `clamp()` |
| `src/app.ts` | `buildApp()` composition root: wires registry, ledger, health store, simulator provider, router, executor, service, CORS, rate limiting |
| `src/index.ts` | Public library exports (app, domain, routing, registry, providers) |
| `src/server.ts` | Entry point: loads config, builds app, listens on HOST:PORT |

### test — vitest suite
| File | Purpose |
|---|---|
| `test/http.test.ts` | API tests: normalized completion + routing/usage metadata, invalid request rejection, streaming |
| `test/routing.test.ts` | Feature extraction and eligibility/ranking behavior |
| `test/stores.test.ts` | Usage ledger budget reservation and reconciliation |
| `test/usage-reconciliation.test.ts` | Reservation released on provider failure |

## 5. Net summary

- ADDED since repo start: 3 seed files (README/.gitignore/package set), 18 architecture docs, a
  complete 23-file TypeScript router implementation, 4 test files, env template.
- REMOVED over history: the entire `codex-installed-skills/` export (added then removed in the
  first day) — this is why the local untracked `codex-installed-skills/` folder is not in the repo.
- Current branch tip: `1731e3a` — repo state = docs (Docs/) + phase-1 executable router (src/ + test/).

## 6. How to run

```
npm install
npm test          # vitest suite
npm run dev       # starts server on port 8080 (ROUTER_ENV=development)
curl -X POST localhost:8080/v1/responses -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Rewrite this email politely"}]}'
```

## 7. Verification

- `npm install` + `npm test`: all 10 repo tests pass (http, routing, stores, usage-reconciliation).
- One vitest suite fails only because the pre-existing untracked `codex-installed-skills/`
  folder still contains a stale template test file (`vinext-starter/tests/rendered-html.test.mjs`).
  It is not part of the repo — deleting that folder (or adding `codex-installed-skills/` to
  `.gitignore`) makes `npm test` fully green.

