import { describe, expect, it } from 'vitest';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { InMemoryHealthStore } from '../src/stores/memory-health-store.js';

describe('control-plane snapshots', () => {
  it('publishes cloned, versioned model snapshots', () => {
    const registry = new InMemoryModelRegistry(defaultModels);
    const first = registry.currentSnapshot();
    const second = registry.publish(defaultModels.slice(0, 1), 'test-publish');
    expect(second.version).toBe(first.version + 1);
    expect(second.source).toBe('test-publish');
    expect(second.models).toHaveLength(1);
    expect(second.models).not.toBe(first.models);
  });

  it('exposes deterministic health snapshots for aggregation', () => {
    const health = new InMemoryHealthStore();
    health.markSuccess('model-a', 120);
    health.markFailure('model-a');
    health.markSuccess('model-b', 80);
    expect(health.snapshot()).toEqual([
      expect.objectContaining({ modelId: 'model-a', successes: 1, failures: 1, lastLatencyMs: 120 }),
      expect.objectContaining({ modelId: 'model-b', successes: 1, failures: 0, lastLatencyMs: 80 }),
    ]);
  });
});
