import type { RequestFeatures, ResponseRequest, Modality } from '../domain/types.js';

const technicalTerms = /\b(api|sql|typescript|javascript|python|algorithm|architecture|compile|debug|regex|schema|database|kubernetes|terraform|proof|equation)\b/giu;
const creativeTerms = /\b(imagine|story|poem|creative|metaphor|brainstorm|tagline|fiction|character|beautiful|playful)\b/giu;
const reasoningTerms = /\b(compare|analyze|tradeoff|derive|prove|why|design|optimize|debug|step-by-step|evaluate)\b/giu;

function countMatches(text: string, expression: RegExp): number {
  return text.match(expression)?.length ?? 0;
}

function estimateTokens(text: string): number { return Math.max(1, Math.ceil(text.length / 4)); }

function inferModality(message: string): Modality[] {
  const lower = message.toLowerCase();
  const modalities: Modality[] = ['text'];
  if (lower.includes('[image]') || lower.includes('image input')) modalities.push('image');
  if (lower.includes('[file]') || lower.includes('attached file')) modalities.push('file');
  return modalities;
}

export function extractFeatures(input: ResponseRequest): RequestFeatures {
  const text = input.messages.map((message) => message.content).join('\n');
  const technical = countMatches(text, technicalTerms);
  const creative = countMatches(text, creativeTerms);
  const reasoning = countMatches(text, reasoningTerms);
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return {
    inputTokens: estimateTokens(text),
    requestedOutputTokens: input.maxOutputTokens ?? 1_000,
    messageCount: input.messages.length,
    modalities: [...new Set(input.messages.flatMap((message) => inferModality(message.content)))],
    hasTools: (input.tools?.length ?? 0) > 0,
    needsStructuredOutput: input.responseFormat?.type === 'json-schema',
    needsStreaming: input.stream === true,
    technicality: Math.min(1, technical / Math.max(1, words / 25)),
    creativity: Math.min(1, creative / Math.max(1, words / 25)),
    reasoning: Math.min(1, reasoning / Math.max(1, words / 25)),
    dataClass: input.policy?.dataClass ?? 'internal',
  };
}
