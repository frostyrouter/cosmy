import { createHash } from 'node:crypto';
import type { DecisionAttempt, DecisionOutcome, DecisionRecord, ModelConfiguration, ResponseChunk, ResponseRequest, ResponseResult, RouteDecision } from '../domain/types.js';
import { requestId } from '../util/ids.js';
import { DeterministicRouter } from '../routing/router.js';
import { abortAfter, RequestExecutor } from '../execution/executor.js';
import { NoRouteError, RequestCancelledError, RouterError } from '../domain/errors.js';
import type { DecisionStore, IdempotencyClaim, IdempotencyStore, ResponseCache } from '../persistence/contracts.js';
import type { MetricsSink } from '../observability/metrics.js';
import type { ShadowScheduler } from '../shadow/coordinator.js';
import { validateConversation } from './request-validation.js';

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
    private readonly decisions?: DecisionStore,
    private readonly requestDeadlineMs?: number,
  ) {}

  async simulate(request: ResponseRequest, signal: AbortSignal): Promise<RouteDecision> {
    validateConversation(request);
    if (signal.aborted) throw new RequestCancelledError();
    return this.router.decide(request.requestId ?? requestId(), request);
  }

  listModels(tenantId?: string): readonly ModelConfiguration[] { return this.router.listModels(tenantId); }

  async decision(tenantId: string, decisionId: string): Promise<DecisionRecord | undefined> {
    if (!this.decisions) return undefined;
    try { return await this.decisions.get(tenantId, decisionId); }
    catch {
      this.metrics?.increment?.('decision_store_failure');
      throw new RouterError('Unable to read the routing decision', 'decision_store_error', 503, true);
    }
  }

  async complete(request: ResponseRequest, signal: AbortSignal, idempotencyKey?: string): Promise<ResponseResult> {
    request = request.requestId ? request : { ...request, requestId: requestId() };
    try { validateConversation(request); }
    catch (error) { await this.saveRejectedDecision(request, request.requestId!, error, true); throw error; }
    const deadline = this.requestDeadlineMs !== undefined ? abortAfter(signal, this.requestDeadlineMs) : undefined;
    try {
      return await this.completeWithIdempotency(request, deadline?.signal ?? signal, idempotencyKey, () => deadline?.signal.aborted === true && !signal.aborted);
    } catch (error) {
      if (deadline?.signal.aborted && !signal.aborted) throw new RouterError('Request exceeded the configured deadline', 'timeout', 504, true);
      throw error;
    } finally { deadline?.dispose(); }
  }

  private async completeWithIdempotency(request: ResponseRequest, signal: AbortSignal, idempotencyKey?: string, deadlineExpired?: () => boolean): Promise<ResponseResult> {
    if (!idempotencyKey || !this.idempotency) return this.completeOnce(request, signal, deadlineExpired);
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
      response = await this.completeOnce(request, signal, deadlineExpired);
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

  private async completeOnce(request: ResponseRequest, signal: AbortSignal, deadlineExpired?: () => boolean): Promise<ResponseResult> {
    const id = request.requestId ?? requestId();
    const attempts: DecisionAttempt[] = [];
    let route: RouteDecision;
    try { route = await this.router.decideAsync(id, request, signal); }
    catch (error) {
      const failure = deadlineExpired?.() ? new RouterError('Request exceeded the configured deadline', 'timeout', 504, true) : error;
      await this.saveRejectedDecision(request, id, failure, true);
      throw failure;
    }
    await this.saveDecision(request, route, 'planned', undefined, undefined, true);
    const cache = this.cache;
    try {
      if (!cache || this.cacheTtlSeconds <= 0 || !cacheEligible(request)) {
        const result = await this.executor.execute({ requestId: id, route, request, signal, onAttempt: (attempt) => attempts.push(attempt) });
        await this.saveCompletedDecision(request, result, attempts); this.scheduleShadow(request, result); return result;
      }
      const key = cacheKey(request, this.router.policyVersion, this.getRegistryVersion?.(), route.selected.model.id, route.selected.model.version);
      try {
        const cached = await cache.get(key);
        if (cached) {
          this.metrics?.increment?.('cache_hit');
          const stored = JSON.parse(cached.value) as ResponseResult;
          const result = { ...stored, requestId: id, route: { ...stored.route, requestId: id } };
          await this.saveCompletedDecision(request, result, attempts);
          return result;
        }
      } catch { this.metrics?.increment?.('cache_failure'); }
      const result = await this.executor.execute({ requestId: id, route, request, signal, onAttempt: (attempt) => attempts.push(attempt) });
      await this.saveCompletedDecision(request, result, attempts); this.scheduleShadow(request, result);
      try { await cache.set(key, JSON.stringify(result), this.cacheTtlSeconds); } catch { this.metrics?.increment?.('cache_failure'); }
      return result;
    } catch (error) {
      const failure = deadlineExpired?.() ? new RouterError('Request exceeded the configured deadline', 'timeout', 504, true) : error;
      await this.saveFailedDecision(request, route, failure, attempts);
      throw failure;
    }
  }

  async *stream(request: ResponseRequest, signal: AbortSignal): AsyncIterable<ResponseChunk> {
    request = request.requestId ? request : { ...request, requestId: requestId() };
    try { validateConversation(request); }
    catch (error) { await this.saveRejectedDecision(request, request.requestId!, error, true); throw error; }
    const deadline = this.requestDeadlineMs !== undefined ? abortAfter(signal, this.requestDeadlineMs) : undefined;
    const id = request.requestId ?? requestId();
    let route: RouteDecision | undefined;
    let terminal: ResponseChunk | undefined;
    let executedRoute: RouteDecision | undefined;
    let toolCalled = false;
    let visible = false;
    const attempts: DecisionAttempt[] = [];
    try {
      const effectiveSignal = deadline?.signal ?? signal;
      try { route = await this.router.decideAsync(id, request, effectiveSignal); }
      catch (error) {
        const failure = deadline?.signal.aborted && !signal.aborted ? new RouterError('Request exceeded the configured deadline before routing completed', 'timeout', 504, true) : error;
        await this.saveRejectedDecision(request, id, failure, true);
        throw failure;
      }
      executedRoute = route;
      await this.saveDecision(request, route, 'planned', undefined, undefined, true);
      for await (const chunk of this.executor.stream({ requestId: id, route, request, signal: effectiveSignal, onAttempt: (attempt) => attempts.push(attempt) })) {
        if (!visible) { visible = true; deadline?.dispose(); }
        if (chunk.route) executedRoute = chunk.route;
        if (chunk.type?.startsWith('tool-call')) toolCalled = true;
        terminal = chunk.done ? chunk : terminal;
        yield chunk;
      }
      const outcome: DecisionOutcome = { provider: executedRoute.selected.model.provider, model: executedRoute.selected.model.model, status: 'completed', finishReason: toolCalled ? 'tool_calls' : 'stop', ...(terminal?.usage ? { usage: terminal.usage } : {}) };
      await this.saveDecision(request, executedRoute, 'completed', outcome, undefined, false, attempts);
    } catch (error) {
      const failure = !visible && deadline?.signal.aborted && !signal.aborted
        ? new RouterError('Request exceeded the configured deadline before first output', 'timeout', 504, true)
        : error;
      if (executedRoute) await this.saveFailedDecision(request, executedRoute, failure, attempts);
      throw failure;
    } finally { deadline?.dispose(); }
  }

  private saveCompletedDecision(request: ResponseRequest, result: ResponseResult, attempts: DecisionAttempt[]): Promise<void> {
    return this.saveDecision(request, result.route, 'completed', { provider: result.provider, model: result.model, status: result.status, finishReason: result.finishReason, usage: result.usage }, undefined, false, attempts);
  }

  private saveFailedDecision(request: ResponseRequest, route: RouteDecision, error: unknown, attempts: DecisionAttempt[]): Promise<void> {
    const cancelled = error instanceof RequestCancelledError;
    const code = error instanceof RouterError ? error.code : cancelled ? 'cancelled' : 'internal_error';
    return this.saveDecision(request, route, cancelled ? 'cancelled' : 'failed', undefined, code, false, attempts);
  }

  private async saveDecision(request: ResponseRequest, route: RouteDecision, state: DecisionRecord['state'], outcome?: DecisionOutcome, errorCode?: string, required = false, attempts: DecisionAttempt[] = []): Promise<void> {
    if (!this.decisions) return;
    const now = new Date().toISOString();
    const registryVersion = this.getRegistryVersion?.();
    const record: DecisionRecord = { id: route.requestId, tenantId: request.policy?.tenantId ?? 'anonymous', state, route, attempts: structuredClone(attempts), ...(registryVersion !== undefined ? { registryVersion } : {}), ...(outcome ? { outcome } : {}), ...(errorCode ? { errorCode } : {}), createdAt: route.createdAt, updatedAt: now };
    try { await this.decisions.save(record); }
    catch {
      this.metrics?.increment?.('decision_store_failure');
      if (required) throw new RouterError('Unable to persist the routing decision', 'decision_store_error', 503, true);
    }
  }

  private async saveRejectedDecision(request: ResponseRequest, id: string, error: unknown, required = false): Promise<void> {
    if (!this.decisions) return;
    const now = new Date().toISOString();
    const normalized = error instanceof RouterError ? error : new RouterError('Routing failed unexpectedly', 'internal_error', 500, false);
    const registryVersion = this.getRegistryVersion?.();
    const record: DecisionRecord = {
      id, tenantId: request.policy?.tenantId ?? 'anonymous', state: 'rejected', attempts: [],
      rejection: { code: normalized.code, statusCode: normalized.statusCode, retryable: normalized.retryable, ...(normalized instanceof NoRouteError && normalized.rejected.length ? { candidates: normalized.rejected as import('../domain/types.js').Rejection[] } : {}) },
      errorCode: normalized.code, ...(registryVersion !== undefined ? { registryVersion } : {}), createdAt: now, updatedAt: now,
    };
    try { await this.decisions.save(record); }
    catch {
      this.metrics?.increment?.('decision_store_failure');
      if (required) throw new RouterError('Unable to persist the rejected routing decision', 'decision_store_error', 503, true);
    }
  }

  private scheduleShadow(request: ResponseRequest, result: ResponseResult): void {
    if (!this.shadows) return;
    setImmediate(() => { try { this.shadows?.enqueue(request, result); } catch { this.metrics?.increment?.('shadow_execution_failure'); } });
  }
}
