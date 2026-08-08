import { performance } from 'node:perf_hooks';
import type { ProviderAdapter } from '../ports/provider.js';
import type { HealthStore, UsageLedger } from '../ports/stores.js';
import type { ModelConfiguration, ResponseChunk, ResponseRequest, ResponseResult, RouteDecision } from '../domain/types.js';
import { ProviderError, RequestCancelledError } from '../domain/errors.js';
import type { MetricsSink } from '../observability/metrics.js';

export interface ExecutionOptions {
  requestId: string;
  route: RouteDecision;
  request: ResponseRequest;
  signal: AbortSignal;
}

export class RequestExecutor {
  private readonly providerByName: Map<string, ProviderAdapter>;

  constructor(
    private readonly providers: readonly ProviderAdapter[],
    private readonly usage: UsageLedger,
    private readonly health: HealthStore,
    private readonly metrics?: MetricsSink,
  ) {
    this.providerByName = new Map(providers.map((provider) => [provider.name, provider]));
  }

  private providerFor(model: ModelConfiguration): ProviderAdapter {
    const provider = this.providerByName.get(model.provider);
    if (!provider) throw new ProviderError(`Provider '${model.provider}' is not configured`, false);
    return provider;
  }

  async execute(options: ExecutionOptions): Promise<ResponseResult> {
    const { request, route, requestId, signal } = options;
    if (signal.aborted) throw new RequestCancelledError();
    const candidates = [route.selected, ...route.alternatives];
    let lastError: unknown;
    for (const [fallbackIndex, candidate] of candidates.entries()) {
      const attemptRoute = { ...route, selected: candidate, alternatives: candidates.slice(fallbackIndex + 1) };
      try {
        return await this.executeCandidate({ requestId, route: attemptRoute, request, signal, fallbackIndex });
      } catch (error) {
        lastError = error;
        if (request.policy?.allowFallback === false || !(error instanceof ProviderError) || !error.retryable || fallbackIndex === candidates.length - 1) throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError('All route candidates failed');
  }

  async *stream(options: ExecutionOptions): AsyncIterable<ResponseChunk> {
    const { request, route, requestId, signal } = options;
    if (signal.aborted) throw new RequestCancelledError();
    const candidates = [route.selected, ...route.alternatives];
    for (const [fallbackIndex, candidate] of candidates.entries()) {
      const attemptRoute = { ...route, selected: candidate, alternatives: candidates.slice(fallbackIndex + 1) };
      let emitted = false;
      try {
        for await (const chunk of this.streamCandidate({ requestId, route: attemptRoute, request, signal, fallbackIndex })) {
          emitted = emitted || chunk.delta.length > 0;
          yield chunk;
        }
        return;
      } catch (error) {
        if (request.policy?.allowFallback === false || emitted || !(error instanceof ProviderError) || !error.retryable || fallbackIndex === candidates.length - 1) throw error;
      }
    }
  }

  private async executeCandidate(options: ExecutionOptions & { fallbackIndex: number }): Promise<ResponseResult> {
    const { request, route, requestId, signal, fallbackIndex } = options;
    const provider = this.providerFor(route.selected.model);
    const tenantId = request.policy?.tenantId ?? 'default';
    const reservation = await this.usage.reserve({ tenantId, estimatedCostUsd: route.selected.estimatedCostUsd });
    const started = performance.now();
    try {
      const response = await provider.complete({ request: { ...request, requestId }, model: route.selected.model, signal });
      const latencyMs = performance.now() - started;
      this.health.markSuccess(route.selected.model.id, latencyMs);
      await this.usage.reconcile(reservation, response.usage.estimatedCostUsd);
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: 'success', latencyMs, usage: response.usage, fallbackIndex });
      return { requestId, model: route.selected.model.model, provider: provider.name, output: response.output, usage: response.usage, status: 'completed', finishReason: response.finishReason, route };
    } catch (error) {
      const latencyMs = performance.now() - started;
      this.health.markFailure(route.selected.model.id);
      await this.usage.reconcile(reservation, 0);
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: error instanceof RequestCancelledError ? 'cancelled' : 'error', latencyMs, fallbackIndex });
      throw error;
    }
  }

  private async *streamCandidate(options: ExecutionOptions & { fallbackIndex: number }): AsyncIterable<ResponseChunk> {
    const { request, route, requestId, signal, fallbackIndex } = options;
    const provider = this.providerFor(route.selected.model);
    const tenantId = request.policy?.tenantId ?? 'default';
    const reservation = await this.usage.reserve({ tenantId, estimatedCostUsd: route.selected.estimatedCostUsd });
    const started = performance.now();
    let actualCostUsd = 0;
    let completed = false;
    try {
      for await (const chunk of provider.stream({ request: { ...request, requestId }, model: route.selected.model, signal })) {
        yield { ...chunk, requestId };
        if (chunk.done && chunk.usage) { const latencyMs = performance.now() - started; this.health.markSuccess(route.selected.model.id, latencyMs); actualCostUsd = chunk.usage.estimatedCostUsd; completed = true; this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: 'success', latencyMs, usage: chunk.usage, fallbackIndex }); }
      }
    } catch (error) {
      this.health.markFailure(route.selected.model.id);
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: error instanceof RequestCancelledError ? 'cancelled' : 'error', latencyMs: performance.now() - started, fallbackIndex });
      throw error;
    } finally { await this.usage.reconcile(reservation, completed ? actualCostUsd : 0); }
  }
}

export function abortAfter(signal: AbortSignal, timeoutMs: number): AbortController {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal.addEventListener('abort', () => { clearTimeout(timer); controller.abort(); }, { once: true });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller;
}
