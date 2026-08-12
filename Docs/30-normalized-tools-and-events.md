# Normalized tool calls and streaming events

Cosmy keeps one provider-neutral message endpoint, `POST /v1/responses`, while preserving provider tool calls and typed stream state.

## Non-streaming responses

When a model requests client-side function execution, the response includes:

```json
{
  "output": "",
  "toolCalls": [
    { "id": "call_weather_1", "name": "weather", "arguments": { "city": "Paris" } }
  ],
  "finishReason": "tool_calls"
}
```

OpenAI `function_call`, Anthropic `tool_use`, and Gemini `functionCall` responses map to this shape. Native call IDs are preserved when present; otherwise Cosmy creates a request-stable ID. Invalid argument JSON, non-object arguments, missing/invalid tool names, and oversized call IDs are normalized safely instead of leaking native payload errors.

## Streaming SSE

Each SSE data object contains `responseId`, a monotonic `sequence`, `type`, and a typed payload. Current events are:

- `response.created`
- `response.route.selected`
- `response.output_text.delta`
- `response.output_item.added` for a tool call
- `response.tool_call.arguments.delta`
- `response.output_item.done`
- `response.usage.updated`
- `response.completed`
- `response.failed`

Parallel provider tool calls retain their native output index and stable call ID. Tool events count as visible output, so an interrupted stream cannot silently retry on another model after the caller has observed a tool call. A pre-output retryable failure may still use an eligible fallback.

## Boundaries

This milestone returns calls for client execution; it does not execute tools inside Cosmy and does not yet accept a first-class `tool_call_id` result object for a managed multi-turn loop. The existing message shape can carry textual tool context, but full continuation semantics require a versioned canonical input-item contract. Provider-hosted tools are also outside this portable function-call subset.
