import { performance } from 'node:perf_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import type { ModelRegistry } from '../ports/stores.js';
import type { ProviderAdapter } from '../ports/provider.js';
import type { ResponseRequest, ResponseResult } from '../domain/types.js';
import type { ControlPlaneStore } from '../persistence/contracts.js';
import type { MetricsSink } from '../observability/metrics.js';
import { estimateShadowCost, outputDigest, safeShadowRequest, shadowEligible, type ShadowCampaign, type ShadowObservation } from './shadow.js';

interface ShadowJob { campaign: ShadowCampaign; request: ResponseRequest; primaryModelId: string; primaryOutputSha256: string; sizeBytes: number; }

export interface ShadowScheduler { enqueue(request: ResponseRequest, primary: ResponseResult): void; }

export class ShadowCoordinator implements ShadowScheduler {
  private campaigns: readonly ShadowCampaign[] = [];
  private readonly providers: ReadonlyMap<string, ProviderAdapter>;
  private readonly queue: ShadowJob[] = [];
  private active = 0;
  private queuedBytes = 0;
  private readonly outputHashKey = randomBytes(32);

  constructor(private readonly store: ControlPlaneStore, private readonly models: ModelRegistry, providers: readonly ProviderAdapter[], private readonly metrics?: MetricsSink, private readonly concurrency = 4, private readonly maximumQueue = 1_000, private readonly timeoutMs = 30_000, private readonly maximumQueueBytes = 16 * 1_024 * 1_024) {
    this.providers = new Map(providers.map((provider) => [provider.name, provider]));
  }

  load(campaigns: readonly ShadowCampaign[]): void { this.campaigns = campaigns.map((campaign) => structuredClone(campaign)); }

  enqueue(request: ResponseRequest, primary: ResponseResult): void {
    for (const campaign of this.campaigns) {
      if (!shadowEligible(request, campaign) || primary.route.selected.model.id === campaign.modelId) continue;
      const safeRequest = safeShadowRequest(request); const sizeBytes = Buffer.byteLength(JSON.stringify(safeRequest), 'utf8');
      if (this.queue.length >= this.maximumQueue || this.queuedBytes + sizeBytes > this.maximumQueueBytes) { this.metrics?.increment?.('shadow_job_dropped'); continue; }
      this.queue.push({ campaign: structuredClone(campaign), request: safeRequest, primaryModelId: primary.route.selected.model.id, primaryOutputSha256: outputDigest(primary.output, this.outputHashKey), sizeBytes }); this.queuedBytes += sizeBytes;
    }
    this.drain();
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift()!; this.queuedBytes = Math.max(0, this.queuedBytes - job.sizeBytes); this.active += 1;
      void this.execute(job).catch(() => { this.metrics?.increment?.('shadow_execution_failure'); }).finally(() => { this.active -= 1; this.drain(); });
    }
  }

  private async execute(job: ShadowJob): Promise<void> {
    const model = this.models.get(job.campaign.modelId);
    if (!model || model.version !== job.campaign.modelVersion) return;
    const provider = this.providers.get(model.provider); if (!provider) return;
    let reservation;
    try { reservation = await this.store.reserveShadow(job.campaign.id, estimateShadowCost(model, job.request)); }
    catch { this.metrics?.increment?.('shadow_budget_rejection'); return; }
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); timer.unref();
    const started = performance.now();
    let observation: ShadowObservation;
    try {
      const response = await provider.complete({ request: { ...job.request, requestId: `shadow_${randomUUID()}` }, model, signal: controller.signal });
      const shadowOutputSha256 = outputDigest(response.output, this.outputHashKey);
      observation = { id: randomUUID(), campaignId: job.campaign.id, primaryModelId: job.primaryModelId, shadowModelId: model.id, status: 'success', latencyMs: performance.now() - started, usage: response.usage, primaryOutputSha256: job.primaryOutputSha256, shadowOutputSha256, exactMatch: job.primaryOutputSha256 === shadowOutputSha256, recordedAt: new Date().toISOString() };
      await this.store.reconcileShadow(reservation, response.usage.estimatedCostUsd);
    } catch {
      observation = { id: randomUUID(), campaignId: job.campaign.id, primaryModelId: job.primaryModelId, shadowModelId: model.id, status: 'error', latencyMs: performance.now() - started, recordedAt: new Date().toISOString() };
      await this.store.reconcileShadow(reservation, reservation.estimatedCostUsd);
    } finally { clearTimeout(timer); }
    await this.store.recordShadowObservation(observation);
    this.metrics?.increment?.('shadow_observation_recorded');
  }
}
