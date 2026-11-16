import type { DecisionRecord } from '../../src/domain/types.js';
import { defaultModels } from '../../src/registry/default-models.js';

export function newDecisionRecord(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const now = '2026-08-12T00:00:00.000Z';
  const id = overrides.id ?? 'decision-1';
  return {
    id, tenantId: 'tenant-a', state: 'planned', attempts: [], createdAt: now, updatedAt: now,
    route: {
      requestId: id,
      selected: { model: defaultModels[0]!, score: 1, capabilityCoverage: 1, predictedTaskQuality: 1, estimatedCostUsd: 0, estimatedLatencyMs: 1, reasons: [] },
      alternatives: [], rejected: [],
      features: { inputTokens: 1, requestedOutputTokens: 1, messageCount: 1, modalities: ['text'], hasTools: false, needsStructuredOutput: false, needsStreaming: false, technicality: 0, creativity: 0, reasoning: 0, dataClass: 'internal' },
      policyVersion: 'v1', createdAt: now,
    },
    ...overrides,
  };
}
