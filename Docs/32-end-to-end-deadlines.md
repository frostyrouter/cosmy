# End-to-end request deadlines

`REQUEST_TIMEOUT_MS` is the latency ceiling from service admission through routing and the first provider result, rather than a provider-only timer.

For non-streaming requests, the deadline covers conversation validation, idempotency admission, semantic classification, route construction, planned-decision persistence, provider retries/fallbacks, and completion. A server deadline returns retryable HTTP 504 `timeout` and persists `errorCode: timeout` when a route was already planned. Caller disconnects remain distinct cancellations.

For streaming requests, the same timer covers classification, routing, planned-decision persistence, provider connection, retries, fallback, and time to first canonical event. Once the first text or tool event is visible, the deadline timer is disposed so a valid long-running stream is not truncated. Provider time-to-first-token guards and reservation heartbeats continue to apply.

## Operational guidance

- Set `CLASSIFIER_TIMEOUT_MS` below `REQUEST_TIMEOUT_MS`; the overall deadline is authoritative even when a component timeout is larger.
- Budget enough time for planned-decision persistence and provider connection, not only model generation.
- Alert on `timeout` by stage through logs/decision records; a pre-route classifier timeout has no route record because no safe decision exists yet.
- Store operations that do not accept cancellation still rely on their own bounded database/query timeouts. The service returns as soon as those operations settle and observes that the overall deadline expired.
