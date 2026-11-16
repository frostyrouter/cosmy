import { RouterSaturatedError } from '../domain/errors.js';
import type { MetricsSink } from '../observability/metrics.js';

export class ResponseAdmission {
  private active = 0;
  constructor(private readonly maximumConcurrency: number, private readonly metrics?: MetricsSink) {
    if (!Number.isInteger(maximumConcurrency) || maximumConcurrency <= 0) throw new Error('Maximum in-flight responses must be a positive integer');
  }

  acquire(): () => void {
    if (this.active >= this.maximumConcurrency) {
      this.metrics?.increment?.('router_saturated');
      throw new RouterSaturatedError();
    }
    this.active += 1;
    this.metrics?.responseOpened?.();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      this.metrics?.responseClosed?.();
    };
  }
}
