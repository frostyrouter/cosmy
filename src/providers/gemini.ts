import type { ModelConfiguration, ResponseChunk, ResponseRequest, ToolCall, Usage } from '../domain/types.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../ports/provider.js';
import { asArray, asNumber, asRecord, asString, nativeHttpClient, readJson, readSse, type HttpClient } from './http.js';
import { parseToolArguments, syntheticToolCallId, toolCallId, toolName } from './tool-normalization.js';

export interface GeminiProviderOptions { apiKey: string; baseUrl?: string; http?: HttpClient; }

function requestBody(input: ProviderRequest): Record<string, unknown> {
  const system = input.request.messages.filter((message) => message.role === 'system').map((message) => ({ text: message.content }));
  const contents: Array<{ role: string; parts: Record<string, unknown>[] }> = [];
  for (const message of input.request.messages.filter((candidate) => candidate.role !== 'system')) {
    if (message.role === 'tool') {
      const part = { functionResponse: { id: message.toolCallId, name: message.name, response: toolResult(message.content, message.toolError) } };
      const previous = contents.at(-1);
      if (previous?.role === 'user' && previous.parts.every((candidate) => 'functionResponse' in candidate)) previous.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
      continue;
    }
    const parts: Record<string, unknown>[] = [...(message.content ? [{ text: message.content }] : [])];
    for (const call of message.toolCalls ?? []) parts.push({ functionCall: { id: call.id, name: call.name, args: call.arguments } });
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  const body: Record<string, unknown> = { contents, generationConfig: { ...(input.request.maxOutputTokens ? { maxOutputTokens: input.request.maxOutputTokens } : {}), ...(input.request.temperature !== undefined ? { temperature: input.request.temperature } : {}), ...(input.request.responseFormat?.type === 'json-schema' ? { responseMimeType: 'application/json', responseSchema: input.request.responseFormat.schema } : {}) } };
  if (system.length) body.systemInstruction = { parts: system };
  if (input.request.tools?.length) body.tools = [{ functionDeclarations: input.request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }];
  return body;
}

function usageOf(value: Record<string, unknown>, model: ModelConfiguration): Usage {
  const usage = asRecord(value.usageMetadata);
  const inputTokens = asNumber(usage.promptTokenCount);
  const outputTokens = asNumber(usage.candidatesTokenCount);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostUsd: (inputTokens * model.pricing.inputPerMillionUsd + outputTokens * model.pricing.outputPerMillionUsd) / 1_000_000 };
}

function outputOf(value: Record<string, unknown>): string {
  const candidate = asRecord(asArray(value.candidates)[0]);
  return asArray(asRecord(candidate.content).parts).map((part) => asString(asRecord(part).text)).filter(Boolean).join('');
}

function toolResult(content: string, failed?: boolean): Record<string, unknown> {
  let result: unknown = content;
  try { result = JSON.parse(content); } catch { /* Preserve text results. */ }
  return failed ? { error: result } : { result };
}

function toolCallsOf(value: Record<string, unknown>, requestId?: string): ToolCall[] {
  const candidate = asRecord(asArray(value.candidates)[0]);
  return asArray(asRecord(candidate.content).parts).flatMap((raw, index) => {
    const call = asRecord(asRecord(raw).functionCall);
    if (!asString(call.name)) return [];
    const name = toolName(call.name);
    return [{ id: toolCallId(call.id, syntheticToolCallId(requestId, index)), name, arguments: parseToolArguments(call.args) }];
  });
}

export class GeminiProvider implements ProviderAdapter {
  readonly name = 'gemini';
  private readonly baseUrl: string;
  private readonly http: HttpClient;
  constructor(private readonly options: GeminiProviderOptions, private readonly models: readonly ModelConfiguration[]) {
    this.baseUrl = (options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/u, '');
    this.http = options.http ?? nativeHttpClient;
  }
  listModels(): readonly ModelConfiguration[] { return this.models; }
  async complete(input: ProviderRequest): Promise<ProviderResponse> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(input.model.model)}:generateContent?key=${encodeURIComponent(this.options.apiKey)}`;
    const response = await this.http.request(url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(requestBody(input)), signal: input.signal });
    const value = await readJson(response);
    const toolCalls = toolCallsOf(value, input.request.requestId);
    return { output: outputOf(value), ...(toolCalls.length ? { toolCalls } : {}), usage: usageOf(value, input.model), finishReason: asString(asRecord(asArray(value.candidates)[0]).finishReason) === 'MAX_TOKENS' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop' };
  }
  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(input.model.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.options.apiKey)}`;
    const response = await this.http.request(url, { method: 'POST', headers: { accept: 'text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify(requestBody(input)), signal: input.signal });
    let index = 0;
    let toolIndex = 0;
    let usage: Usage | undefined;
    for await (const event of readSse(response, input.signal)) {
      let payload: Record<string, unknown>;
      try { payload = asRecord(JSON.parse(event.data)); } catch { continue; }
      const candidate = asRecord(asArray(payload.candidates)[0]);
      const parts = asArray(asRecord(candidate.content).parts);
      for (const part of parts) {
        const record = asRecord(part);
        const text = asString(record.text);
        if (text) yield { requestId: input.request.requestId ?? 'unknown', index: index++, delta: text, done: false, type: 'text-delta' };
        const functionCall = asRecord(record.functionCall);
        if (asString(functionCall.name)) {
          const name = toolName(functionCall.name);
          const outputIndex = toolIndex++;
          const id = toolCallId(functionCall.id, syntheticToolCallId(input.request.requestId, outputIndex));
          const argumentsValue = parseToolArguments(functionCall.args);
          const argumentsJson = JSON.stringify(argumentsValue);
          yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex, delta: '', done: false, type: 'tool-call-added', toolCallId: id, toolName: name };
          yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex, delta: argumentsJson, done: false, type: 'tool-call-arguments-delta', toolCallId: id, toolName: name };
          yield { requestId: input.request.requestId ?? 'unknown', index: index++, outputIndex, delta: '', done: false, type: 'tool-call-done', toolCallId: id, toolName: name, toolArguments: argumentsValue };
        }
      }
      if (payload.usageMetadata) usage = usageOf(payload, input.model);
      if (candidate.finishReason) { yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed', usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed' }; return; }
    }
    yield usage ? { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed', usage } : { requestId: input.request.requestId ?? 'unknown', index, delta: '', done: true, type: 'completed' };
  }
}
