import { performance } from 'node:perf_hooks';
import type { ProviderAdapter } from '../ports/provider.js';
import type { HealthStore, UsageLedger, UsageReservation } from '../ports/stores.js';
import type { DecisionAttempt, ModelConfiguration, ResponseChunk, ResponseRequest, ResponseResult, RouteDecision } from '../domain/types.js';
import { InvalidRequestError, OutputValidationError, ProviderError, RequestCancelledError, RouterError } from '../domain/errors.js';
import type { MetricsSink } from '../observability/metrics.js';
import type { RolloutOutcomeRecorder } from '../rollouts/rollout.js';
import { unsupportedSchemaKeywords, validateStructuredOutput } from './structured-output.js';

export interface ExecutionOptions {
  requestId: string;
  route: RouteDecision;
  request: ResponseRequest;
  signal: AbortSignal;
  onAttempt?: (attempt: DecisionAttempt) => void;
}

export class RequestExecutor {
  private readonly providerByName: Map<string, ProviderAdapter>;

  constructor(
    private readonly providers: readonly ProviderAdapter[],
    private readonly usage: UsageLedger,
    private readonly health: HealthStore,
    private readonly metrics?: MetricsSink,
    private readonly requestTimeoutMs?: number,
    private readonly reservationHeartbeatMs = 30_000,
    private readonly rolloutOutcomes?: RolloutOutcomeRecorder,
  ) {
    this.providerByName = new Map(providers.map((provider) => [provider.name, provider]));
  }

  private providerFor(model: ModelConfiguration): ProviderAdapter {
    const provider = this.providerByName.get(model.provider);
    if (!provider) throw new ProviderError(`Provider '${model.provider}' is not configured`, false);
    return provider;
  }

  async execute(options: ExecutionOptions): Promise<ResponseResult> {
    const { request, route, requestId, signal, onAttempt } = options;
    const responseSchema = request.responseFormat?.type === 'json-schema' ? request.responseFormat.schema ?? { type: 'object' } : undefined;
    if (responseSchema) {
      const unsupported = unsupportedSchemaKeywords(responseSchema);
      if (unsupported.length) throw new InvalidRequestError(`Unsupported response schema: ${unsupported[0]}`);
    }
    const deadline = this.requestTimeoutMs !== undefined ? abortAfter(signal, this.requestTimeoutMs) : undefined;
    const effective = deadline?.signal ?? signal;
    try {
      if (effective.aborted) throw new RequestCancelledError();
      if (route.alternatives.length === 0) return await this.executeCandidate({ requestId, route, request, signal: effective, fallbackIndex: 0, ...(onAttempt ? { onAttempt } : {}) });
      const candidates = [route.selected, ...route.alternatives];
      let lastError: unknown;
      let validationCostUsd = 0;
      for (const [fallbackIndex, candidate] of candidates.entries()) {
        if (fallbackIndex > 0 && request.policy?.maxCostUsd !== undefined && validationCostUsd + candidate.estimatedCostUsd > request.policy.maxCostUsd) {
          throw lastError instanceof Error ? lastError : new OutputValidationError('Structured output validation failed within the request cost ceiling', validationCostUsd, []);
        }
        const attemptRoute = { ...route, selected: candidate, alternatives: candidates.slice(fallbackIndex + 1) };
        try {
          return await this.executeCandidate({ requestId, route: attemptRoute, request, signal: effective, fallbackIndex, ...(onAttempt ? { onAttempt } : {}) });
        } catch (error) {
          lastError = error;
          if (error instanceof OutputValidationError) validationCostUsd += error.actualCostUsd;
          const canFallback = (error instanceof ProviderError && error.retryable) || error instanceof OutputValidationError;
          if (request.policy?.allowFallback === false || !canFallback || fallbackIndex === candidates.length - 1) throw error;
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
    this.metrics?.streamOpened?.();
    try {
      const { request, route, requestId, signal, onAttempt } = options;
      if (request.responseFormat?.type === 'json-schema') {
        const unsupported = unsupportedSchemaKeywords(request.responseFormat.schema ?? { type: 'object' });
        if (unsupported.length) throw new InvalidRequestError(`Unsupported response schema: ${unsupported[0]}`);
      }
      if (signal.aborted) throw new RequestCancelledError();
      if (route.alternatives.length === 0) {
        for await (const chunk of this.streamCandidate({ requestId, route, request, signal, fallbackIndex: 0, ...(onAttempt ? { onAttempt } : {}) })) yield chunk;
        return;
      }
      const candidates = [route.selected, ...route.alternatives];
      for (const [fallbackIndex, candidate] of candidates.entries()) {
        const attemptRoute = { ...route, selected: candidate, alternatives: candidates.slice(fallbackIndex + 1) };
        let emitted = false;
        try {
          for await (const chunk of this.streamCandidate({ requestId, route: attemptRoute, request, signal, fallbackIndex, ...(onAttempt ? { onAttempt } : {}) })) {
            emitted = emitted || !chunk.done;
            yield chunk;
          }
          return;
        } catch (error) {
          if (request.policy?.allowFallback === false || emitted || !(error instanceof ProviderError) || !error.retryable || fallbackIndex === candidates.length - 1) throw error;
        }
      }
    } finally { this.metrics?.streamClosed?.(); }
  }

  private async reconcileBestEffort(reservation: UsageReservation, actualCostUsd: number): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.usage.reconcile(reservation, actualCostUsd);
        return true;
      } catch {
        // transient store failure; retry once, then best-effort release
      }
    }
    this.metrics?.increment?.('reconciliation_failure');
    return false;
  }

