import { createHash } from 'node:crypto';
import type { ResponseChunk, ResponseRequest, ResponseResult } from '../domain/types.js';
import { requestId } from '../util/ids.js';
import { DeterministicRouter } from '../routing/router.js';
import { RequestExecutor } from '../execution/executor.js';
import type { ResponseCache } from '../persistence/contracts.js';

function cacheKey(request: ResponseRequest, policyVersion: string | undefined, registryVersion: number | undefined): string {
  const normalized = { ...request, requestId: undefined, stream: false };
  const versioned = `${policyVersion ?? 'unknown'}|${registryVersion ?? 'unknown'}|${JSON.stringify(normalized)}`;
  return createHash('sha256').update(versioned).digest('hex');
}

export class RouterService {
  constructor(
    private readonly router: DeterministicRouter,
    private readonly executor: RequestExecutor,
    private readonly cache?: ResponseCache,
    private readonly cacheTtlSeconds = 0,
    private readonly registryVersion?: number,
  ) {}

  async complete(request: ResponseRequest, signal: AbortSignal): Promise<ResponseResult> {
    const id = request.requestId ?? requestId();
    const route = this.router.decide(id, request);
    const cache = this.cache;
    if (!cache || this.cacheTtlSeconds <= 0) return this.executor.execute({ requestId: id, route, request, signal });
    const key = cacheKey(request, this.router.policyVersion, this.registryVersion);
    try {
      const cached = await cache.get(key);
      if (cached) {
        const result = JSON.parse(cached.value) as ResponseResult;
        return { ...result, requestId: id, route: { ...result.route, requestId: id } };
      }
    } catch { /* Cache failures must not take down provider execution. */ }
    const result = await this.executor.execute({ requestId: id, route, request, signal });
    try { await cache.set(key, JSON.stringify(result), this.cacheTtlSeconds); } catch { /* Cache failures are fail-open. */ }
    return result;
  }

  stream(request: ResponseRequest, signal: AbortSignal): AsyncIterable<ResponseChunk> {
    const id = request.requestId ?? requestId();
    const route = this.router.decide(id, request);
    return this.executor.stream({ requestId: id, route, request, signal });
  }
}
