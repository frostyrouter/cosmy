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
  private readonly values: RequestMetric[] = [];

  record(metric: RequestMetric): void { this.values.push(metric); }

  snapshot(): MetricsSnapshot {
    const latencies = this.values.map((metric) => metric.latencyMs).sort((a, b) => a - b);
    const usage = this.values.reduce((total, metric) => ({ input: total.input + (metric.usage?.inputTokens ?? 0), output: total.output + (metric.usage?.outputTokens ?? 0), cost: total.cost + (metric.usage?.estimatedCostUsd ?? 0) }), { input: 0, output: 0, cost: 0 });
    return {
      requests: this.values.length,
      successes: this.values.filter((metric) => metric.status === 'success').length,
      errors: this.values.filter((metric) => metric.status === 'error').length,
      cancellations: this.values.filter((metric) => metric.status === 'cancelled').length,
      fallbacks: this.values.filter((metric) => metric.fallbackIndex > 0).length,
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalCostUsd: usage.cost,
      latencyMs: { count: latencies.length, total: latencies.reduce((sum, value) => sum + value, 0), p95: latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]! : 0 },
    };
  }
}
