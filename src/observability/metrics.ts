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

export type OperationalMetric = 'cache_hit' | 'cache_failure' | 'idempotency_store_failure' | 'reconciliation_failure' | 'registry_refresh_failure' | 'reservation_recovered' | 'rollout_observation_failure' | 'rollout_auto_rollback';

export interface MetricsSink {
  record(metric: RequestMetric): void;
  increment?(metric: OperationalMetric, amount?: number): void;
  streamOpened?(): void;
  streamClosed?(): void;
  snapshot(): MetricsSnapshot;
  renderPrometheus?(): string;
}

export interface MetricsSnapshot {
  requests: number;
  successes: number;
  errors: number;
  cancellations: number;
  fallbacks: number;
  activeStreams: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  operational: Record<OperationalMetric, number>;
  latencyMs: { count: number; total: number; p95: number };
}

interface ProviderSeries {
  provider: string;
  model: string;
  requests: number;
  successes: number;
  errors: number;
  cancellations: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyCount: number;
  latencyTotalMs: number;
}

const MAX_PROVIDER_SERIES = 512;
const operationalNames: readonly OperationalMetric[] = ['cache_hit', 'cache_failure', 'idempotency_store_failure', 'reconciliation_failure', 'registry_refresh_failure', 'reservation_recovered', 'rollout_observation_failure', 'rollout_auto_rollback'];

export class InMemoryMetrics implements MetricsSink {
  private requests = 0;
  private successes = 0;
  private errors = 0;
  private cancellations = 0;
  private fallbacks = 0;
  private activeStreams = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalCostUsd = 0;
  private latencyTotalMs = 0;
  private readonly latencies: number[] = new Array(2_048);
  private latencyCount = 0;
  private latencyIndex = 0;
  private readonly providerSeries = new Map<string, ProviderSeries>();
  private readonly operational = Object.fromEntries(operationalNames.map((name) => [name, 0])) as Record<OperationalMetric, number>;

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
    if (this.latencyCount === this.latencies.length) this.latencyTotalMs -= this.latencies[this.latencyIndex]!;
    this.latencyTotalMs += metric.latencyMs;
    this.latencies[this.latencyIndex] = metric.latencyMs;
    this.latencyIndex = (this.latencyIndex + 1) % this.latencies.length;
    this.latencyCount = Math.min(this.latencyCount + 1, this.latencies.length);
    const series = this.seriesFor(metric.provider, metric.model);
    series.requests += 1;
    if (metric.status === 'success') series.successes += 1;
    else if (metric.status === 'cancelled') series.cancellations += 1;
    else series.errors += 1;
    series.latencyCount += 1;
    series.latencyTotalMs += metric.latencyMs;
    if (metric.usage) {
      series.inputTokens += metric.usage.inputTokens;
      series.outputTokens += metric.usage.outputTokens;
      series.costUsd += metric.usage.estimatedCostUsd;
    }
  }

  increment(metric: OperationalMetric, amount = 1): void {
    if (Number.isFinite(amount) && amount > 0) this.operational[metric] += amount;
  }
  streamOpened(): void { this.activeStreams += 1; }
  streamClosed(): void { this.activeStreams = Math.max(0, this.activeStreams - 1); }

  snapshot(): MetricsSnapshot {
    const count = this.latencyCount;
    const buffered = this.latencies.slice(0, count).sort((a, b) => a - b);
    return {
      requests: this.requests, successes: this.successes, errors: this.errors, cancellations: this.cancellations, fallbacks: this.fallbacks,
      activeStreams: this.activeStreams, inputTokens: this.inputTokens, outputTokens: this.outputTokens, totalCostUsd: this.totalCostUsd,
      operational: { ...this.operational },
      latencyMs: { count, total: this.latencyTotalMs, p95: count ? buffered[Math.min(count - 1, Math.ceil(count * 0.95) - 1)]! : 0 },
    };
  }

  renderPrometheus(): string {
    const snapshot = this.snapshot();
    const lines = [
      '# HELP cosmy_provider_attempts_total Provider execution attempts.', '# TYPE cosmy_provider_attempts_total counter',
      '# TYPE cosmy_provider_latency_ms summary',
      '# TYPE cosmy_provider_input_tokens_total counter',
      '# TYPE cosmy_provider_output_tokens_total counter',
      '# TYPE cosmy_provider_cost_usd_total counter',
    ];
    for (const series of [...this.providerSeries.values()].sort((left, right) => `${left.provider}\0${left.model}`.localeCompare(`${right.provider}\0${right.model}`))) {
      const labels = `provider="${escapeLabel(series.provider)}",model="${escapeLabel(series.model)}"`;
      lines.push(`cosmy_provider_attempts_total{${labels},status="success"} ${series.successes}`);
      lines.push(`cosmy_provider_attempts_total{${labels},status="error"} ${series.errors}`);
      lines.push(`cosmy_provider_attempts_total{${labels},status="cancelled"} ${series.cancellations}`);
      lines.push(`cosmy_provider_latency_ms_count{${labels}} ${series.latencyCount}`);
      lines.push(`cosmy_provider_latency_ms_sum{${labels}} ${series.latencyTotalMs}`);
      lines.push(`cosmy_provider_input_tokens_total{${labels}} ${series.inputTokens}`);
      lines.push(`cosmy_provider_output_tokens_total{${labels}} ${series.outputTokens}`);
      lines.push(`cosmy_provider_cost_usd_total{${labels}} ${series.costUsd}`);
    }
    lines.push('# TYPE cosmy_fallbacks_total counter', `cosmy_fallbacks_total ${snapshot.fallbacks}`);
    lines.push('# TYPE cosmy_active_streams gauge', `cosmy_active_streams ${snapshot.activeStreams}`);
    lines.push('# TYPE cosmy_latency_p95_ms gauge', `cosmy_latency_p95_ms ${snapshot.latencyMs.p95}`);
    lines.push('# TYPE cosmy_operational_events_total counter');
    for (const name of operationalNames) lines.push(`cosmy_operational_events_total{event="${name}"} ${snapshot.operational[name]}`);
    lines.push('# TYPE cosmy_metrics_provider_series gauge', `cosmy_metrics_provider_series ${this.providerSeries.size}`);
    return `${lines.join('\n')}\n`;
  }

  private seriesFor(provider: string, model: string): ProviderSeries {
    let key = `${provider}\0${model}`;
    let existing = this.providerSeries.get(key);
    if (existing) return existing;
    if (this.providerSeries.size >= MAX_PROVIDER_SERIES - 1) {
      key = '_other\0_other';
      existing = this.providerSeries.get(key);
      if (existing) return existing;
      provider = '_other'; model = '_other';
    }
    const created: ProviderSeries = { provider, model, requests: 0, successes: 0, errors: 0, cancellations: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyCount: 0, latencyTotalMs: 0 };
    this.providerSeries.set(key, created);
    return created;
  }
}

function escapeLabel(value: string): string { return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"'); }
