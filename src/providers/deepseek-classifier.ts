import { ProviderError } from '../domain/errors.js';
import type { RequestClassification } from '../domain/types.js';
import type { RequestClassificationInput, RequestClassifier } from '../ports/classifier.js';
import { parseRequestClassification, requestDemandVectorSchema } from '../routing/vector.js';
import { asArray, asRecord, asString, jsonHeaders, nativeHttpClient, readJson, type HttpClient } from './http.js';
import { z } from 'zod';

const classifierVersion = 'deepseek-demand-v1';
const defaultMaxInputChars = 200_000;

const modelClassificationSchema = z.object({
  demandVector: requestDemandVectorSchema,
  deepReasoningRequired: z.boolean(),
  confidence: z.number().finite().min(0).max(1),
}).strict();

const unitNumberParameter = { type: 'number', minimum: 0, maximum: 1 } as const;
const demandVectorParameters = {
  type: 'object',
  additionalProperties: false,
  required: [
    'version', 'technicalDifficulty', 'reasoningDepth', 'creativity', 'designSkill', 'factualPrecision',
    'qualityRequirement', 'ambiguity', 'toolComplexity', 'contextComplexity', 'codingIntensity',
    'safetyStakes',
  ],
  properties: {
    version: { type: 'string', enum: ['v1'] },
    technicalDifficulty: unitNumberParameter,
    reasoningDepth: unitNumberParameter,
    creativity: unitNumberParameter,
    designSkill: unitNumberParameter,
    factualPrecision: unitNumberParameter,
    qualityRequirement: unitNumberParameter,
    ambiguity: unitNumberParameter,
    toolComplexity: unitNumberParameter,
    contextComplexity: unitNumberParameter,
    codingIntensity: unitNumberParameter,
    safetyStakes: unitNumberParameter,
  },
} as const;

const classificationTool = {
  type: 'function',
  function: {
    name: 'classify_request',
    description: 'Return the validated multidimensional demand vector for model routing.',
    strict: true,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['demandVector', 'deepReasoningRequired', 'confidence'],
      properties: {
        demandVector: demandVectorParameters,
        deepReasoningRequired: { type: 'boolean' },
        confidence: unitNumberParameter,
      },
    },
  },
} as const;

export interface DeepSeekClassifierOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxInputChars?: number;
  http?: HttpClient;
}

function classifierRequest(input: RequestClassificationInput, maxInputChars: number): string {
  const { request, deterministicFeatures } = input;
  const value = JSON.stringify({
    // Tool results are untrusted external data and must not steer route classification.
    messages: request.messages.filter(({ role }) => role !== 'tool').map(({ role, content }) => ({ role, content })),
    tools: request.tools?.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) ?? [],
    responseFormat: request.responseFormat?.type ?? 'text',
    stream: request.stream === true,
    requestedOutputTokens: request.maxOutputTokens ?? 1_000,
    deterministicFacts: {
      inputTokens: deterministicFeatures.inputTokens,
      messageCount: deterministicFeatures.messageCount,
      modalities: deterministicFeatures.modalities,
      hasTools: deterministicFeatures.hasTools,
      needsStructuredOutput: deterministicFeatures.needsStructuredOutput,
      needsStreaming: deterministicFeatures.needsStreaming,
    },
  });
  if (value.length > maxInputChars) throw new ProviderError(`Classifier input exceeds ${maxInputChars} characters`, false);
  return value;
}

function systemPrompt(): string {
  return `You are the semantic classifier for an AI model router. Analyze the supplied request and call classify_request exactly once.
Every numeric field must be a finite number from 0 to 1. Scores represent the minimum capability demanded by the request, not the quality of your own answer.
designSkill measures the need for visual hierarchy, layout, typography, interaction patterns, and coherent design-language execution; score it independently from open-ended creativity.
Set deepReasoningRequired only when deliberate multi-step reasoning materially improves correctness. qualityRequirement is the minimum acceptable answer quality. Do not answer the request.`;
}

export class DeepSeekV4FlashClassifier implements RequestClassifier {
  readonly name = 'deepseek-v4-flash';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxInputChars: number;
  private readonly http: HttpClient;

  constructor(private readonly options: DeepSeekClassifierOptions) {
    this.baseUrl = (options.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/u, '');
    this.model = options.model ?? 'deepseek-v4-flash';
    this.maxInputChars = options.maxInputChars ?? defaultMaxInputChars;
    if (!Number.isFinite(this.maxInputChars) || this.maxInputChars <= 0) throw new ProviderError('Classifier maxInputChars must be a positive finite number', false);
    this.http = options.http ?? nativeHttpClient;
  }

  async classify(input: RequestClassificationInput): Promise<RequestClassification> {
    const response = await this.http.request(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: jsonHeaders(this.options.apiKey),
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: classifierRequest(input, this.maxInputChars) },
        ],
        tools: [classificationTool],
        tool_choice: { type: 'function', function: { name: 'classify_request' } },
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: 600,
        stream: false,
      }),
      signal: input.signal,
    });
    const value = await readJson(response);
    const choice = asRecord(asArray(value.choices)[0]);
    const toolCall = asRecord(asArray(asRecord(choice.message).tool_calls)[0]);
    const calledFunction = asRecord(toolCall.function);
    if (asString(calledFunction.name) !== 'classify_request') throw new ProviderError('DeepSeek classifier did not call classify_request', false);
    const argumentsJson = asString(calledFunction.arguments);
    if (!argumentsJson) throw new ProviderError('DeepSeek classifier returned empty tool arguments', false);
    let parsed: unknown;
    try { parsed = JSON.parse(argumentsJson); } catch { throw new ProviderError('DeepSeek classifier returned invalid JSON tool arguments', false); }
    const classification = modelClassificationSchema.safeParse(parsed);
    if (!classification.success) throw new ProviderError(`DeepSeek classifier output failed validation: ${classification.error.message}`, false);
    return parseRequestClassification({
      ...classification.data,
      classifierMetadata: { provider: 'deepseek', model: this.model, classifierVersion },
    });
  }
}
