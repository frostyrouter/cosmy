import { describe, expect, it } from 'vitest';
import { NoRouteError } from '../src/domain/errors.js';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { InMemoryHealthStore } from '../src/stores/memory-health-store.js';

describe('live health routing', () => {
  it('temporarily removes a model after the observed failure threshold', () => {
    const primary = { ...defaultModels[0]!, id: 'primary', provider: 'primary' };
    const fallback = { ...defaultModels[1]!, id: 'fallback', provider: 'fallback' };
    const health = new InMemoryHealthStore();
    const router = new DeterministicRouter(new InMemoryModelRegistry([primary, fallback]), { health });
    expect(router.decide('before', { messages: [{ role: 'user', content: 'hello' }] }).selected.model.id).toBe('primary');

    health.markFailure('primary');
    health.markFailure('primary');
    health.markFailure('primary');
    const decision = router.decide('after', { messages: [{ role: 'user', content: 'hello' }] });

    expect(decision.selected.model.id).toBe('fallback');
    expect(decision.rejected).toContainEqual({ modelId: 'primary', reason: 'observed_health_unavailable' });
  });

  it('restores a model after a successful probe resets consecutive failures', () => {
    const primary = { ...defaultModels[0]!, id: 'primary', provider: 'primary' };
    const fallback = { ...defaultModels[1]!, id: 'fallback', provider: 'fallback' };
    const health = new InMemoryHealthStore();
    const router = new DeterministicRouter(new InMemoryModelRegistry([primary, fallback]), { health });
    for (let count = 0; count < 3; count += 1) health.markFailure('primary');
    expect(router.decide('unhealthy', { messages: [{ role: 'user', content: 'hello' }] }).selected.model.id).toBe('fallback');

    health.markSuccess('primary', 25);
    expect(router.decide('recovered', { messages: [{ role: 'user', content: 'hello' }] }).selected.model.id).toBe('primary');
  });

  it('fails an explicit unhealthy model instead of silently changing it', () => {
    const primary = { ...defaultModels[0]!, id: 'primary' };
    const health = new InMemoryHealthStore();
    const router = new DeterministicRouter(new InMemoryModelRegistry([primary]), { health });
    for (let count = 0; count < 3; count += 1) health.markFailure('primary');

    expect(() => router.decide('explicit', { model: 'primary', messages: [{ role: 'user', content: 'hello' }] }))
      .toThrowError(NoRouteError);
  });
});
