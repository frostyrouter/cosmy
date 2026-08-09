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
});
