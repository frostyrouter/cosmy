import { createHash } from 'node:crypto';
import type { DataClass, ModelConfiguration, ResponseRequest } from '../domain/types.js';
import { stableBucket } from '../rollouts/rollout.js';

export type ShadowCampaignState = 'active' | 'paused' | 'completed';

export interface ShadowCampaign {
  id: string;
  modelId: string;
  modelVersion: string;
  state: ShadowCampaignState;
  samplePercentage: number;
  budgetLimitUsd: number;
  reservedUsd: number;
  spentUsd: number;
  allowedDataClasses: readonly DataClass[];
  sampleCount: number;
  successCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShadowReservation { id: string; campaignId: string; estimatedCostUsd: number; }

export interface ShadowObservation {
  id: string;
  campaignId: string;
  primaryModelId: string;
  shadowModelId: string;
  status: 'success' | 'error';
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number };
  primaryOutputSha256?: string;
  shadowOutputSha256?: string;
  exactMatch?: boolean;
  recordedAt: string;
}

export function shadowEligible(request: ResponseRequest, campaign: ShadowCampaign): boolean {
  const dataClass = request.policy?.dataClass ?? 'internal';
  return campaign.state === 'active'
    && campaign.allowedDataClasses.includes(dataClass)
    && (dataClass === 'public' || dataClass === 'internal')
    && request.stream !== true
    && (request.tools?.length ?? 0) === 0
    && !request.messages.some((message) => message.role === 'tool')
    && stableBucket(`${campaign.id}\0${request.policy?.tenantId ?? 'anonymous'}\0${request.requestId ?? canonicalRequestDigest(request)}`) < campaign.samplePercentage;
}

export function safeShadowRequest(request: ResponseRequest): ResponseRequest {
  return {
    ...(request.requestId ? { requestId: request.requestId } : {}),
    messages: request.messages.map((message) => ({ role: message.role, content: message.content, ...(message.name ? { name: message.name } : {}) })),
    stream: false,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
    ...(request.responseFormat ? { responseFormat: structuredClone(request.responseFormat) } : {}),
    policy: { dataClass: request.policy?.dataClass ?? 'internal', ...(request.policy?.region ? { region: request.policy.region } : {}) },
  };
}

export function estimateShadowCost(model: ModelConfiguration, request: ResponseRequest): number {
  const inputTokens = request.messages.reduce((total, message) => total + Math.max(1, Math.ceil(message.content.length / 4)), 0);
  const outputTokens = request.maxOutputTokens ?? Math.min(1_024, model.maxOutputTokens);
  return (inputTokens * model.pricing.inputPerMillionUsd + outputTokens * model.pricing.outputPerMillionUsd) / 1_000_000;
}

export function outputDigest(output: string): string { return createHash('sha256').update(output).digest('hex'); }

function canonicalRequestDigest(request: ResponseRequest): string {
  return createHash('sha256').update(JSON.stringify({ messages: request.messages, temperature: request.temperature, maxOutputTokens: request.maxOutputTokens, responseFormat: request.responseFormat })).digest('hex');
}
