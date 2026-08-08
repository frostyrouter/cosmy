import type { UsageLedger } from '../ports/stores.js';
import type { Usage } from '../domain/types.js';
import { RouterError } from '../domain/errors.js';

export class InMemoryUsageLedger implements UsageLedger {
  private reserved = new Map<string, number>();
  private spent = new Map<string, number>();

  constructor(private readonly limits: Record<string, number> = {}) {}

  async reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<void> {
    const limit = this.limits[input.tenantId];
    const current = this.reserved.get(input.tenantId) ?? 0;
    if (limit !== undefined && current + input.estimatedCostUsd > limit) {
      throw new RouterError('Tenant budget would be exceeded', 'budget_exceeded', 429, false);
    }
    this.reserved.set(input.tenantId, current + input.estimatedCostUsd);
  }

  async record(input: { tenantId: string; usage: Usage }): Promise<void> {
    this.spent.set(input.tenantId, (this.spent.get(input.tenantId) ?? 0) + input.usage.estimatedCostUsd);
  }

  spentFor(tenantId: string): number { return this.spent.get(tenantId) ?? 0; }
}
