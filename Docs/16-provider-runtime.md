# Provider runtime configuration

The router can run with the simulator only, or register external providers from environment configuration. A provider is activated only when both its API key and model name are present. This prevents a partially configured provider from entering the routing registry.

## Configuration contract

The supported provider pairs are:

| Provider | API key | Model |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL` |

The routing classifier is configured separately from executable providers:

| Component | API key | Model |
| --- | --- | --- |
| DeepSeek classifier | `DEEPSEEK_API_KEY` | `DEEPSEEK_CLASSIFIER_MODEL` (default `deepseek-v4-flash`) |

`CLASSIFIER_MODE` accepts `disabled`, `degrade`, or `fail`. Development defaults to `degrade` when a DeepSeek key is present; production defaults to `fail` and therefore refuses startup without a classifier. `CLASSIFIER_TIMEOUT_MS` defaults to 3000 and `CLASSIFIER_MAX_INPUT_CHARS` defaults to 200000. The classifier is not registered as an executable response provider and cannot select a model directly.

Optional `*_BASE_URL` variables support a compatible gateway or test server. The model manifest also accepts provider-specific quality, coordinate, region, context, output, and price variables. Pricing must be configured from the provider account or an approved catalog before production routing; development defaults are estimates only.

## Request lifecycle

At startup, configured manifests are merged with the simulator manifest. The provider factory creates one adapter per configured provider, and the application wraps every adapter in `ResilientProvider`.

Before provider execution, `RouterService` awaits semantic classification and the reasoning gate. Streaming does not emit headers or provider deltas until route construction completes.

`REQUEST_TIMEOUT_MS` bounds this routing work as well as provider execution. For streams it is a time-to-first-canonical-event deadline and is released after visible output begins. See [end-to-end deadlines](32-end-to-end-deadlines.md).

Each complete or stream attempt has:

1. A request-local timeout.
2. A bounded retry count.
3. Exponential backoff between retryable failures.
4. A circuit breaker that opens after repeated failures.
5. Parent-request cancellation propagation.

Streaming retries are allowed only before the first output delta. Once visible output has been emitted, restarting could duplicate content, so the failure is surfaced to the caller instead.

## Production requirements

Memory mode keeps breaker and health state inside one process. PostgreSQL mode instead writes every observed provider outcome to `provider_health_events`, atomically updates `provider_health_state`, and polls that shared snapshot every `HEALTH_REFRESH_SECONDS` (default 2). Local outcomes affect routing immediately; database writes are serialized on a dedicated pool and stay off the provider-response critical path. Other instances normally converge within one refresh interval.

Three consecutive observed failures make a model ineligible for the existing 30-second cooldown. A later success resets the shared consecutive-failure count. Set `HEALTH_REFRESH_SECONDS=0` only for a single instance or when an external refresh/restart mechanism exists. `health_store_failure` records asynchronous write and refresh failures; these failures preserve local routing state but reduce cross-instance freshness. Retry budgets should also be bounded per tenant and provider to avoid retry storms.
