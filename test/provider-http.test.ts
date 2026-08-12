import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import type { ModelConfiguration } from '../src/domain/types.js';

const model: ModelConfiguration = {
  id: 'openai-test', provider: 'openai', model: 'gpt-test', version: 'test', enabled: true,
  capabilities: ['streaming', 'tools', 'structured-output'], modalities: ['text'],
  coordinates: { technicality: 0.8, creativity: 0.6, quality: 0.9, reasoning: 0.8 },
  capabilityVector: { version: 'v1', technicalDifficulty: 0.8, reasoningDepth: 0.8, creativity: 0.6, designSkill: 0.7, factualPrecision: 0.9, ambiguity: 0.8, toolComplexity: 0.8, contextComplexity: 0.8, codingIntensity: 0.8, safetyStakes: 0.9 },
  pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 }, contextWindow: 10_000, maxOutputTokens: 2_000,
  regions: ['global'], allowedDataClasses: ['public', 'internal'], health: { availability: 1, latencyP95Ms: 100, errorRate: 0, checkedAt: 'test' },
};

describe('OpenAI provider adapter', () => {
  it('normalizes a Responses API completion', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test', http: { request: async (_url, init) => {
      expect(init.headers).toMatchObject({ authorization: 'Bearer test' });
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'gpt-test', stream: false });
      return new Response(JSON.stringify({ output_text: 'hello', usage: { input_tokens: 2, output_tokens: 3 }, status: 'completed' }), { status: 200 });
    } } }, [model]);
    const result = await provider.complete({ request: { messages: [{ role: 'user', content: 'hi' }] }, model, signal: new AbortController().signal });
    expect(result.output).toBe('hello');
    expect(result.usage.totalTokens).toBe(5);
  });

  it('normalizes SSE text deltas and completion', async () => {
    const stream = ['event: response.output_text.delta\ndata: {"delta":"he"}\n\n', 'event: response.output_text.delta\ndata: {"delta":"llo"}\n\n', 'event: response.completed\ndata: {"usage":{"input_tokens":1,"output_tokens":2}}\n\n'].join('');
    const provider = new OpenAIProvider({ apiKey: 'test', http: { request: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(stream)); controller.close(); } }), { status: 200 }) } }, [model]);
    const chunks = [];
    for await (const chunk of provider.stream({ request: { requestId: 'req_1', messages: [{ role: 'user', content: 'hi' }] }, model, signal: new AbortController().signal })) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.delta).join('')).toBe('hello');
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.at(-1)?.usage?.totalTokens).toBe(3);
  });

  it('normalizes complete and fragmented Responses API function calls', async () => {
    const stream = [
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"call_1","name":"weather","arguments":""}}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"output_index":0,"delta":"{\\"city\\":\\"Pa"}\n\n',
      'event: response.function_call_arguments.delta\ndata: {"output_index":0,"delta":"ris\\"}"}\n\n',
      'event: response.function_call_arguments.done\ndata: {"output_index":0,"arguments":"{\\"city\\":\\"Paris\\"}"}\n\n',
      'event: response.completed\ndata: {"response":{"usage":{"input_tokens":2,"output_tokens":4}}}\n\n',
    ].join('');
    const responses = [
      new Response(JSON.stringify({ output: [{ type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '{"city":"Paris"}' }], usage: { input_tokens: 2, output_tokens: 4 }, status: 'completed' }), { status: 200 }),
      new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(stream)); controller.close(); } }), { status: 200 }),
    ];
    const provider = new OpenAIProvider({ apiKey: 'test', http: { request: async () => responses.shift()! } }, [model]);
    const complete = await provider.complete({ request: { requestId: 'req_tools', messages: [{ role: 'user', content: 'weather' }] }, model, signal: new AbortController().signal });
    expect(complete).toMatchObject({ finishReason: 'tool_calls', toolCalls: [{ id: 'call_1', name: 'weather', arguments: { city: 'Paris' } }] });
    const chunks = [];
    for await (const chunk of provider.stream({ request: { requestId: 'req_tools', messages: [{ role: 'user', content: 'weather' }] }, model, signal: new AbortController().signal })) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['tool-call-added', 'tool-call-arguments-delta', 'tool-call-arguments-delta', 'tool-call-done', 'completed']);
    expect(chunks.at(-2)?.toolArguments).toEqual({ city: 'Paris' });
    expect(chunks.at(-1)?.usage?.totalTokens).toBe(6);
  });

  it('emits a trailing SSE data line without a final newline', async () => {
    const stream = 'event: response.output_text.delta\ndata: {"delta":"tail"}';
    const provider = new OpenAIProvider({ apiKey: 'test', http: { request: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(stream)); controller.close(); } }), { status: 200 }) } }, [model]);
    const chunks = [];
    for await (const chunk of provider.stream({ request: { requestId: 'req_2', messages: [{ role: 'user', content: 'hi' }] }, model, signal: new AbortController().signal })) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.delta).join('')).toBe('tail');
  });

  it('includes the required name and a non-empty schema for json-schema output', async () => {
    let captured: Record<string, unknown>;
    const provider = new OpenAIProvider({ apiKey: 'test', http: { request: async (_url, init) => { captured = JSON.parse(String(init.body)); return new Response(JSON.stringify({ output_text: '{}', usage: { input_tokens: 1, output_tokens: 1 }, status: 'completed' }), { status: 200 }); } } }, [model]);
    await provider.complete({ request: { messages: [{ role: 'user', content: 'json' }], responseFormat: { type: 'json-schema' } }, model, signal: new AbortController().signal });
    const format = (captured!.text as Record<string, unknown>).format as Record<string, unknown>;
    expect(format).toMatchObject({ type: 'json_schema', name: 'response' });
    expect(format.schema).toMatchObject({ type: 'object' });
  });
});

