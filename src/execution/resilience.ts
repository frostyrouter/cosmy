import type { ModelConfiguration, ResponseChunk } from '../domain/types.js';
import { ProviderError, RequestCancelledError } from '../domain/errors.js';
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
  constructor(private readonly threshold: number, private readonly cooldownMs: number) {}

  before(): void {
    if (this.openedAt > 0 && Date.now() - this.openedAt < this.cooldownMs) throw new ProviderError('Provider circuit is open', false);
    if (this.openedAt > 0) { this.openedAt = 0; this.failures = 0; }
  }
  success(): void { this.failures = 0; this.openedAt = 0; }
  failure(): void { this.failures += 1; if (this.failures >= this.threshold) this.openedAt = Date.now(); }
}

function retryable(error: unknown): boolean { return error instanceof ProviderError ? error.retryable : true; }

function attemptSignal(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cancel = () => { clearTimeout(timer); controller.abort(); parent.removeEventListener('abort', cancel); };
  if (parent.aborted) cancel();
  else parent.addEventListener('abort', cancel, { once: true });
  return { signal: controller.signal, cancel };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new RequestCancelledError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(new RequestCancelledError()); }, { once: true });
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
        this.breaker.failure();
        if (input.signal.aborted) throw new RequestCancelledError();
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
          emitted = emitted || chunk.delta.length > 0;
          yield chunk;
        }
        this.breaker.success();
        current.cancel();
        return;
      } catch (error) {
        current.cancel();
        lastError = error;
        this.breaker.failure();
        if (input.signal.aborted) throw new RequestCancelledError();
        if (emitted || !retryable(error) || attempt === this.options.maxRetries) throw error;
        await wait(this.options.baseDelayMs ?? 100 * (2 ** attempt), input.signal);
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError('Provider stream failed');
  }
}

export function resilientProviders(providers: readonly ProviderAdapter[], options: ResilienceOptions): ProviderAdapter[] {
  return providers.map((provider) => new ResilientProvider(provider, options));
}
