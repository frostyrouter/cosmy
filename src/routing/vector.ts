import { z } from 'zod';
import type { ClassifierMetadata, ModelCapabilityVector, RequestClassification, RequestDemandVector } from '../domain/types.js';
import { modelCapabilityVectorVersion, requestDemandVectorVersion } from '../domain/types.js';

const unitInterval = z.number().finite().min(0).max(1);

export const requestDemandVectorSchema = z.object({
  version: z.literal(requestDemandVectorVersion),
  technicalDifficulty: unitInterval,
  reasoningDepth: unitInterval,
  creativity: unitInterval,
  designSkill: unitInterval,
  factualPrecision: unitInterval,
  qualityRequirement: unitInterval,
  ambiguity: unitInterval,
  toolComplexity: unitInterval,
  contextComplexity: unitInterval,
  codingIntensity: unitInterval,
  safetyStakes: unitInterval,
}).strict();

export const modelCapabilityVectorSchema = z.object({
  version: z.literal(modelCapabilityVectorVersion),
  technicalDifficulty: unitInterval,
  reasoningDepth: unitInterval,
  creativity: unitInterval,
  designSkill: unitInterval,
  factualPrecision: unitInterval,
  ambiguity: unitInterval,
  toolComplexity: unitInterval,
  contextComplexity: unitInterval,
  codingIntensity: unitInterval,
  safetyStakes: unitInterval,
}).strict();

export const classifierMetadataSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  classifierVersion: z.string().min(1),
}).strict();

export const requestClassificationSchema = z.object({
  demandVector: requestDemandVectorSchema,
  deepReasoningRequired: z.boolean(),
  confidence: unitInterval,
  classifierMetadata: classifierMetadataSchema,
}).strict();

export function parseRequestDemandVector(value: unknown): RequestDemandVector {
  return requestDemandVectorSchema.parse(value);
}

export function parseModelCapabilityVector(value: unknown): ModelCapabilityVector {
  return modelCapabilityVectorSchema.parse(value);
}

export function parseClassifierMetadata(value: unknown): ClassifierMetadata {
  return classifierMetadataSchema.parse(value);
}

export function parseRequestClassification(value: unknown): RequestClassification {
  return requestClassificationSchema.parse(value);
}
