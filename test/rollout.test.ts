import { describe, expect, it } from 'vitest';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { InMemoryRolloutRegistry, stableBucket, type ModelRollout } from '../src/rollouts/rollout.js';
import { DeterministicRouter } from '../src/routing/router.js';

const rollout: ModelRollout = {
  id: 'rollout-1', modelId: 'sim-small-text', modelVersion: '1', state: 'canary', trafficPercentage: 25,
  minimumSamples: 100, maximumErrorRate: 0.05, maximumAverageLatencyMs: 1_000,
  sampleCount: 0, errorCount: 0, totalLatencyMs: 0, createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z',
};

describe('controlled model rollouts', () => {
  it('assigns a tenant deterministically and honors terminal states', () => {
    const registry = new InMemoryRolloutRegistry();
    registry.load([rollout]);
    const model = defaultModels[0]!;
    expect(registry.allows(model, 'tenant-a')).toBe(registry.allows(model, 'tenant-a'));
    registry.upsert({ ...rollout, state: 'rolled_back' });
    expect(registry.allows(model, 'tenant-a')).toBe(false);
    registry.upsert({ ...rollout, state: 'active' });
    expect(registry.allows(model, 'tenant-a')).toBe(true);
  });

  it('excludes an unassigned canary before ranking and explicit selection', () => {
    const assignments = new InMemoryRolloutRegistry();
    assignments.load([{ ...rollout, trafficPercentage: 0 }]);
    const router = new DeterministicRouter(new InMemoryModelRegistry(defaultModels), undefined, assignments);
    const request = { messages: [{ role: 'user' as const, content: 'rewrite this email' }], policy: { tenantId: 'tenant-a' } };
    const decision = router.decide('request-1', request);
    expect(decision.selected.model.id).not.toBe(rollout.modelId);
    expect(decision.rejected).toContainEqual({ modelId: rollout.modelId, reason: 'rollout_not_assigned' });
    expect(() => router.decide('request-2', { ...request, model: rollout.modelId })).toThrow(/not assigned/u);
  });

  it('produces stable buckets in the percentage range', () => {
    expect(stableBucket('rollout-1\0tenant-a')).toBeGreaterThanOrEqual(0);
    expect(stableBucket('rollout-1\0tenant-a')).toBeLessThan(100);
  });
});
