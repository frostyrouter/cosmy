import { createHash } from 'node:crypto';
import type { ModelConfiguration } from '../domain/types.js';

export type RolloutState = 'canary' | 'active' | 'rolled_back';

export interface ModelRollout {
  id: string;
  modelId: string;
  modelVersion: string;
  state: RolloutState;
  trafficPercentage: number;
  minimumSamples: number;
  maximumErrorRate: number;
  maximumAverageLatencyMs: number;
  sampleCount: number;
  errorCount: number;
  totalLatencyMs: number;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RolloutOutcome { modelId: string; modelVersion: string; status: 'success' | 'error' | 'cancelled'; latencyMs: number; }

export interface RolloutOutcomeRecorder { recordOutcome(outcome: RolloutOutcome): Promise<void>; }

export class InMemoryRolloutRegistry {
  private byModel = new Map<string, ModelRollout>();

  load(rollouts: readonly ModelRollout[]): void {
    this.byModel = new Map(rollouts.map((rollout) => [rollout.modelId, structuredClone(rollout)]));
  }

  upsert(rollout: ModelRollout): void { this.byModel.set(rollout.modelId, structuredClone(rollout)); }

  get(modelId: string): ModelRollout | undefined {
    const rollout = this.byModel.get(modelId);
    return rollout ? structuredClone(rollout) : undefined;
  }

  allows(model: ModelConfiguration, tenantId = 'anonymous'): boolean {
    const rollout = this.byModel.get(model.id);
    if (!rollout || rollout.modelVersion !== model.version || rollout.state === 'active') return true;
    if (rollout.state === 'rolled_back') return false;
    return stableBucket(`${rollout.id}\0${tenantId}`) < rollout.trafficPercentage;
  }

  snapshot(): readonly ModelRollout[] { return [...this.byModel.values()].map((rollout) => structuredClone(rollout)); }
}

export function stableBucket(value: string): number {
  return createHash('sha256').update(value).digest().readUInt32BE(0) / 0x1_0000_0000 * 100;
}