  private async executeCandidate(options: ExecutionOptions & { fallbackIndex: number }): Promise<ResponseResult> {
    const { request, route, requestId, signal, fallbackIndex } = options;
    const provider = this.providerFor(route.selected.model);
    const tenantId = request.policy?.tenantId ?? 'default';
    const reservation = await this.usage.reserve({ tenantId, estimatedCostUsd: route.selected.estimatedCostUsd });
    const started = performance.now();
    const startedAt = new Date().toISOString();
    try {
      const response = await provider.complete({ request: { ...request, requestId }, model: route.selected.model, signal });
      const latencyMs = performance.now() - started;
      this.health.markSuccess(route.selected.model.id, latencyMs);
      await this.reconcileBestEffort(reservation, response.usage.estimatedCostUsd);
      if (request.responseFormat?.type === 'json-schema') {
        const issues = validateStructuredOutput(response.output, request.responseFormat.schema ?? { type: 'object' });
        if (issues.length) {
          this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: 'error', latencyMs, usage: response.usage, fallbackIndex });
          await this.recordRolloutOutcome(route.selected.model, 'error', latencyMs);
          notifyAttempt(options, startedAt, latencyMs, 'failed', response.usage, 'output_validation_failed');
          throw new OutputValidationError('Provider output did not satisfy the requested JSON schema', response.usage.estimatedCostUsd, issues);
        }
      }
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: 'success', latencyMs, usage: response.usage, fallbackIndex });
      await this.recordRolloutOutcome(route.selected.model, 'success', latencyMs);
      notifyAttempt(options, startedAt, latencyMs, 'completed', response.usage);
      return { requestId, model: route.selected.model.model, provider: provider.name, output: response.output, ...(response.toolCalls?.length ? { toolCalls: response.toolCalls } : {}), usage: response.usage, status: 'completed', finishReason: response.finishReason, route };
    } catch (error) {
      if (error instanceof OutputValidationError) throw error;
      const latencyMs = performance.now() - started;
      if (!(error instanceof RequestCancelledError)) this.health.markFailure(route.selected.model.id);
      await this.reconcileBestEffort(reservation, 0);
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: error instanceof RequestCancelledError ? 'cancelled' : 'error', latencyMs, fallbackIndex });
      await this.recordRolloutOutcome(route.selected.model, error instanceof RequestCancelledError ? 'cancelled' : 'error', latencyMs);
      notifyAttempt(options, startedAt, latencyMs, error instanceof RequestCancelledError ? 'cancelled' : 'failed', undefined, attemptErrorCode(error));
      throw error;
    }
  }

  private async *streamCandidate(options: ExecutionOptions & { fallbackIndex: number }): AsyncIterable<ResponseChunk> {
    const { request, route, requestId, signal, fallbackIndex } = options;
    const provider = this.providerFor(route.selected.model);
    const tenantId = request.policy?.tenantId ?? 'default';
    const reservation = await this.usage.reserve({ tenantId, estimatedCostUsd: route.selected.estimatedCostUsd });
    const started = performance.now();
    const startedAt = new Date().toISOString();
    let actualCostUsd = 0;
    let completed = false;
    let routeAnnounced = false;
    const leaseController = new AbortController();
    const onRequestAbort = () => leaseController.abort();
    if (signal.aborted) leaseController.abort();
    else signal.addEventListener('abort', onRequestAbort, { once: true });
    let heartbeatError: RouterError | undefined;
    let heartbeatRunning = false;
    let closed = false;
    const heartbeat = this.usage.heartbeat
      ? setInterval(() => {
          if (heartbeatRunning || closed) return;
          heartbeatRunning = true;
          void this.renewLease(reservation).catch(() => {
            if (!closed) {
              heartbeatError = new RouterError('Unable to renew the active reservation lease', 'reservation_heartbeat_failed', 503, true);
              leaseController.abort();
            }
          }).finally(() => { heartbeatRunning = false; });
        }, this.reservationHeartbeatMs)
      : undefined;
    heartbeat?.unref();
    try {
      for await (const chunk of provider.stream({ request: { ...request, requestId }, model: route.selected.model, signal: leaseController.signal })) {
        if (heartbeatError) throw heartbeatError;
        yield { ...chunk, requestId, ...(!routeAnnounced ? { route } : {}) };
        routeAnnounced = true;
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
          await this.recordRolloutOutcome(route.selected.model, 'success', latencyMs);
          notifyAttempt(options, startedAt, latencyMs, 'completed', chunk.usage);
          break;
        }
      }
      if (heartbeatError) throw heartbeatError;
      if (!completed) throw new ProviderError('Provider stream ended without a terminal event', true);
    } catch (error) {
      const executionError = heartbeatError ?? error;
      if (!heartbeatError && !(error instanceof RequestCancelledError)) this.health.markFailure(route.selected.model.id);
      this.metrics?.record({ requestId, model: route.selected.model.model, provider: provider.name, status: executionError instanceof RequestCancelledError ? 'cancelled' : 'error', latencyMs: performance.now() - started, fallbackIndex });
      const latencyMs = performance.now() - started;
      await this.recordRolloutOutcome(route.selected.model, executionError instanceof RequestCancelledError ? 'cancelled' : 'error', latencyMs);
      notifyAttempt(options, startedAt, latencyMs, executionError instanceof RequestCancelledError ? 'cancelled' : 'failed', undefined, attemptErrorCode(executionError));
      throw executionError;
    } finally {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      signal.removeEventListener('abort', onRequestAbort);
      await this.reconcileBestEffort(reservation, heartbeatError ? reservation.estimatedCostUsd : completed ? actualCostUsd : 0);
    }
  }

  private async renewLease(reservation: UsageReservation): Promise<void> {
    const renew = this.usage.heartbeat?.bind(this.usage);
    if (!renew) return;
    let failure: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await settleWithin(renew(reservation), 5_000);
        return;
      } catch (error) { failure = error; }
    }
    throw failure;
  }

  private async recordRolloutOutcome(model: ModelConfiguration, status: 'success' | 'error' | 'cancelled', latencyMs: number): Promise<void> {
    if (!this.rolloutOutcomes) return;
    try { await settleWithin(this.rolloutOutcomes.recordOutcome({ modelId: model.id, modelVersion: model.version, status, latencyMs }), 100); } catch { this.metrics?.increment?.('rollout_observation_failure'); }
  }
}

function attemptErrorCode(error: unknown): string {
  if (error instanceof RouterError) return error.code;
  return 'internal_error';
}

function notifyAttempt(options: ExecutionOptions & { fallbackIndex: number }, startedAt: string, latencyMs: number, status: DecisionAttempt['status'], usage?: DecisionAttempt['usage'], errorCode?: string): void {
  const completedAt = new Date().toISOString();
  const attempt: DecisionAttempt = {
    index: options.fallbackIndex,
    modelId: options.route.selected.model.id,
    model: options.route.selected.model.model,
    provider: options.route.selected.model.provider,
    status,
    latencyMs,
    startedAt,
    completedAt,
    ...(errorCode ? { errorCode } : {}),
    ...(usage ? { usage } : {}),
  };
  try { options.onAttempt?.(attempt); } catch { /* Audit observation must not alter execution. */ }
}

async function settleWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Operation timed out')), timeoutMs);
    timer.unref();
  });
  try { return await Promise.race([operation, timeout]); } finally { if (timer) clearTimeout(timer); }
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
