import type { ModelConfiguration, ResponseChunk, ResponseRequest, ToolCall, Usage } from '../domain/types.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../ports/provider.js';
import { asArray, asNumber, asRecord, asString, nativeHttpClient, readJson, readSse, type HttpClient } from './http.js';
import { parseToolArguments, syntheticToolCallId, toolCallId, toolName } from './tool-normalization.js';

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

function toolCallsOf(value: Record<string, unknown>, requestId?: string): ToolCall[] {
  return asArray(value.content).flatMap((raw, index) => {
    const item = asRecord(raw);
    if (asString(item.type) !== 'tool_use') return [];
    return [{ id: toolCallId(item.id, syntheticToolCallId(requestId, index)), name: toolName(item.name), arguments: parseToolArguments(item.input) }];
  });
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
    const toolCalls = toolCallsOf(value, input.request.requestId);
    return { output: outputOf(value), ...(toolCalls.length ? { toolCalls } : {}), usage: usageOf(value, input.model), finishReason: asString(value.stop_reason) === 'max_tokens' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop' };
  }
  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    const response = await this.http.request(`${this.baseUrl}/messages`, { method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json', 'x-api-key': this.options.apiKey, 'anthropic-version': this.options.version ?? '2023-06-01' }, body: JSON.stringify(requestBody(input, true)), signal: input.signal });
    let index = 0;
    let usage: Usage | undefined;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    for await (const event of readSse(response, input.signal)) {
      let payload: Record<string, unknown>;
      try { payload = asRecord(JSON.parse(event.data)); } catch { continue; }
      if (event.event === 'message_start') usage = usageOf(asRecord(payload.message), input.model);
      const blockIndex = asNumber(payload.index);
      if (event.event === 'content_block_start') {
        const block = asRecord(payload.content_block);
        if (asString(block.type) === 'tool_use') {
          const call = { id: toolCallId(block.id, syntheticToolCallId(input.request.requestId, blockIndex)), name: toolName(block.name), arguments: '' };
          toolCalls.set(blockIndex, call);
          yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex: blockIndex, delta: '', done: false, type: 'tool-call-added', toolCallId: call.id, toolName: call.name };
          continue;
        }
      }
      const delta = asRecord(payload.delta);
      const text = asString(delta.text);
      if (text) yield { requestId: input.request.requestId ?? 'unknown', index: index++, delta: text, done: false, type: 'text-delta' };
      if (asString(delta.type) === 'input_json_delta') {
        const call = toolCalls.get(blockIndex);
        if (call) {
          const argumentsDelta = asString(delta.partial_json);
          call.arguments += argumentsDelta;
          yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex: blockIndex, delta: argumentsDelta, done: false, type: 'tool-call-arguments-delta', toolCallId: call.id, toolName: call.name };
        }
      }
      if (event.event === 'content_block_stop') {
        const call = toolCalls.get(blockIndex);
        if (call) {
          yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex: blockIndex, delta: '', done: false, type: 'tool-call-done', toolCallId: call.id, toolName: call.name, toolArguments: parseToolArguments(call.arguments || '{}') };
          toolCalls.delete(blockIndex);
        }
      }
      if (event.event === 'message_delta') {
        const next = usageOf(payload, input.model);
        usage = { ...next, inputTokens: usage?.inputTokens ?? next.inputTokens, totalTokens: (usage?.inputTokens ?? next.inputTokens) + next.outputTokens };
      }
      if (event.event === 'message_stop') { yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed', usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed' }; return; }
    }
    yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed', usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed' };
  }
}
