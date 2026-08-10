import type { RequestClassification, RequestFeatures, ResponseRequest } from '../domain/types.js';

export interface RequestClassificationInput {
  request: ResponseRequest;
  deterministicFeatures: RequestFeatures;
  signal: AbortSignal;
}

export interface RequestClassifier {
  readonly name: string;
  classify(input: RequestClassificationInput): Promise<RequestClassification>;
}
