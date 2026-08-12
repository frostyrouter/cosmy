import type { RequestClassification, RequestFeatures, ResponseRequest, Modality } from '../domain/types.js';

const technicalTerms = /\b(api|sql|typescript|javascript|python|algorithm|architecture|compile|debug|regex|schema|database|kubernetes|terraform|proof|equation)\b/gi;
const creativeTerms = /\b(imagine|story|poem|creative|metaphor|brainstorm|tagline|fiction|character|beautiful|playful)\b/gi;
const reasoningTerms = /\b(compare|analyze|tradeoff|derive|prove|why|design|optimize|debug|step-by-step|evaluate)\b/gi;

function countMatches(text: string, expression: RegExp): number {
  let count = 0;
  for (let match: RegExpExecArray | null; (match = expression.exec(text)) !== null;) count++;
  return count;
}

function estimateTokens(text: string): number { return Math.max(1, Math.ceil(text.length / 4)); }

function countWords(text: string): number {
  let words = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 32 || code === 160) {
      inWord = false;
    } else if (!inWord) {
      words++;
      inWord = true;
    }
  }
  return words;
}

export function extractFeatures(input: ResponseRequest): RequestFeatures {
  const semanticText = input.messages.filter((message) => message.role !== 'tool').map((message) => message.content).join('\n');
  const billableText = input.messages.map((message) => `${message.content}${message.toolCalls?.map((call) => JSON.stringify(call)).join('') ?? ''}`).join('\n');
  const technical = countMatches(semanticText, technicalTerms);
  const creative = countMatches(semanticText, creativeTerms);
  const reasoning = countMatches(semanticText, reasoningTerms);
  const words = countWords(semanticText);
  const lower = semanticText.toLowerCase();
  const modalities: Modality[] = ['text'];
  if (lower.includes('[image]') || lower.includes('image input')) modalities.push('image');
  if (lower.includes('[file]') || lower.includes('attached file')) modalities.push('file');
  return {
    inputTokens: estimateTokens(billableText),
    requestedOutputTokens: input.maxOutputTokens ?? 1_000,
    messageCount: input.messages.length,
    modalities,
    hasTools: (input.tools?.length ?? 0) > 0,
    needsStructuredOutput: input.responseFormat?.type === 'json-schema',
    needsStreaming: input.stream === true,
    technicality: Math.min(1, technical / Math.max(1, words / 25)),
    creativity: Math.min(1, creative / Math.max(1, words / 25)),
    reasoning: Math.min(1, reasoning / Math.max(1, words / 25)),
    dataClass: input.policy?.dataClass ?? 'internal',
  };
}

export function mergeClassification(features: RequestFeatures, classification: RequestClassification): RequestFeatures {
  return {
    ...features,
    demandVector: classification.demandVector,
    deepReasoningRequired: classification.deepReasoningRequired,
    classificationConfidence: classification.confidence,
    classifierMetadata: classification.classifierMetadata,
  };
}