describe('multi-provider normalization', () => {
  it('normalizes an Anthropic Messages response and separates system input', async () => {
    const anthropicModel = { ...model, id: 'anthropic-test', provider: 'anthropic', model: 'claude-test' };
    const provider = new AnthropicProvider({ apiKey: 'test', http: { request: async (_url, init) => {
      expect(init.headers).toMatchObject({ 'x-api-key': 'test', 'anthropic-version': '2023-06-01' });
      expect(JSON.parse(String(init.body))).toMatchObject({ model: 'claude-test', system: 'Be concise', messages: [{ role: 'user', content: 'hi' }] });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 4, output_tokens: 2 }, stop_reason: 'end_turn' }), { status: 200 });
    } } }, [anthropicModel]);
    const result = await provider.complete({ request: { messages: [{ role: 'system', content: 'Be concise' }, { role: 'user', content: 'hi' }] }, model: anthropicModel, signal: new AbortController().signal });
    expect(result.output).toBe('hello');
    expect(result.usage.totalTokens).toBe(6);
  });

  it('normalizes Anthropic tool-use blocks', async () => {
    const anthropicModel = { ...model, id: 'anthropic-tools', provider: 'anthropic', model: 'claude-test' };
    const provider = new AnthropicProvider({ apiKey: 'test', http: { request: async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'tool_1', name: 'weather', input: { city: 'Paris' } }], usage: { input_tokens: 3, output_tokens: 2 }, stop_reason: 'tool_use' }), { status: 200 }) } }, [anthropicModel]);
    const result = await provider.complete({ request: { requestId: 'req_a', messages: [{ role: 'user', content: 'weather' }] }, model: anthropicModel, signal: new AbortController().signal });
    expect(result).toMatchObject({ finishReason: 'tool_calls', toolCalls: [{ id: 'tool_1', name: 'weather', arguments: { city: 'Paris' } }] });
  });

  it('normalizes fragmented Anthropic tool-use streams', async () => {
    const anthropicModel = { ...model, id: 'anthropic-stream-tools', provider: 'anthropic', model: 'claude-test' };
    const stream = [
      'event: message_start\ndata: {"message":{"usage":{"input_tokens":3,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"weather","input":{}}}\n\n',
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"Paris\\"}"}}\n\n',
      'event: content_block_stop\ndata: {"index":0}\n\n',
      'event: message_delta\ndata: {"usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {}\n\n',
    ].join('');
    const provider = new AnthropicProvider({ apiKey: 'test', http: { request: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(stream)); controller.close(); } }), { status: 200 }) } }, [anthropicModel]);
    const chunks = [];
    for await (const chunk of provider.stream({ request: { requestId: 'req_as', messages: [{ role: 'user', content: 'weather' }] }, model: anthropicModel, signal: new AbortController().signal })) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['tool-call-added', 'tool-call-arguments-delta', 'tool-call-done', 'completed']);
    expect(chunks.at(-2)?.toolArguments).toEqual({ city: 'Paris' });
    expect(chunks.at(-1)?.usage?.totalTokens).toBe(7);
  });

  it('normalizes a Gemini Generate Content response', async () => {
    const geminiModel = { ...model, id: 'gemini-test', provider: 'gemini', model: 'gemini-test' };
    const provider = new GeminiProvider({ apiKey: 'test', http: { request: async (url, init) => {
      expect(url).toContain('/models/gemini-test:generateContent');
      expect(url).toContain('key=test');
      expect(JSON.parse(String(init.body))).toMatchObject({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } }), { status: 200 });
    } } }, [geminiModel]);
    const result = await provider.complete({ request: { messages: [{ role: 'user', content: 'hi' }] }, model: geminiModel, signal: new AbortController().signal });
    expect(result.output).toBe('hello');
    expect(result.usage.totalTokens).toBe(5);
  });

  it('normalizes Gemini function calls with a stable synthetic ID', async () => {
    const geminiModel = { ...model, id: 'gemini-tools', provider: 'gemini', model: 'gemini-test' };
    const provider = new GeminiProvider({ apiKey: 'test', http: { request: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'weather', args: { city: 'Paris' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } }), { status: 200 }) } }, [geminiModel]);
    const result = await provider.complete({ request: { requestId: 'req_g', messages: [{ role: 'user', content: 'weather' }] }, model: geminiModel, signal: new AbortController().signal });
    expect(result).toMatchObject({ finishReason: 'tool_calls', toolCalls: [{ id: 'req_g:tool:0', name: 'weather', arguments: { city: 'Paris' } }] });
  });

  it('normalizes Gemini streamed function calls into canonical lifecycle events', async () => {
    const geminiModel = { ...model, id: 'gemini-stream-tools', provider: 'gemini', model: 'gemini-test' };
    const stream = 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"weather","args":{"city":"Paris"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2}}\n\n';
    const provider = new GeminiProvider({ apiKey: 'test', http: { request: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(stream)); controller.close(); } }), { status: 200 }) } }, [geminiModel]);
    const chunks = [];
    for await (const chunk of provider.stream({ request: { requestId: 'req_gs', messages: [{ role: 'user', content: 'weather' }] }, model: geminiModel, signal: new AbortController().signal })) chunks.push(chunk);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['tool-call-added', 'tool-call-arguments-delta', 'tool-call-done', 'completed']);
    expect(chunks.at(-2)).toMatchObject({ toolCallId: 'req_gs:tool:0', toolArguments: { city: 'Paris' } });
  });
});

