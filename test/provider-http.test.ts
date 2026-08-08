import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai.js';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import type { ModelConfiguration } from '../src/domain/types.js';

const model: ModelConfiguration = {
  id: 'openai-test', provider: 'openai', model: 'gpt-test', version: 'test', enabled: true,
  capabilities: ['streaming', 'tools', 'structured-output'], modalities: ['text'],
  coordinates: { technicality: 0.8, creativity: 0.6, quality: 0.9, reasoning: 0.8 },
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
});
