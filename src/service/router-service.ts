import { createHash } from 'node:crypto';
import type { DecisionAttempt, DecisionRecord, ResponseChunk, ResponseRequest, ResponseResult, RouteDecision } from '../domain/types.js';
import { requestId } from '../util/ids.js';
import { DeterministicRouter } from '../routing/router.js';
import { RequestExecutor } from '../execution/executor.js';
import { RequestCancelledError, RouterError } from '../domain/errors.js';
import type { DecisionStore, IdempotencyClaim, IdempotencyStore, ResponseCache } from '../persistence/contracts.js';
import type { MetricsSink } from '../observability/metrics.js';
import type { ShadowScheduler } from '../shadow/coordinator.js';
import { validateConversation } from './request-validation.js';
import type { ExecutionObserver } from '../execution/executor.js';

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

  async decision(tenantId: string, decisionId: string): Promise<DecisionRecord | undefined> {
    return this.decisions?.get(tenantId, decisionId);
  }

  simulate(request: ResponseRequest): RouteDecision {
    const id = request.requestId ?? requestId();
    validateConversation(request);
    return this.router.decide(id, request);
  }

  private async completeOnce(request: ResponseRequest, signal: AbortSignal): Promise<ResponseResult> {
    const id = request.requestId ?? requestId();
    const tenantId = request.policy?.tenantId ?? 'anonymous';
    let route: RouteDecision;
    try {
      validateConversation(request);
      route = await this.router.decideAsync(id, request, signal);
    } catch (error) {
      await this.persistRejected(id, tenantId, error);
      throw error;
    }
    const record = this.plannedRecord(id, tenantId, route);
    await this.persistPlan(record);
    const observer = this.observerFor(record);
    const cache = this.cache;
    try {
      if (!cache || this.cacheTtlSeconds <= 0 || !cacheEligible(request)) {
        const result = await this.executor.execute({ requestId: id, route, request, signal, observer });
        const completed = this.completeRecord(record, result);
        await this.persistTerminal(completed);
        this.scheduleShadow(request, result);
        return this.withExecutionRoute(result, route, record);
      }
      const key = cacheKey(request, this.router.policyVersion, this.getRegistryVersion?.(), route.selected.model.id, route.selected.model.version);
      try {
        const cached = await cache.get(key);
        if (cached) {
          this.metrics?.increment?.('cache_hit');
          const result = JSON.parse(cached.value) as ResponseResult;
          const replayed = { ...result, requestId: id, route: { ...result.route, requestId: id } };
          await this.persistTerminal(this.completeRecord(record, replayed));
          return replayed;
        }
      } catch { this.metrics?.increment?.('cache_failure'); }
      const result = await this.executor.execute({ requestId: id, route, request, signal, observer });
      try { await cache.set(key, JSON.stringify(result), this.cacheTtlSeconds); } catch { this.metrics?.increment?.('cache_failure'); }
      await this.persistTerminal(this.completeRecord(record, result));
      this.scheduleShadow(request, result);
      return this.withExecutionRoute(result, route, record);
    } catch (error) {
      await this.persistTerminal(this.failedRecord(record, error));
      throw error;
    }
  }

  async *stream(request: ResponseRequest, signal: AbortSignal): AsyncIterable<ResponseChunk> {
    const id = request.requestId ?? requestId();
    const tenantId = request.policy?.tenantId ?? 'anonymous';
    let route: RouteDecision;
    try {
      validateConversation(request);
      route = await this.router.decideAsync(id, request, signal);
    } catch (error) {
      await this.persistRejected(id, tenantId, error);
      throw error;
    }
    const record = this.plannedRecord(id, tenantId, route);
    await this.persistPlan(record);
    try {
      let usage: ResponseResult['usage'] | undefined;
      for await (const chunk of this.executor.stream({ requestId: id, route, request, signal, observer: this.observerFor(record) })) {
        if (chunk.usage) usage = chunk.usage;
        yield chunk;
      }
      const finished = lastCompletedAttempt(record.attempts);
      const terminal: DecisionRecord = {
        ...record, state: 'completed', updatedAt: new Date().toISOString(),
        route: this.routeWithExecution(route, record),
      };
      if (finished && usage) terminal.outcome = { provider: finished.provider, model: finished.model, status: 'completed', finishReason: 'stop', usage };
      await this.persistTerminal(terminal);
    } catch (error) {
      await this.persistTerminal(this.failedRecord(record, error));
      throw error;
    }
  }

  private plannedRecord(id: string, tenantId: string, route: RouteDecision): DecisionRecord {
    const now = new Date().toISOString();
    return { id, tenantId, state: 'planned', route, attempts: [], createdAt: now, updatedAt: now };
  }

  private observerFor(record: DecisionRecord): ExecutionObserver {
    return {
      attemptStarted: ({ index, model, startedAt }) => {
        record.attempts.push({ index, modelId: model.id, model: model.model, provider: model.provider, status: 'failed', startedAt });
      },
      attemptFinished: ({ index, status, completedAt, latencyMs, errorCode, usage }) => {
        const attempt = record.attempts.find((entry) => entry.index === index);
        if (!attempt) return;
        attempt.status = status;
        attempt.completedAt = completedAt;
        attempt.latencyMs = latencyMs;
        if (errorCode) attempt.errorCode = errorCode;
        if (usage) attempt.usage = usage;
      },
    };
  }

  private completeRecord(record: DecisionRecord, result: ResponseResult): DecisionRecord {
    return {
      ...record, state: 'completed', updatedAt: new Date().toISOString(), route: this.routeWithExecution(record.route!, record),
      outcome: { provider: result.provider, model: result.model, status: result.status, finishReason: result.finishReason, usage: result.usage },
    };
  }

  private failedRecord(record: DecisionRecord, error: unknown): DecisionRecord {
    const routerError = error instanceof RouterError ? error : undefined;
    return { ...record, state: error instanceof RequestCancelledError ? 'cancelled' : 'failed', updatedAt: new Date().toISOString(), ...(routerError ? { errorCode: routerError.code } : {}) };
  }

  private async persistPlan(record: DecisionRecord): Promise<void> {
    if (!this.decisions) return;
    try { await this.decisions.save(record); } catch {
      this.metrics?.increment?.('decision_store_failure');
      throw new RouterError('Unable to persist the planned routing decision', 'decision_store_error', 503, true);
    }
  }

  private async persistTerminal(record: DecisionRecord): Promise<void> {
    if (!this.decisions) return;
    try { await this.decisions.save(record); } catch { this.metrics?.increment?.('decision_store_failure'); }
  }

  private async persistRejected(id: string, tenantId: string, error: unknown): Promise<void> {
    if (!this.decisions) return;
    const routerError = error instanceof RouterError ? error : new RouterError('Request validation failed', 'invalid_request', 400, false);
    const now = new Date().toISOString();
    await this.persistTerminal({ id, tenantId, state: 'rejected', attempts: [], errorCode: routerError.code, rejection: { code: routerError.code, statusCode: routerError.statusCode, retryable: routerError.retryable }, createdAt: now, updatedAt: now });
  }

  private routeWithExecution(route: RouteDecision, record: DecisionRecord): RouteDecision {
    const finished = lastCompletedAttempt(record.attempts);
    if (!finished) return route;
    const selected = [route.selected, ...route.alternatives].find((candidate) => candidate.model.id === finished.modelId) ?? route.selected;
    return { ...route, selected, alternatives: [route.selected, ...route.alternatives].filter((candidate) => candidate.model.id !== selected.model.id), metadata: { ...(route.metadata ?? { classificationStatus: 'deterministic', reasoningGate: { initialModelId: route.selected.model.id, selectedModelId: route.selected.model.id, promoted: false } }), execution: { plannedModelId: route.selected.model.id, servedModelId: selected.model.id, fallbackIndex: finished.index } } };
  }

  private withExecutionRoute(result: ResponseResult, planned: RouteDecision, record: DecisionRecord): ResponseResult {
    return { ...result, route: this.routeWithExecution(planned, record) };
  }

  private scheduleShadow(request: ResponseRequest, result: ResponseResult): void {
    if (!this.shadows) return;
    setImmediate(() => { try { this.shadows?.enqueue(request, result); } catch { this.metrics?.increment?.('shadow_execution_failure'); } });
  }
}

function lastCompletedAttempt(attempts: readonly DecisionAttempt[]): DecisionAttempt | undefined {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const attempt = attempts[index];
    if (attempt?.status === 'completed') return attempt;
  }
  return undefined;
}
