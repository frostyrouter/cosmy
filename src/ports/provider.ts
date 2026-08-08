import type { ModelConfiguration, ResponseRequest, ResponseChunk, Usage } from '../domain/types.js';

export interface ProviderRequest {
  request: ResponseRequest;
  model: ModelConfiguration;
  signal: AbortSignal;
}

export interface ProviderResponse {
  output: string;
  usage: Usage;
  finishReason: 'stop' | 'length';
}

export interface ProviderAdapter {
  readonly name: string;
  listModels(): readonly ModelConfiguration[];
  complete(input: ProviderRequest): Promise<ProviderResponse>;
  stream(input: ProviderRequest): AsyncIterable<ResponseChunk>;
}
