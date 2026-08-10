import type { ModelConfiguration } from '../domain/types.js';

export interface ModelPromotionEvidence {
  id: string;
  modelId: string;
  modelVersion: string;
  suiteVersion: string;
  datasetVersion: string;
  conformancePassed: boolean;
  pricingVerified: boolean;
  usageVerified: boolean;
  routingPassRate: number;
  qualityScore: number;
  sampleCount: number;
  evaluatedAt: string;
  expiresAt: string;
  submittedByCredentialId: string;
  submittedAt: string;
}

export interface PromotionPolicy {
  minimumRoutingPassRate: number;
  minimumQualityScore: number;
  minimumSampleCount: number;
  maximumFutureClockSkewMs: number;
}

export const defaultPromotionPolicy: PromotionPolicy = {
  minimumRoutingPassRate: 0.95,
  minimumQualityScore: 0.7,
  minimumSampleCount: 100,
  maximumFutureClockSkewMs: 5 * 60_000,
};

export function assessPromotion(model: ModelConfiguration, evidence: ModelPromotionEvidence | undefined, now = new Date(), policy = defaultPromotionPolicy): string[] {
  if (!model.enabled) return [];
  if (!evidence) return ['evidence_missing'];
  const reasons: string[] = [];
  if (evidence.modelId !== model.id || evidence.modelVersion !== model.version) reasons.push('evidence_model_mismatch');
  if (!evidence.conformancePassed) reasons.push('conformance_failed');
  if (!evidence.pricingVerified) reasons.push('pricing_unverified');
  if (!evidence.usageVerified) reasons.push('usage_unverified');
  if (evidence.routingPassRate < policy.minimumRoutingPassRate) reasons.push('routing_pass_rate_below_gate');
  if (evidence.qualityScore < Math.max(policy.minimumQualityScore, model.coordinates.quality)) reasons.push('quality_below_gate');
  if (evidence.sampleCount < policy.minimumSampleCount) reasons.push('sample_count_below_gate');
  const evaluatedAt = Date.parse(evidence.evaluatedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  if (!Number.isFinite(evaluatedAt) || evaluatedAt > now.getTime() + policy.maximumFutureClockSkewMs) reasons.push('evaluation_time_invalid');
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) reasons.push('evidence_expired');
  if (Number.isFinite(evaluatedAt) && Number.isFinite(expiresAt) && expiresAt <= evaluatedAt) reasons.push('evidence_window_invalid');
  return reasons;
}

export function needsPromotionEvidence(current: ModelConfiguration | undefined, candidate: ModelConfiguration): boolean {
  return candidate.enabled && (!current || current.version !== candidate.version || !current.enabled);
}
