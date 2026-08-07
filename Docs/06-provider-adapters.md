# Provider adapter contracts

Status: Proposed.

## Purpose

Adapters isolate provider-specific authentication, request schemas, event protocols, tools, usage, errors, and feature differences from the routing core.

An adapter is not a thin HTTP wrapper. It is a semantic compatibility boundary with executable conformance tests.

## Interface

```ts
interface ProviderAdapter {
  readonly adapterId: string;
  readonly contractVersion: string;

  capabilities(context: CapabilityContext): Promise<AdapterCapabilities>;
  estimate(request: CanonicalRequest, config: ModelConfiguration): UsageEstimate;
  validate(request: CanonicalRequest, config: ModelConfiguration): ValidationResult;
  execute(context: AttemptContext): AsyncIterable<CanonicalProviderEvent>;
  cancel(handle: ProviderExecutionHandle): Promise<CancellationResult>;
  normalizeError(error: unknown, context: ErrorContext): CanonicalProviderError;
  reconcile(usage: ProviderUsage, pricing: PricingSchedule): CostBreakdown;
  health(probe: HealthProbe): Promise<ProviderHealth>;
}
```

## Capability declaration

Capabilities include:

- Input and output modalities
- Streaming and event types
- Tool calls and parallel tools
- Provider-hosted tools
- Structured-output schema subset
- Context and output limits
- Reasoning controls
- Prompt caching controls
- Batch and asynchronous modes
- Stateful continuation
- Regions and endpoint variants
- Cancellation semantics

Capabilities are versioned and verified. Documentation claims alone do not activate a capability.

## Validation

`validate` is pure and does not call the provider. It checks:

- Canonical semantic support
- Schema subset compatibility
- Tool name and schema restrictions
- Content and attachment limits
- Provider-specific parameter combinations
- Continuation-handle compatibility
- Region and endpoint availability

It returns machine-readable issues and possible safe transformations. Transformations that change meaning require caller or policy consent.

## Execution

`execute` owns:

- Native request construction
- Authentication headers
- Connection and read deadlines
- Provider idempotency support
- SSE, WebSocket, or chunk decoding
- Tool-call delta accumulation
- Usage and resolved-model extraction
- Provider request identifiers
- Native terminal-state interpretation

The adapter emits canonical events as soon as they can be validated. It applies bounded buffering to incomplete JSON/tool fragments.

## Event normalization

Canonical event ordering rules:

- One `attempt.started` event precedes provider content.
- Output items are announced before deltas.
- Tool argument deltas reference a known call ID.
- Usage updates are monotonic when cumulative.
- Exactly one terminal attempt event is emitted.
- Unknown native events are recorded and ignored only when declared non-semantic.

Protocol violations produce `provider_protocol_error` and affect provider health.

## Retry semantics

Adapters classify errors by:

- Retryable before visible output
- Retryable with same provider
- Retryable with another endpoint
- Safe to fallback to another model
- Authentication or configuration failure
- Client-caused invalid request
- Rate limit with retry time
- Unknown outcome

After user-visible output, automatic retry is prohibited unless the protocol supports safe continuation or the API contract permits a new attempt marker.

## Usage normalization

Canonical usage separates:

- Input tokens
- Cached-input read tokens
- Cache-write tokens
- Output tokens
- Reasoning tokens when reported
- Image/audio/video units
- Provider tool units
- Batch, priority, or service-tier modifiers

Unknown usage is represented explicitly. The billing ledger never invents zero usage.

## OpenAI adapter notes

The adapter targets the Responses API for reasoning, tool-calling, and multi-turn workflows where supported. Model capability records must distinguish streaming, structured output, tools, and reasoning controls because support varies by model and endpoint. Official OpenAI documentation is the discovery source; conformance probes are the activation source.

The adapter must preserve response items, tool calls, usage, continuation identifiers, safety identifiers when required, and supported caching controls.

## Anthropic adapter notes

The Messages API uses structured message content and a top-level system prompt. Streaming uses server-sent events. Client tool use returns `tool_use` blocks and a stop reason; the application executes the tool and sends `tool_result` content. The adapter converts these native blocks into canonical tool events and preserves provider-hosted versus client-hosted execution semantics.

Prompt cache configuration is treated as a provider extension mapped to canonical cache intent when semantics align.

## Gemini adapter notes

The Gemini API provides unary, SSE streaming, real-time, batch, embedding, and media endpoints. Current primary documentation recommends the Interactions API for agentic, stateful, multimodal workflows while retaining content-generation endpoints. The adapter declares which native endpoint implements each canonical operation.

Function calls, structured output, thought metadata, and provider-hosted tools require explicit translation and compatibility tests. Canonical APIs do not expose provider-private reasoning content.

## Private inference adapter

Private or open-model deployments implement the same contract. Additional metadata includes tokenizer, quantization, tensor-parallel layout, serving engine, GPU class, autoscaling state, cold-start risk, and locality.

Cost estimation may use reserved-infrastructure allocation instead of provider token prices.

## Credential handling

- Adapters receive short-lived credential material through a secret broker.
- Credentials are scoped to provider, tenant, project, endpoint, and purpose.
- Adapters never persist plaintext credentials.
- Logs and errors redact headers and signed URLs.
- Credential failures open a configuration incident, not a general provider circuit.

## Connection management

- Pools are segmented by provider endpoint, region, and credential scope.
- Limits prevent one tenant from exhausting global sockets.
- DNS and TLS behavior are observable.
- Idle and maximum-lifetime settings account for provider behavior.
- Streaming backpressure is propagated to bounded provider buffers.

## Conformance suite

Every adapter must pass:

- Minimal text request
- Multiturn request
- Maximum accepted context boundary
- Streaming text and multibyte boundaries
- Tool call with fragmented arguments
- Parallel tool calls
- Structured output
- Usage extraction
- Cancellation before and during streaming
- Timeout and rate limit
- Authentication failure
- Provider 5xx
- Malformed event
- Unknown terminal state
- Model alias resolution
- Pricing reconciliation fixture

Provider tests run against mocks on every commit and against sandbox projects on a controlled schedule.

## Adapter rollout

New adapter versions run in shadow comparison. A router snapshot may contain multiple adapter versions. Canary traffic is segmented, metrics are compared, and rollback selects the previous adapter without model-registry reconstruction.
