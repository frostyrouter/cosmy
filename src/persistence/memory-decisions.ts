import type { DecisionRecord } from '../domain/types.js';
import type { DecisionStore } from './contracts.js';

export class InMemoryDecisionStore implements DecisionStore {
  private readonly records = new Map<string, DecisionRecord>();

  constructor(private readonly capacity = 10_000) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('Decision-store capacity must be a positive integer');
  }

  async save(record: DecisionRecord): Promise<void> {
    const key = this.key(record.tenantId, record.id);
    this.records.delete(key);
    this.records.set(key, structuredClone(record));
    while (this.records.size > this.capacity) this.records.delete(this.records.keys().next().value as string);
  }

  async get(tenantId: string, decisionId: string): Promise<DecisionRecord | undefined> {
    const record = this.records.get(this.key(tenantId, decisionId));
    return record ? structuredClone(record) : undefined;
  }

  private key(tenantId: string, decisionId: string): string { return `${tenantId}\0${decisionId}`; }
}
