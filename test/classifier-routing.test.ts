import { describe, expect, it } from 'vitest';
import { NoRouteError, RequestCancelledError } from '../src/domain/errors.js';
import type { RequestClassification, RequestDemandVector, ResponseChunk, ResponseRequest } from '../src/domain/types.js';
import { requestDemandVectorVersion } from '../src/domain/types.js';
import type { RequestClassifier } from '../src/ports/classifier.js';
import { InMemoryModelRegistry } from '../src/registry/memory-registry.js';
import { DeterministicRouter } from '../src/routing/router.js';
import { RouterService } from '../src/service/router-service.js';
import type { RequestExecutor } from '../src/execution/executor.js';
import { defaultModels } from '../src/registry/default-models.js';

function vector(overrides: Partial<RequestDemandVector> = {}): RequestDemandVector {
  return {
    version: requestDemandVectorVersion,
    technicalDifficulty: 0,
    reasoningDepth: 0,
    creativity: 0,
    designSkill: 0,
    factualPrecision: 0,
    qualityRequirement: 0,
    ambiguity: 0,
    toolComplexity: 0,
    contextComplexity: 0,
    codingIntensity: 0,
    safetyStakes: 0,
    ...overrides,
  };
}

function classification(options: { deepReasoningRequired?: boolean; qualityRequirement?: number } = {}): RequestClassification {
  return {
    demandVector: vector({ qualityRequirement: options.qualityRequirement ?? 0 }),
    deepReasoningRequired: options.deepReasoningRequired ?? false,
    confidence: 0.95,
    classifierMetadata: { provider: 'fake', model: 'fake-classifier', classifierVersion: 'test-v1' },
  };
}

function fakeClassifier(result: unknown): RequestClassifier {
  return { name: 'fake-classifier', classify: async () => result as RequestClassification };
}

const request: ResponseRequest = { messages: [{ role: 'user', content: 'hello' }] };

describe('async classifier routing', () => {
  it('uses classified demand for cheapest-qualified selection and records status', async () => {
    let calls = 0;
    const classifier: RequestClassifier = {
      name: 'fake-classifier',
      classify: async ({ deterministicFeatures, signal }) => {
        calls += 1;
        expect(deterministicFeatures.demandVector).toBeUndefined();
        expect(signal.aborted).toBe(false);
        return classification({ qualityRequirement: 0.8 });
      },
    };
    const route = await new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier }).decideAsync('req_classified', request, new AbortController().signal);
    expect(calls).toBe(1);
    expect(route.selected.model.id).toBe('sim-balanced');
    expect(route.features.demandVector?.qualityRequirement).toBe(0.8);
    expect(route.features.classificationConfidence).toBe(0.95);
    expect(route.metadata).toEqual({
      classificationStatus: 'classified',
      reasoningGate: { initialModelId: 'sim-balanced', selectedModelId: 'sim-balanced', promoted: false },
    });
  });

  it('promotes the first ranked reasoning model and removes non-reasoning fallbacks', async () => {
    const route = await new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier: fakeClassifier(classification({ deepReasoningRequired: true })) })
      .decideAsync('req_promote', request, new AbortController().signal);
    expect(route.selected.model.id).toBe('sim-balanced');
    expect(route.alternatives.every((candidate) => candidate.model.capabilities.includes('reasoning'))).toBe(true);
    expect(route.metadata?.reasoningGate).toEqual({ initialModelId: 'sim-small-text', selectedModelId: 'sim-balanced', promoted: true });
  });

  it('rejects an explicit non-reasoning model instead of promoting it', async () => {
    const explicit = { ...request, model: 'sim-small-text' };
    await expect(new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier: fakeClassifier(classification({ deepReasoningRequired: true })) })
      .decideAsync('req_explicit', explicit, new AbortController().signal)).rejects.toMatchObject({ name: 'RouterError', code: 'no_eligible_model' });
  });

  it('fails when no reasoning-capable candidate exists', async () => {
    const registry = new InMemoryModelRegistry([defaultModels[0]!]);
    await expect(new DeterministicRouter(registry, { classifier: fakeClassifier(classification({ deepReasoningRequired: true })) })
      .decideAsync('req_no_reasoning', request, new AbortController().signal)).rejects.toBeInstanceOf(NoRouteError);
  });

  it('degrades on malformed classifier output without exposing it', async () => {
    const route = await new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier: fakeClassifier({}), failureMode: 'degrade' })
      .decideAsync('req_degrade', request, new AbortController().signal);
    expect(route.metadata?.classificationStatus).toBe('degraded');
    expect(route.features.demandVector).toBeUndefined();
  });

  it('fails cleanly on malformed classifier output in fail mode', async () => {
    await expect(new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier: fakeClassifier({}), failureMode: 'fail' })
      .decideAsync('req_fail', request, new AbortController().signal)).rejects.toMatchObject({ code: 'classification_failed', statusCode: 503 });
  });

  it('degrades on classifier timeout', async () => {
    const classifier: RequestClassifier = { name: 'slow', classify: async () => new Promise<RequestClassification>(() => {}) };
    const route = await new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier, classifierTimeoutMs: 5 })
      .decideAsync('req_timeout', request, new AbortController().signal);
    expect(route.metadata?.classificationStatus).toBe('degraded');
    expect(route.selected.model.id).toBe('sim-small-text');
  });

  it('maps caller cancellation to RequestCancelledError and aborts the classifier', async () => {
    let started!: () => void;
    const classifierStarted = new Promise<void>((resolve) => { started = resolve; });
    const classifier: RequestClassifier = {
      name: 'cancellable',
      classify: async ({ signal }) => {
        started();
        await new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
        throw new Error('unreachable');
      },
    };
    const controller = new AbortController();
    const pending = new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier }).decideAsync('req_cancel', request, controller.signal);
    await classifierStarted;
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(RequestCancelledError);
  });
});

describe('router service streaming boundary', () => {
  it('emits no chunks until async routing completes', async () => {
    let release!: () => void;
    let started!: () => void;
    const classifierStarted = new Promise<void>((resolve) => { started = resolve; });
    const classificationRelease = new Promise<void>((resolve) => { release = resolve; });
    const classifier: RequestClassifier = {
      name: 'delayed',
      classify: async () => {
        started();
        await classificationRelease;
        return classification();
      },
    };
    let executed = false;
    const executor = {
      stream: async function* (): AsyncIterable<ResponseChunk> {
        executed = true;
        yield { requestId: 'req_stream_gate', index: 0, delta: 'ok', done: false };
      },
    } as unknown as RequestExecutor;
    const service = new RouterService(new DeterministicRouter(new InMemoryModelRegistry(defaultModels), { classifier }), executor);
    const iterator = service.stream(request, new AbortController().signal)[Symbol.asyncIterator]();
    const next = iterator.next();
    await classifierStarted;
    expect(executed).toBe(false);
    release();
    expect((await next).value).toMatchObject({ delta: 'ok', done: false });
    expect(executed).toBe(true);
  });
});
