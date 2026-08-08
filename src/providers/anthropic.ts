import type { ModelConfiguration, ResponseChunk, ResponseRequest, Usage } from '../domain/types.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../ports/provider.js';
import { asArray, asNumber, asRecord, asString, nativeHttpClient, readJson, readSse, type HttpClient } from './http.js';

export interface AnthropicProviderOptions { apiKey: string; baseUrl?: string; version?: string; http?: HttpClient; }

function messagesFor(request: ResponseRequest): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const system = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n') || undefined;
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = request.messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content }));
  return system === undefined ? { messages } : { system, messages };
}

function requestBody(input: ProviderRequest, stream: boolean): Record<string, unknown> {
  const content = messagesFor(input.request);
  const body: Record<string, unknown> = { model: input.model.model, max_tokens: input.request.maxOutputTokens ?? input.model.maxOutputTokens, messages: content.messages, stream };
  if (content.system !== undefined) body.system = content.system;
  if (input.request.temperature !== undefined) body.temperature = input.request.temperature;
  if (input.request.tools?.length) body.tools = input.request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
  return body;
}

function usageOf(value: Record<string, unknown>, model: ModelConfiguration): Usage {
  const usage = asRecord(value.usage);
  const inputTokens = asNumber(usage.input_tokens);
  const outputTokens = asNumber(usage.output_tokens);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostUsd: (inputTokens * model.pricing.inputPerMillionUsd + outputTokens * model.pricing.outputPerMillionUsd) / 1_000_000 };
}

function outputOf(value: Record<string, unknown>): string {
  return asArray(value.content).map((item) => asString(asRecord(item).text)).filter(Boolean).join('');
}

export class AnthropicProvider implements ProviderAdapter {
  readonly name = 'anthropic';
  private readonly baseUrl: string;
  private readonly http: HttpClient;
  constructor(private readonly options: AnthropicProviderOptions, private readonly models: readonly ModelConfiguration[]) {
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/$/u, '');
    this.http = options.http ?? nativeHttpClient;
  }
  listModels(): readonly ModelConfiguration[] { return this.models; }
  async complete(input: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.http.request(`${this.baseUrl}/messages`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': this.options.apiKey, 'anthropic-version': this.options.version ?? '2023-06-01' }, body: JSON.stringify(requestBody(input, false)), signal: input.signal });
    const value = await readJson(response);
    return { output: outputOf(value), usage: usageOf(value, input.model), finishReason: asString(value.stop_reason) === 'max_tokens' ? 'length' : 'stop' };
  }
  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    const response = await this.http.request(`${this.baseUrl}/messages`, { method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json', 'x-api-key': this.options.apiKey, 'anthropic-version': this.options.version ?? '2023-06-01' }, body: JSON.stringify(requestBody(input, true)), signal: input.signal });
    let index = 0;
    let usage: Usage | undefined;
    for await (const event of readSse(response, input.signal)) {
      let payload: Record<string, unknown>;
      try { payload = asRecord(JSON.parse(event.data)); } catch { continue; }
      if (event.event === 'message_start') usage = usageOf(payload, input.model);
      const delta = asRecord(payload.delta);
      const text = asString(delta.text);
      if (text) yield { requestId: input.request.requestId ?? 'unknown', index: index++, delta: text, done: false };
      if (event.event === 'message_delta') {
        const next = usageOf(payload, input.model);
        usage = { ...next, inputTokens: usage?.inputTokens ?? next.inputTokens, totalTokens: (usage?.inputTokens ?? next.inputTokens) + next.outputTokens };
      }
      if (event.event === 'message_stop') { yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true }; return; }
    }
    yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true };
  }
}
