import { performance } from 'node:perf_hooks';
import type { ProviderAdapter } from '../ports/provider.js';
import type { HealthStore, UsageLedger } from '../ports/stores.js';
import type { ResponseChunk, ResponseRequest, ResponseResult, RouteDecision } from '../domain/types.js';
import { providerForModel } from '../providers/simulator.js';
import { RequestCancelledError } from '../domain/errors.js';
import { nowIso } from '../util/ids.js';

export interface ExecutionOptions {
  requestId: string;
  route: RouteDecision;
  request: ResponseRequest;
  signal: AbortSignal;
}

export class RequestExecutor {
  constructor(
    private readonly providers: readonly ProviderAdapter[],
    private readonly usage: UsageLedger,
    private readonly health: HealthStore,
  ) {}

  async execute(options: ExecutionOptions): Promise<ResponseResult> {
    const { request, route, requestId, signal } = options;
    if (signal.aborted) throw new RequestCancelledError();
    const provider = providerForModel(this.providers, route.selected.model);
    const tenantId = request.policy?.tenantId ?? 'default';
    await this.usage.reserve({ tenantId, estimatedCostUsd: route.selected.estimatedCostUsd });
    const started = performance.now();
    try {
      const response = await provider.complete({ request: { ...request, requestId }, model: route.selected.model, signal });
      this.health.markSuccess(route.selected.model.id, performance.now() - started);
      await this.usage.record({ tenantId, usage: response.usage });
      return { requestId, model: route.selected.model.model, provider: provider.name, output: response.output, usage: response.usage, status: 'completed', finishReason: response.finishReason, route };
    } catch (error) {
      this.health.markFailure(route.selected.model.id);
      throw error;
    }
  }

  async *stream(options: ExecutionOptions): AsyncIterable<ResponseChunk> {
    const { request, route, requestId, signal } = options;
    if (signal.aborted) throw new RequestCancelledError();
    const provider = providerForModel(this.providers, route.selected.model);
    const tenantId = request.policy?.tenantId ?? 'default';
    await this.usage.reserve({ tenantId, estimatedCostUsd: route.selected.estimatedCostUsd });
    const started = performance.now();
    try {
      for await (const chunk of provider.stream({ request: { ...request, requestId }, model: route.selected.model, signal })) {
        yield { ...chunk, requestId };
        if (chunk.done && chunk.usage) {
          this.health.markSuccess(route.selected.model.id, performance.now() - started);
          await this.usage.record({ tenantId, usage: chunk.usage });
        }
      }
    } catch (error) {
      this.health.markFailure(route.selected.model.id);
      throw error;
    }
  }
}

export function abortAfter(signal: AbortSignal, timeoutMs: number): AbortController {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal.addEventListener('abort', () => { clearTimeout(timer); controller.abort(); }, { once: true });
  controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return controller;
}
