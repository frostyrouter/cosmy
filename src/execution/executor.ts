import { performance } from 'node:perf_hooks';
import type { ProviderAdapter } from '../ports/provider.js';
import type { HealthStore, UsageLedger, UsageReservation } from '../ports/stores.js';
import type { ModelConfiguration, ResponseChunk, ResponseRequest, ResponseResult, RouteDecision } from '../domain/types.js';
import { ProviderError, RequestCancelledError, RouterError } from '../domain/errors.js';
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
    private readonly requestTimeoutMs?: number,
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
    const deadline = this.requestTimeoutMs !== undefined ? abortAfter(signal, this.requestTimeoutMs) : undefined;
    const effective = deadline?.signal ?? signal;
    try {
      if (effective.aborted) throw new RequestCancelledError();
      if (route.alternatives.length === 0) return await this.executeCandidate({ requestId, route, request, signal: effective, fallbackIndex: 0 });
      const candidates = [route.selected, ...route.alternatives];
      let lastError: unknown;
      for (const [fallbackIndex, candidate] of candidates.entries()) {
        const attemptRoute = { ...route, selected: candidate, alternatives: candidates.slice(fallbackIndex + 1) };
        try {
          return await this.executeCandidate({ requestId, route: attemptRoute, request, signal: effective, fallbackIndex });
        } catch (error) {
          lastError = error;
          if (request.policy?.allowFallback === false || !(error instanceof ProviderError) || !error.retryable || fallbackIndex === candidates.length - 1) throw error;
        }
      }
      throw lastError instanceof Error ? lastError : new ProviderError('All route candidates failed');
    } catch (error) {
      if (deadline?.signal.aborted && !signal.aborted) {
        throw new RouterError('Request exceeded the configured deadline', 'timeout', 504, true);
      }
      throw error;
    } finally {
      deadline?.dispose();
    }
  }

  async *stream(options: ExecutionOptions): AsyncIterable<ResponseChunk> {
    const { request, route, requestId, signal } = options;
    if (signal.aborted) throw new RequestCancelledError();
    if (route.alternatives.length === 0) {
      for await (const chunk of this.streamCandidate({ requestId, route, request, signal, fallbackIndex: 0 })) yield chunk;
      return;
    }
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

  private async reconcileBestEffort(reservation: UsageReservation, actualCostUsd: number): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.usage.reconcile(reservation, actualCostUsd);
        return;
      } catch {
        // transient store failure; retry once, then best-effort release
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
      await this.reconcileBestEffort(reservation, response.usage.estimatedCostUsd);
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: 'success', latencyMs, usage: response.usage, fallbackIndex });
      return { requestId, model: route.selected.model.model, provider: provider.name, output: response.output, usage: response.usage, status: 'completed', finishReason: response.finishReason, route };
    } catch (error) {
      const latencyMs = performance.now() - started;
      if (!(error instanceof RequestCancelledError)) this.health.markFailure(route.selected.model.id);
      await this.reconcileBestEffort(reservation, 0);
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
    const heartbeat = this.usage.heartbeat
      ? setInterval(() => { void this.usage.heartbeat?.(reservation).catch(() => undefined); }, 30_000)
      : undefined;
    heartbeat?.unref();
    try {
      for await (const chunk of provider.stream({ request: { ...request, requestId }, model: route.selected.model, signal })) {
        yield { ...chunk, requestId };
        if (chunk.done) {
          const latencyMs = performance.now() - started;
          this.health.markSuccess(route.selected.model.id, latencyMs);
          completed = true;
          if (chunk.usage) {
            actualCostUsd = chunk.usage.estimatedCostUsd;
            this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: 'success', latencyMs, usage: chunk.usage, fallbackIndex });
          } else {
            actualCostUsd = reservation.estimatedCostUsd;
            this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: 'success', latencyMs, fallbackIndex });
          }
        }
      }
    } catch (error) {
      if (!(error instanceof RequestCancelledError)) this.health.markFailure(route.selected.model.id);
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: error instanceof RequestCancelledError ? 'cancelled' : 'error', latencyMs: performance.now() - started, fallbackIndex });
      throw error;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await this.reconcileBestEffort(reservation, completed ? actualCostUsd : 0);
    }
  }
}

export interface Deadline { signal: AbortSignal; dispose: () => void; }

export function abortAfter(signal: AbortSignal, timeoutMs: number): Deadline {
  const controller = new AbortController();
  const onParentAbort = () => { clearTimeout(timer); controller.abort(); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', onParentAbort); controller.abort(); }, timeoutMs);
  signal.addEventListener('abort', onParentAbort, { once: true });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return {
    signal: controller.signal,
    dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', onParentAbort); },
  };
}
