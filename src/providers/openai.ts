import type { ModelConfiguration, ResponseChunk, ResponseRequest, ToolCall, Usage } from '../domain/types.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../ports/provider.js';
import { asArray, asNumber, asRecord, asString, jsonHeaders, nativeHttpClient, readJson, readSse, type HttpClient } from './http.js';
import { parseToolArguments, syntheticToolCallId, toolCallId, toolName } from './tool-normalization.js';

export interface OpenAIProviderOptions { apiKey: string; baseUrl?: string; http?: HttpClient; }

function inputFor(request: ResponseRequest): unknown[] {
  const result: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool') { result.push({ type: 'function_call_output', call_id: message.toolCallId!, output: message.content }); continue; }
    const content = message.content.length ? [{ role: message.role, content: message.content, ...(message.name ? { name: message.name } : {}) }] : [];
    const calls = message.toolCalls?.map((call) => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) })) ?? [];
    result.push(...content, ...calls);
  }
  return result;
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

function toolCallsOf(value: Record<string, unknown>, requestId?: string): ToolCall[] {
  return asArray(value.output).flatMap((raw, index) => {
    const item = asRecord(raw);
    if (asString(item.type) !== 'function_call') return [];
    return [{ id: toolCallId(item.call_id ?? item.id, syntheticToolCallId(requestId, index)), name: toolName(item.name), arguments: parseToolArguments(item.arguments) }];
  });
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
    const toolCalls = toolCallsOf(value, input.request.requestId);
    return { output: outputOf(value), ...(toolCalls.length ? { toolCalls } : {}), usage: usageOf(value, input.model), finishReason: asString(value.status) === 'incomplete' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop' };
  }
  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    const response = await this.http.request(`${this.baseUrl}/responses`, { method: 'POST', headers: jsonHeaders(this.options.apiKey), body: JSON.stringify(requestBody(input, true)), signal: input.signal });
    let index = 0;
    let usage: Usage | undefined;
    const toolCalls = new Map<number, { id: string; name: string }>();
    for await (const event of readSse(response, input.signal)) {
      if (event.data === '[DONE]') {
        yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed', usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed' };
        return;
      }
      let payload: Record<string, unknown>;
      try { payload = asRecord(JSON.parse(event.data)); } catch { continue; }
      const eventType = event.event || asString(payload.type);
      const outputIndex = asNumber(payload.output_index);
      if (eventType === 'response.output_item.added') {
        const item = asRecord(payload.item);
        if (asString(item.type) === 'function_call') {
          const call = { id: toolCallId(item.call_id ?? item.id, syntheticToolCallId(input.request.requestId, outputIndex)), name: toolName(item.name) };
          toolCalls.set(outputIndex, call);
          yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex, delta: '', done: false, type: 'tool-call-added', toolCallId: call.id, toolName: call.name };
        }
        continue;
      }
      if (eventType === 'response.function_call_arguments.delta') {
        const call = toolCalls.get(outputIndex);
        if (call) yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex, delta: asString(payload.delta), done: false, type: 'tool-call-arguments-delta', toolCallId: call.id, toolName: call.name };
        continue;
      }
      if (eventType === 'response.function_call_arguments.done') {
        const call = toolCalls.get(outputIndex);
        if (call) yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex, delta: '', done: false, type: 'tool-call-done', toolCallId: call.id, toolName: call.name, toolArguments: parseToolArguments(payload.arguments) };
        continue;
      }
      const delta = asString(payload.delta ?? payload.text);
      const completed = asRecord(payload.response);
      if (payload.usage) usage = usageOf(payload, input.model);
      else if (completed.usage) usage = usageOf(completed, input.model);
      if (delta) yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex, delta, done: false, type: 'text-delta' };
      if (eventType === 'response.completed' || eventType === 'response.done') { yield { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed', usage: usage ?? usageOf(payload, input.model) }; return; }
    }
    if (usage) yield { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed', usage };
    else yield { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed' };
  }
}
