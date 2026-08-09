import type { Usage } from '../domain/types.js';

export interface RequestMetric {
  requestId: string;
  model: string;
  provider: string;
  status: 'success' | 'error' | 'cancelled';
  latencyMs: number;
  usage?: Usage;
  fallbackIndex: number;
}

export interface MetricsSink {
  record(metric: RequestMetric): void;
  snapshot(): MetricsSnapshot;
}

export interface MetricsSnapshot {
  requests: number;
  successes: number;
  errors: number;
  cancellations: number;
  fallbacks: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  latencyMs: { count: number; total: number; p95: number };
}

export class InMemoryMetrics implements MetricsSink {
  private requests = 0;
  private successes = 0;
  private errors = 0;
  private cancellations = 0;
  private fallbacks = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalCostUsd = 0;
  private latencyTotalMs = 0;
  private readonly latencies: number[] = new Array(2_048);
  private latencyCount = 0;
  private latencyIndex = 0;

  record(metric: RequestMetric): void {
    this.requests += 1;
    if (metric.status === 'success') this.successes += 1;
    else if (metric.status === 'cancelled') this.cancellations += 1;
    else this.errors += 1;
    if (metric.fallbackIndex === 1) this.fallbacks += 1;
    if (metric.usage) {
      this.inputTokens += metric.usage.inputTokens;
      this.outputTokens += metric.usage.outputTokens;
      this.totalCostUsd += metric.usage.estimatedCostUsd;
    }
    if (this.latencyCount === this.latencies.length) {
      this.latencyTotalMs -= this.latencies[this.latencyIndex]!;
    }
    this.latencyTotalMs += metric.latencyMs;
    this.latencies[this.latencyIndex] = metric.latencyMs;
    this.latencyIndex = (this.latencyIndex + 1) % this.latencies.length;
    this.latencyCount = Math.min(this.latencyCount + 1, this.latencies.length);
  }

  snapshot(): MetricsSnapshot {
    const count = this.latencyCount;
    const buffered = this.latencies.slice(0, count).sort((a, b) => a - b);
    return {
      requests: this.requests,
      successes: this.successes,
      errors: this.errors,
      cancellations: this.cancellations,
      fallbacks: this.fallbacks,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalCostUsd: this.totalCostUsd,
      latencyMs: {
        count,
        total: this.latencyTotalMs,
        p95: count ? buffered[Math.min(count - 1, Math.ceil(count * 0.95) - 1)]! : 0,
      },
    };
  }
}
