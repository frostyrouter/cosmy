# Public API contracts

Status: Proposed. OpenAPI definitions will become the executable authority during implementation.

## API styles

Cosmy exposes:

- Normalized Router API for full functionality
- Selected compatibility APIs for migration
- Administrative Control API
- Evaluation and simulation APIs

All APIs use explicit versions. Experimental fields are namespaced and disabled by default.

## Authentication

Supported modes:

- Project API key
- OAuth 2.0 access token
- Workload identity federation
- Mutual TLS for private deployments

Credentials identify tenant, project, environment, principal, and scopes. Provider credentials are never accepted in ordinary request bodies.

## Create response

```http
POST /v1/responses
Authorization: Bearer <cosmy-credential>
Idempotency-Key: <unique-key>
Content-Type: application/json
```

```json
{
  "model": "auto",
  "input": [
    {
      "role": "user",
      "content": [{"type": "input_text", "text": "Rewrite this email professionally."}]
    }
  ],
  "tools": [],
  "response_format": {"type": "text"},
  "stream": true,
  "routing": {
    "quality_floor": 0.85,
    "max_cost_usd": 0.02,
    "latency_slo_ms": 3000,
    "allowed_providers": ["provider-a", "provider-b"],
    "explain": "summary"
  },
  "metadata": {"workflow": "email-editor"}
}
```

## Routing controls

Request controls may tighten but cannot relax effective tenant policy.

```ts
interface RoutingControls {
  qualityFloor?: number;
  maxCost?: Money;
  latencySloMs?: number;
  allowedProviders?: string[];
  deniedProviders?: string[];
  allowedModels?: string[];
  dataRegion?: string;
  validationMode?: "none" | "schema" | "standard" | "strict";
  fallbackMode?: "none" | "availability" | "validation" | "all";
  explain?: "none" | "summary" | "detailed";
}
```

## Non-streaming response

```json
{
  "id": "resp_...",
  "object": "response",
  "status": "completed",
  "created_at": "2026-08-08T00:00:00Z",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [{"type": "output_text", "text": "..."}]
    }
  ],
  "usage": {
    "input_tokens": 120,
    "cached_input_tokens": 0,
    "output_tokens": 80,
    "provider_reported": true
  },
  "routing": {
    "decision_id": "rtd_...",
    "selected_model": "provider/model-version",
    "configuration": "standard-low",
    "reason_codes": ["task.email_rewrite", "quality.above_floor", "cost.minimum"],
    "registry_version": "reg_...",
    "policy_version": "pol_..."
  }
}
```

Provider request IDs and detailed scores are available only to authorized principals.

## Streaming protocol

The default HTTP stream uses server-sent events. Canonical event types include:

```text
response.created
response.route.selected
response.output_item.added
response.content_part.added
response.output_text.delta
response.tool_call.arguments.delta
response.usage.updated
response.output_item.done
response.completed
response.failed
```

Every event contains response ID, sequence number, event type, and typed payload. Sequence numbers are monotonic per response. Clients ignore unknown event types for forward compatibility.

Implementation note: typed text, route, tool-call, usage, completion, and failure events are implemented. See [normalized tools and events](30-normalized-tools-and-events.md). Cancellation endpoints and asynchronous reconnect remain proposed.

## Cancellation

Closing the client connection requests cancellation but is not proof of provider cancellation. An explicit endpoint is available for asynchronous work:

```http
POST /v1/responses/{response_id}/cancel
```

Cancellation is idempotent. The final status distinguishes client cancellation, provider cancellation, and completion raced with cancellation.

## Tool calls

Tool definitions use JSON Schema. The canonical tool loop distinguishes:

- Client-executed tools
- Cosmy-managed tools
- Provider-hosted tools

Provider-hosted tools are non-portable capabilities and must be named in route eligibility. Tool results reference stable call IDs. Parallel calls preserve individual status and errors.

Implementation note: provider calls are normalized and returned for client execution, including fragmented streaming arguments. Stateless tool-result continuation is implemented through assistant `toolCalls` plus matched tool messages; see [tool-result continuations](31-tool-result-continuations.md). A Cosmy-managed execution loop remains proposed.

## Structured output

Cosmy validates canonical output schemas before provider invocation. Adapters declare their supported JSON Schema subset. A route is ineligible if it cannot preserve required constraints.

Provider syntax guarantees do not replace semantic validation. Applications remain responsible for domain rules.

## Idempotency

Idempotency scope is tenant, project, endpoint, and key. The server stores a request digest. Reusing a key with a different digest returns `idempotency_conflict`.

For completed requests, the original terminal response is returned. For in-progress requests, the caller receives current status or reconnect information. Retention duration is documented per plan.

## Errors

```json
{
  "error": {
    "type": "no_eligible_model",
    "code": "context_limit",
    "message": "No allowed model can accept the normalized context.",
    "request_id": "req_...",
    "retryable": false,
    "details": {"required_tokens": 250000}
  }
}
```

Top-level types include:

- `authentication_error`
- `authorization_error`
- `invalid_request`
- `policy_rejection`
- `budget_exceeded`
- `no_eligible_model`
- `rate_limited`
- `provider_unavailable`
- `provider_error`
- `validation_failed`
- `timeout`
- `cancelled`
- `internal_error`

Errors declare retryability and safe retry timing. Raw provider errors are redacted and mapped.

## Explain endpoint

Implementation note: the current endpoint is tenant-scoped, requires `routing:read`, and uses the response request ID as its decision ID. See [routing query APIs](28-routing-query-apis.md).

```http
GET /v1/routing/decisions/{decision_id}
```

Authorized output includes effective constraints, rejected-candidate reason codes, normalized candidate metrics, selection reason, attempts, fallback behavior, and version references. It excludes provider credentials, private prompts beyond retention policy, and hidden chain-of-thought.

## Simulate endpoint

Implementation note: deterministic non-provider simulation is implemented at this path. External classification is deliberately skipped so simulation cannot create provider charges.

```http
POST /v1/routing/simulate
```

Simulation runs normalization, feature extraction, filtering, and ranking without provider execution or billable generation. Callers may specify a proposed registry or policy version. Results are clearly marked non-binding because provider health can change.

## Models endpoint

Implementation note: enabled rollout-visible model discovery is implemented at this path and requires `routing:read`.

```http
GET /v1/models
```

Returns only models visible to the caller, with stable Cosmy IDs, lifecycle state, portable capabilities, and policy-relevant limitations. Pricing is returned only when authorized and includes effective timestamp.

## Administrative APIs

Administrative mutations require optimistic concurrency and audit reason:

```http
If-Match: <resource-version>
X-Change-Reason: <ticket-or-explanation>
```

High-impact actions such as credential rotation, provider enablement, policy relaxation, and model promotion may require dual approval.

## Compatibility policy

Compatibility endpoints document:

- Supported request fields
- Ignored fields, if any
- Rejected fields
- Event translation
- Error translation
- Tool semantics
- State and continuation semantics

Silent loss of requested behavior is prohibited.
