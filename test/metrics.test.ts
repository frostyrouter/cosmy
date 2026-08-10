import { describe, expect, it } from 'vitest';
import { InMemoryMetrics } from '../src/observability/metrics.js';

describe('in-memory metrics', () => {
  it('keeps latency count, total, and percentiles on the same bounded window', () => {
    const metrics = new InMemoryMetrics();
    for (let index = 0; index < 2_048; index += 1) {
      metrics.record({ requestId: `initial-${index}`, model: 'sim', provider: 'simulator', status: 'success', latencyMs: 1, fallbackIndex: 0 });
    }
    metrics.record({ requestId: 'replacement', model: 'sim', provider: 'simulator', status: 'success', latencyMs: 101, fallbackIndex: 0 });

    const latency = metrics.snapshot().latencyMs;
    expect(latency.count).toBe(2_048);
    expect(latency.total).toBe(2_148);
    expect(latency.p95).toBe(1);
  });

  it('renders escaped Prometheus metrics with bounded provider cardinality', () => {
    const metrics = new InMemoryMetrics();
    for (let index = 0; index < 600; index += 1) {
      metrics.record({ requestId: `request-${index}`, model: `model-${index}\n\"`, provider: `provider-${index}`, status: 'success', latencyMs: index, fallbackIndex: 0, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCostUsd: 0.001 } });
    }
    metrics.increment('reconciliation_failure');
    metrics.streamOpened();
    const output = metrics.renderPrometheus();
    expect(output).toContain('cosmy_metrics_provider_series 512');
    expect(output).toContain('provider="_other",model="_other"');
    expect(output).toContain('event="reconciliation_failure"} 1');
    expect(output).toContain('cosmy_active_streams 1');
    expect(output).not.toContain('\n\"');
    metrics.streamClosed();
    expect(metrics.snapshot().activeStreams).toBe(0);
  });
});
