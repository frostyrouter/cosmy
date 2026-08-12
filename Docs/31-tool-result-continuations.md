# Tool-result continuations

Clients can complete a portable function-call loop through the same `POST /v1/responses` API.

1. Send user messages and tool definitions.
2. Receive `toolCalls` with stable IDs and `finishReason: "tool_calls"`.
3. Execute those calls in the client.
4. Resend the full conversation: the assistant message carries the returned `toolCalls`, followed immediately by one `role: "tool"` message per result.

```json
{
  "messages": [
    { "role": "user", "content": "What is the weather?" },
    {
      "role": "assistant",
      "content": "",
      "toolCalls": [
        { "id": "call_1", "name": "weather", "arguments": { "city": "Paris" } }
      ]
    },
    {
      "role": "tool",
      "name": "weather",
      "toolCallId": "call_1",
      "content": "{\"temperature\":20}"
    }
  ],
  "tools": [
    { "name": "weather", "inputSchema": { "type": "object" } }
  ]
}
```

Cosmy validates unique IDs, declared tool names, exact name/ID matching, result ordering, and complete resolution of parallel calls before provider execution. Tool errors may set `toolError: true`. The adapters translate the canonical history to OpenAI `function_call`/`function_call_output`, Anthropic `tool_use`/`tool_result`, and Gemini `functionCall`/`functionResponse`, preserving call IDs.

Tool results are treated as untrusted external data: they remain in provider tool-result structures, are excluded from semantic route classification, and are excluded from shadow evaluation. Their text and prior tool arguments still count toward input-size and cost estimation.

Cosmy does not execute tools itself. Clients own authorization, user confirmation, side-effect idempotency, sandboxing, timeouts, and result sanitization. Provider-private thought/signature state and hosted tools are not portable through this stateless subset.
