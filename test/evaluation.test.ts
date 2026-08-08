import { describe, expect, it } from 'vitest';
import { defaultEvaluationCases } from '../src/evaluation/default-cases.js';
import { assertEvaluation, evaluateRouting } from '../src/evaluation/harness.js';
import { defaultModels } from '../src/registry/default-models.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';

describe('routing evaluation harness', () => {
  it('evaluates representative cases and groups results by tag', () => {
    const router = new DeterministicRouter(new InMemoryModelRegistry(defaultModels));
    const summary = evaluateRouting(router, defaultEvaluationCases);
    expect(summary.totalCases).toBe(5);
    expect(summary.passRate).toBeGreaterThanOrEqual(0.8);
    expect(summary.byTag.tools?.total).toBe(1);
    expect(summary.averageCostUsd).toBeGreaterThanOrEqual(0);
    expect(summary.averageLatencyMs).toBeGreaterThan(0);
    assertEvaluation(summary, 0.8);
  });

  it('fails a threshold when an expected model is impossible', () => {
    const router = new DeterministicRouter(new InMemoryModelRegistry(defaultModels));
    const summary = evaluateRouting(router, [{ ...defaultEvaluationCases[0]!, acceptableModelIds: ['never-selected'] }]);
    expect(() => assertEvaluation(summary, 1)).toThrow('below required');
  });
});
