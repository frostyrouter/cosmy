import type { ModelConfiguration, ResponseChunk } from '../domain/types.js';
import { ProviderError, ProviderSaturatedError, RequestCancelledError } from '../domain/errors.js';
import type { MetricsSink } from '../observability/metrics.js';
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from '../ports/provider.js';

export interface ResilienceOptions {
  maxRetries: number;
  timeoutMs: number;
  failureThreshold?: number;
  cooldownMs?: number;
  baseDelayMs?: number;
}

class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private probeInFlight = false;
  constructor(private readonly threshold: number, private readonly cooldownMs: number) {}

  before(): void {
    if (this.openedAt > 0 && Date.now() - this.openedAt < this.cooldownMs) throw new ProviderError('Provider circuit is open', true);
    if (this.openedAt > 0) {
      if (this.probeInFlight) throw new ProviderError('Provider circuit is half-open', true);
      this.probeInFlight = true;
    }
  }
  success(): void { this.failures = 0; this.openedAt = 0; this.probeInFlight = false; }
  failure(): void {
    this.failures += 1;
    if (this.probeInFlight || this.failures >= this.threshold) this.openedAt = Date.now();
    this.probeInFlight = false;
  }
  cancelled(): void { this.probeInFlight = false; }
}

function retryable(error: unknown): boolean { return error instanceof ProviderError ? error.retryable : true; }

function attemptSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; cancel: () => void; disarm: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const disarm = () => clearTimeout(timer);
  const cancel = () => { disarm(); controller.abort(); parent.removeEventListener('abort', cancel); };
  if (parent.aborted) cancel();
  else parent.addEventListener('abort', cancel, { once: true });
  return { signal: controller.signal, cancel, disarm };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new RequestCancelledError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new RequestCancelledError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class ResilientProvider implements ProviderAdapter {
  private readonly breaker: CircuitBreaker;
  constructor(private readonly inner: ProviderAdapter, private readonly options: ResilienceOptions) {
    this.breaker = new CircuitBreaker(options.failureThreshold ?? 3, options.cooldownMs ?? 30_000);
  }
  get name(): string { return this.inner.name; }
  listModels(): readonly ModelConfiguration[] { return this.inner.listModels(); }

  async complete(input: ProviderRequest): Promise<ProviderResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      this.breaker.before();
      const current = attemptSignal(input.signal, this.options.timeoutMs);
      try {
        const response = await this.inner.complete({ ...input, signal: current.signal });
        this.breaker.success();
        current.cancel();
        return response;
      } catch (error) {
        current.cancel();
        lastError = error;
        if (input.signal.aborted) { this.breaker.cancelled(); throw new RequestCancelledError(); }
        if (retryable(error)) this.breaker.failure();
        else this.breaker.success();
        if (!retryable(error) || attempt === this.options.maxRetries) throw error;
        await wait(this.options.baseDelayMs ?? 100 * (2 ** attempt), input.signal);
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError('Provider request failed');
  }

  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      this.breaker.before();
      const current = attemptSignal(input.signal, this.options.timeoutMs);
      let emitted = false;
      try {
        for await (const chunk of this.inner.stream({ ...input, signal: current.signal })) {
          if (!emitted) current.disarm();
          emitted = emitted || chunk.delta.length > 0;
          yield chunk;
        }
        this.breaker.success();
        current.cancel();
        return;
      } catch (error) {
        current.cancel();
        lastError = error;
        if (input.signal.aborted) { this.breaker.cancelled(); throw new RequestCancelledError(); }
        if (retryable(error)) this.breaker.failure();
        else this.breaker.success();
        if (emitted || !retryable(error) || attempt === this.options.maxRetries) throw error;
        await wait(this.options.baseDelayMs ?? 100 * (2 ** attempt), input.signal);
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError('Provider stream failed');
  }
}

export class BulkheadProvider implements ProviderAdapter {
  private active = 0;
  constructor(private readonly inner: ProviderAdapter, private readonly maximumConcurrency: number, private readonly metrics?: MetricsSink) {
    if (!Number.isInteger(maximumConcurrency) || maximumConcurrency <= 0) throw new Error('Provider maximum concurrency must be a positive integer');
  }
  get name(): string { return this.inner.name; }
  listModels(): readonly ModelConfiguration[] { return this.inner.listModels(); }
  async complete(input: ProviderRequest): Promise<ProviderResponse> {
    this.acquire();
    try { return await this.inner.complete(input); } finally { this.release(); }
  }
  async *stream(input: ProviderRequest): AsyncIterable<ResponseChunk> {
    this.acquire();
    try { for await (const chunk of this.inner.stream(input)) yield chunk; } finally { this.release(); }
  }
  private acquire(): void {
    if (this.active >= this.maximumConcurrency) {
      this.metrics?.increment?.('provider_saturated');
      throw new ProviderSaturatedError();
    }
    this.active += 1;
  }
  private release(): void { this.active = Math.max(0, this.active - 1); }
}

export function resilientProviders(providers: readonly ProviderAdapter[], options: ResilienceOptions): ProviderAdapter[] {
  return providers.map((provider) => new ResilientProvider(provider, options));
}

export function bulkheadProviders(providers: readonly ProviderAdapter[], maximumConcurrency: number, metrics?: MetricsSink): ProviderAdapter[] {
  return providers.map((provider) => new BulkheadProvider(provider, maximumConcurrency, metrics));
}
