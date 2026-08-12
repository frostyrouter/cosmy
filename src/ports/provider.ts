import type { ModelConfiguration, ResponseRequest, ResponseChunk, ToolCall, Usage } from '../domain/types.js';

export interface ProviderRequest {
  request: ResponseRequest;
  model: ModelConfiguration;
  signal: AbortSignal;
}

export interface ProviderResponse {
  output: string;
  toolCalls?: ToolCall[];
  usage: Usage;
  finishReason: 'stop' | 'length' | 'tool_calls';
}

export interface ProviderAdapter {
  readonly name: string;
  listModels(): readonly ModelConfiguration[];
  complete(input: ProviderRequest): Promise<ProviderResponse>;
  stream(input: ProviderRequest): AsyncIterable<ResponseChunk>;
}
