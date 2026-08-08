import type { ModelConfiguration, ResponseChunk, ResponseRequest, Usage } from '../domain/types.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../ports/provider.js';
import { asArray, asNumber, asRecord, asString, jsonHeaders, nativeHttpClient, readJson, readSse, type HttpClient } from './http.js';

export interface OpenAIProviderOptions { apiKey: string; baseUrl?: string; http?: HttpClient; }

function inputFor(request: ResponseRequest): unknown[] {
  return request.messages.map((message) => ({ role: message.role, content: message.content, ...(message.name ? { name: message.name } : {}) }));
}

function requestBody(input: ProviderRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model: input.model.model, input: inputFor(input.request), stream };
  if (input.request.temperature !== undefined) body.temperature = input.request.temperature;
  if (input.request.maxOutputTokens !== undefined) body.max_output_tokens = input.request.maxOutputTokens;
  if (input.request.responseFormat?.type === 'json-schema') body.text = { format: { type: 'json_schema', name: 'response', schema: input.request.responseFormat.schema ?? { type: 'object' } } };
  if (input.request.tools?.length) body.tools = input.request.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema }));
  return body;
}

function usageOf(value: Record<string, unknown>, model: ModelConfiguration): Usage {
  const usage = asRecord(value.usage);
  const inputTokens = asNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = asNumber(usage.output_tokens ?? usage.completion_tokens);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostUsd: (inputTokens * model.pricing.inputPerMillionUsd + outputTokens * model.pricing.outputPerMillionUsd) / 1_000_000 };
}

function outputOf(value: Record<string, unknown>): string {
  if (typeof value.output_text === 'string') return value.output_text;
  return asArray(value.output).flatMap((item) => asArray(asRecord(item).content)).map((item) => asString(asRecord(item).text)).filter(Boolean).join('');
}

export class OpenAIProvider implements ProviderAdapter {
  readonly name = 'openai';
  private readonly baseUrl: string;
  private readonly http: HttpClient;
  constructor(private readonly options: OpenAIProviderOptions, private readonly models: readonly ModelConfiguration[]) {
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/u, '');
    this.http = options.http ?? nativeHttpClient;
  }
  listModels(): readonly ModelConfiguration[] { return this.models; }
  async complete(input: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.http.request(`${this.baseUrl}/responses`, { method: 'POST', headers: jsonHeaders(this.options.apiKey), body: JSON.stringify(requestBody(input, false)), signal: input.signal });
    const value = await readJson(response);
    return { output: outputOf(value), usage: usageOf(value, input.model), finishReason: asString(value.status) === 'incomplete' ? 'length' : 'stop' };
  }
  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    const response = await this.http.request(`${this.baseUrl}/responses`, { method: 'POST', headers: jsonHeaders(this.options.apiKey), body: JSON.stringify(requestBody(input, true)), signal: input.signal });
    let index = 0;
    let usage: Usage | undefined;
    for await (const event of readSse(response, input.signal)) {
      if (event.data === '[DONE]') {
        yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true };
        return;
      }
      let payload: Record<string, unknown>;
      try { payload = asRecord(JSON.parse(event.data)); } catch { continue; }
      const delta = asString(payload.delta ?? payload.text);
      if (payload.usage) usage = usageOf(payload, input.model);
      if (delta) yield { requestId: input.request.requestId ?? 'unknown', index: index++, delta, done: false };
      if (event.event === 'response.completed' || event.event === 'response.done') { yield { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, usage: usage ?? usageOf(payload, input.model) }; return; }
    }
    if (usage) yield { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, usage };
    else yield { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true };
  }
}
