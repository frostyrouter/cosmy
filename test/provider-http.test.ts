import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../src/providers/openai.js';
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
});
