# Provider runtime configuration

The router can run with the simulator only, or register external providers from environment configuration. A provider is activated only when both its API key and model name are present. This prevents a partially configured provider from entering the routing registry.

## Configuration contract

The supported provider pairs are:

| Provider | API key | Model |
| --- | --- | --- |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL` |

Optional `*_BASE_URL` variables support a compatible gateway or test server. The model manifest also accepts provider-specific quality, coordinate, region, context, output, and price variables. Pricing must be configured from the provider account or an approved catalog before production routing; development defaults are estimates only.

## Request lifecycle

At startup, configured manifests are merged with the simulator manifest. The provider factory creates one adapter per configured provider, and the application wraps every adapter in `ResilientProvider`.

Each complete or stream attempt has:

1. A request-local timeout.
2. A bounded retry count.
3. Exponential backoff between retryable failures.
4. A circuit breaker that opens after repeated failures.
5. Parent-request cancellation propagation.

Streaming retries are allowed only before the first output delta. Once visible output has been emitted, restarting could duplicate content, so the failure is surfaced to the caller instead.

## Production requirements

The in-memory breaker is appropriate for one process and local development. A multi-instance deployment should replace it with a shared or instance-aware health store, otherwise each worker will learn provider health independently. Retry budgets should also be bounded per tenant and provider to avoid retry storms.
