import { describe, expect, it } from 'vitest';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { InMemoryRolloutRegistry, stableBucket, type ModelRollout } from '../src/rollouts/rollout.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { InMemoryControlPlaneStore } from '../src/control-plane/memory-store.js';
import { InMemoryUsageLedger } from '../src/stores/memory-usage-ledger.js';

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

  it('automatically rolls back atomically after the minimum sample gate', async () => {
    const store = new InMemoryControlPlaneStore(new InMemoryModelRegistry(defaultModels), new InMemoryUsageLedger());
    const created = await store.createRollout({ modelId: rollout.modelId, modelVersion: rollout.modelVersion, trafficPercentage: 10, minimumSamples: 20, maximumErrorRate: 0.1, maximumAverageLatencyMs: 1_000, actorCredentialId: 'admin', actorTenantId: 'platform' });
    for (let sample = 0; sample < 19; sample += 1) await store.recordRolloutOutcome({ modelId: rollout.modelId, modelVersion: rollout.modelVersion, status: 'error', latencyMs: 10 });
    expect((await store.rollout(created.id))?.state).toBe('canary');
    const rolledBack = await store.recordRolloutOutcome({ modelId: rollout.modelId, modelVersion: rollout.modelVersion, status: 'error', latencyMs: 10 });
    expect(rolledBack).toMatchObject({ state: 'rolled_back', reason: 'error_rate_exceeded', sampleCount: 20, errorCount: 20 });
    expect((await store.listAudit(10)).map((event) => event.action)).toContain('rollout.auto_rollback');
  });

  it('does not allow manual promotion before acceptance thresholds pass', async () => {
    const store = new InMemoryControlPlaneStore(new InMemoryModelRegistry(defaultModels), new InMemoryUsageLedger());
    const created = await store.createRollout({ modelId: rollout.modelId, modelVersion: rollout.modelVersion, trafficPercentage: 10, minimumSamples: 20, maximumErrorRate: 0.1, maximumAverageLatencyMs: 1_000, actorCredentialId: 'admin', actorTenantId: 'platform' });
    await expect(store.changeRollout({ id: created.id, action: 'promote', actorCredentialId: 'admin', actorTenantId: 'platform' })).rejects.toMatchObject({ code: 'rollout_not_ready' });
    for (let sample = 0; sample < 20; sample += 1) await store.recordRolloutOutcome({ modelId: rollout.modelId, modelVersion: rollout.modelVersion, status: 'success', latencyMs: 100 });
    await expect(store.changeRollout({ id: created.id, action: 'promote', actorCredentialId: 'admin', actorTenantId: 'platform' })).resolves.toMatchObject({ state: 'active' });
  });
});