describe('tool-result continuation requests', () => {
  const messages = [
    { role: 'user' as const, content: 'What is the weather?' },
    { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_1', name: 'weather', arguments: { city: 'Paris' } }] },
    { role: 'tool' as const, content: '{"temperature":20}', name: 'weather', toolCallId: 'call_1' },
  ];

  it('preserves calls and results in OpenAI Responses input items', async () => {
    let body: Record<string, unknown> = {};
    const provider = new OpenAIProvider({ apiKey: 'test', http: { request: async (_url, init) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ output_text: '20C', usage: {}, status: 'completed' }), { status: 200 }); } } }, [model]);
    await provider.complete({ request: { messages }, model, signal: new AbortController().signal });
    expect(body.input).toEqual([
      { role: 'user', content: 'What is the weather?' },
      { type: 'function_call', call_id: 'call_1', name: 'weather', arguments: '{"city":"Paris"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"temperature":20}' },
    ]);
  });

  it('preserves calls and results in Anthropic content blocks', async () => {
    let body: Record<string, unknown> = {};
    const anthropicModel = { ...model, provider: 'anthropic', model: 'claude-test' };
    const provider = new AnthropicProvider({ apiKey: 'test', http: { request: async (_url, init) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: '20C' }], usage: {}, stop_reason: 'end_turn' }), { status: 200 }); } } }, [anthropicModel]);
    await provider.complete({ request: { messages }, model: anthropicModel, signal: new AbortController().signal });
    expect(body.messages).toEqual([
      { role: 'user', content: 'What is the weather?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_1', name: 'weather', input: { city: 'Paris' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '{"temperature":20}' }] },
    ]);
  });

  it('groups parallel Anthropic tool results into one user turn', async () => {
    let body: Record<string, unknown> = {};
    const parallel = [
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_1', name: 'weather', arguments: {} }, { id: 'call_2', name: 'clock', arguments: {} }] },
      { role: 'tool' as const, content: 'sunny', name: 'weather', toolCallId: 'call_1' },
      { role: 'tool' as const, content: 'noon', name: 'clock', toolCallId: 'call_2' },
    ];
    const anthropicModel = { ...model, provider: 'anthropic', model: 'claude-test' };
    const provider = new AnthropicProvider({ apiKey: 'test', http: { request: async (_url, init) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ content: [], usage: {}, stop_reason: 'end_turn' }), { status: 200 }); } } }, [anthropicModel]);
    await provider.complete({ request: { messages: parallel }, model: anthropicModel, signal: new AbortController().signal });
    expect((body.messages as Array<{ content: unknown[] }>).at(-1)?.content).toHaveLength(2);
  });

  it('preserves calls and matching IDs in Gemini function parts', async () => {
    let body: Record<string, unknown> = {};
    const geminiModel = { ...model, provider: 'gemini', model: 'gemini-test' };
    const provider = new GeminiProvider({ apiKey: 'test', http: { request: async (_url, init) => { body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '20C' }] }, finishReason: 'STOP' }], usageMetadata: {} }), { status: 200 }); } } }, [geminiModel]);
    await provider.complete({ request: { messages }, model: geminiModel, signal: new AbortController().signal });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'What is the weather?' }] },
      { role: 'model', parts: [{ functionCall: { id: 'call_1', name: 'weather', args: { city: 'Paris' } } }] },
      { role: 'user', parts: [{ functionResponse: { id: 'call_1', name: 'weather', response: { result: { temperature: 20 } } } }] },
    ]);
  });
});
