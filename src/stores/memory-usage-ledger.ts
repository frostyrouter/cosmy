import type { BudgetAdministration, BudgetSnapshot, UsageLedger } from '../ports/stores.js';
import type { UsageReservation } from '../ports/stores.js';
import { RouterError } from '../domain/errors.js';
import { randomUUID } from 'node:crypto';

export class InMemoryUsageLedger implements UsageLedger, BudgetAdministration {
  private reserved = new Map<string, number>();
  private spent = new Map<string, number>();
  private active = new Map<string, UsageReservation>();

  constructor(private readonly limits: Record<string, number> = {}) {}

  async reserve(input: { tenantId: string; estimatedCostUsd: number }): Promise<UsageReservation> {
    const limit = this.limits[input.tenantId] ?? this.limits['*'];
    const current = this.reserved.get(input.tenantId) ?? 0;
    if (limit !== undefined && current + input.estimatedCostUsd > limit) {
      throw new RouterError('Tenant budget would be exceeded', 'budget_exceeded', 429, false);
    }
    const reservation = { id: `res_${randomUUID()}`, ...input };
    this.reserved.set(input.tenantId, current + input.estimatedCostUsd);
    this.active.set(reservation.id, reservation);
    return reservation;
  }

  async reconcile(reservation: UsageReservation, actualCostUsd: number): Promise<void> {
    const active = this.active.get(reservation.id);
    if (!active) return;
    this.active.delete(reservation.id);
    this.reserved.set(active.tenantId, Math.max(0, (this.reserved.get(active.tenantId) ?? 0) - active.estimatedCostUsd));
    this.spent.set(active.tenantId, (this.spent.get(active.tenantId) ?? 0) + Math.max(0, actualCostUsd));
  }

  spentFor(tenantId: string): number { return this.spent.get(tenantId) ?? 0; }
  reservedFor(tenantId: string): number { return this.reserved.get(tenantId) ?? 0; }

  async budgetFor(tenantId: string): Promise<BudgetSnapshot> {
    const limitUsd = this.limits[tenantId] ?? this.limits['*'];
    return { tenantId, ...(limitUsd !== undefined ? { limitUsd } : {}), reservedUsd: this.reservedFor(tenantId), spentUsd: this.spentFor(tenantId) };
  }

  async setBudget(tenantId: string, limitUsd: number): Promise<BudgetSnapshot> {
    if (!Number.isFinite(limitUsd) || limitUsd < 0) throw new Error('Budget limit must be a non-negative number');
    if (limitUsd < this.reservedFor(tenantId) + this.spentFor(tenantId)) {
      throw new RouterError('Budget limit cannot be lower than current usage', 'budget_below_usage', 409, false);
    }
    this.limits[tenantId] = limitUsd;
    return this.budgetFor(tenantId);
  }
}
