import { describe, expect, it } from 'vitest';
import { assessPromotion, needsPromotionEvidence, type ModelPromotionEvidence } from '../src/control-plane/promotion.js';
import { defaultModels } from '../src/registry/default-models.js';

const model = { ...structuredClone(defaultModels[0]!), id: 'candidate', version: '2' };
const evidence: ModelPromotionEvidence = {
  id: 'evidence-1', modelId: 'candidate', modelVersion: '2', suiteVersion: 'suite-1', datasetVersion: 'dataset-1',
  conformancePassed: true, pricingVerified: true, usageVerified: true, routingPassRate: 0.98, qualityScore: 0.9, sampleCount: 200,
  evaluatedAt: '2026-08-10T00:00:00.000Z', expiresAt: '2026-09-10T00:00:00.000Z', submittedByCredentialId: 'admin', submittedAt: '2026-08-10T00:01:00.000Z',
};

describe('model promotion gates', () => {
  it('accepts fresh matching evidence and requires it only for newly enabled versions', () => {
    expect(assessPromotion(model, evidence, new Date('2026-08-11T00:00:00.000Z'))).toEqual([]);
    expect(needsPromotionEvidence(undefined, model)).toBe(true);
    expect(needsPromotionEvidence(model, model)).toBe(false);
    expect(needsPromotionEvidence({ ...model, enabled: false }, model)).toBe(true);
  });

  it('reports every independently failed gate deterministically', () => {
    const reasons = assessPromotion(model, { ...evidence, conformancePassed: false, pricingVerified: false, usageVerified: false, routingPassRate: 0.5, qualityScore: 0.2, sampleCount: 2, expiresAt: '2026-08-10T00:00:00.000Z' }, new Date('2026-08-11T00:00:00.000Z'));
    expect(reasons).toEqual(['conformance_failed', 'pricing_unverified', 'usage_unverified', 'routing_pass_rate_below_gate', 'quality_below_gate', 'sample_count_below_gate', 'evidence_expired', 'evidence_window_invalid']);
  });
});
