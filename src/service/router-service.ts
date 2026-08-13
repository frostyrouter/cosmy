import { createHash } from 'node:crypto';
import type { ResponseChunk, ResponseRequest, ResponseResult } from '../domain/types.js';
import { requestId } from '../util/ids.js';
import { DeterministicRouter } from '../routing/router.js';
import { RequestExecutor } from '../execution/executor.js';
import { RouterError } from '../domain/errors.js';
import type { IdempotencyClaim, IdempotencyStore, ResponseCache } from '../persistence/contracts.js';
import type { MetricsSink } from '../observability/metrics.js';
import type { ShadowScheduler } from '../shadow/coordinator.js';

function cacheKey(request: ResponseRequest, policyVersion: string | undefined, registryVersion: number | undefined, modelId: string, modelVersion: string): string {
  const normalized = { ...request, requestId: undefined, stream: false };
  const versioned = `${policyVersion ?? 'unknown'}|${registryVersion ?? 'unknown'}|${modelId}@${modelVersion}|${canonicalJson(normalized)}`;
  return createHash('sha256').update(versioned).digest('hex');
}

function requestHash(request: ResponseRequest): string {
  return createHash('sha256').update(canonicalJson({ ...request, requestId: undefined, stream: false })).digest('hex');
}

function canonicalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, normalize(entry)]));
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

function cacheEligible(request: ResponseRequest): boolean {
  const dataClass = request.policy?.dataClass ?? 'internal';
  return (dataClass === 'public' || dataClass === 'internal')
    && (request.tools?.length ?? 0) === 0
    && (request.temperature === undefined || request.temperature === 0);
}

export class RouterService {
  constructor(
    private readonly router: DeterministicRouter,
    private readonly executor: RequestExecutor,
    private readonly cache?: ResponseCache,
    private readonly cacheTtlSeconds = 0,
    private readonly getRegistryVersion?: () => number | undefined,
    private readonly idempotency?: IdempotencyStore,
    private readonly idempotencyTtlSeconds = 86_400,
    private readonly metrics?: MetricsSink,
    private readonly shadows?: ShadowScheduler,
  ) {}

  async complete(request: ResponseRequest, signal: AbortSignal, idempotencyKey?: string): Promise<ResponseResult> {
    if (!idempotencyKey || !this.idempotency) return this.completeOnce(request, signal);
    const tenantId = request.policy?.tenantId ?? 'anonymous';
    const hash = requestHash(request);
    let claim: IdempotencyClaim;
    try {
      claim = await this.idempotency.claim(tenantId, idempotencyKey, hash, this.idempotencyTtlSeconds);
    } catch {
      this.metrics?.increment?.('idempotency_store_failure');
      throw new RouterError('Unable to claim the idempotency key', 'idempotency_store_error', 503, true);
    }
    if (claim.status === 'replay') return claim.response;
    if (claim.status === 'conflict') throw new RouterError('Idempotency key was already used with a different request', 'idempotency_conflict', 409, false);
    if (claim.status === 'in-progress') throw new RouterError('A request with this idempotency key is still running', 'idempotency_in_progress', 409, true);
    let response: ResponseResult;
    try {
      response = await this.completeOnce(request, signal);
    } catch (error) {
      try { await this.idempotency.release(tenantId, idempotencyKey, hash); } catch { /* Preserve the execution error. */ }
      throw error;
    }
    try {
      await this.idempotency.complete(tenantId, idempotencyKey, hash, response);
    } catch {
      // Keep the processing claim: releasing it could execute and bill the request twice.
      this.metrics?.increment?.('idempotency_store_failure');
      throw new RouterError('Unable to persist the idempotent response', 'idempotency_store_error', 503, true);
    }
    return response;
  }

  private async completeOnce(request: ResponseRequest, signal: AbortSignal): Promise<ResponseResult> {
    const id = request.requestId ?? requestId();
    const route = await this.router.decideAsync(id, request, signal);
    const cache = this.cache;
    if (!cache || this.cacheTtlSeconds <= 0 || !cacheEligible(request)) {
      const result = await this.executor.execute({ requestId: id, route, request, signal }); this.scheduleShadow(request, result); return result;
    }
    const key = cacheKey(request, this.router.policyVersion, this.getRegistryVersion?.(), route.selected.model.id, route.selected.model.version);
    try {
      const cached = await cache.get(key);
      if (cached) {
        this.metrics?.increment?.('cache_hit');
        const result = JSON.parse(cached.value) as ResponseResult;
        return { ...result, requestId: id, route: { ...result.route, requestId: id } };
      }
    } catch { this.metrics?.increment?.('cache_failure'); }
    const result = await this.executor.execute({ requestId: id, route, request, signal });
    this.scheduleShadow(request, result);
    try { await cache.set(key, JSON.stringify(result), this.cacheTtlSeconds); } catch { this.metrics?.increment?.('cache_failure'); }
    return result;
  }

  async *stream(request: ResponseRequest, signal: AbortSignal): AsyncIterable<ResponseChunk> {
    const id = request.requestId ?? requestId();
    const route = await this.router.decideAsync(id, request, signal);
    for await (const chunk of this.executor.stream({ requestId: id, route, request, signal })) yield chunk;
  }

  private scheduleShadow(request: ResponseRequest, result: ResponseResult): void {
    if (!this.shadows) return;
    setImmediate(() => { try { this.shadows?.enqueue(request, result); } catch { this.metrics?.increment?.('shadow_execution_failure'); } });
  }
}
