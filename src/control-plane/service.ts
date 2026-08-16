import type { ModelConfiguration } from '../domain/types.js';
import { RouterError } from '../domain/errors.js';
import type { ControlPlaneStore, CredentialStore } from '../persistence/contracts.js';
import type { InMemoryModelRegistry } from '../registry/memory-registry.js';
import type { ApiScope, RequestPrincipal } from '../security/auth.js';
import { assessPromotion, hasModelVersionConflict, needsPromotionEvidence, type ModelPromotionEvidence } from './promotion.js';
import type { InMemoryRolloutRegistry, ModelRollout, RolloutOutcome } from '../rollouts/rollout.js';
import type { ShadowCampaign } from '../shadow/shadow.js';
import type { ShadowCoordinator } from '../shadow/coordinator.js';

export class ControlPlaneService {
  constructor(private readonly store: ControlPlaneStore, private readonly registry: InMemoryModelRegistry, private readonly availableProviders: ReadonlySet<string>, private readonly rollouts?: InMemoryRolloutRegistry, private readonly shadows?: ShadowCoordinator, private readonly credentials?: CredentialStore, private readonly refreshCredentials?: () => Promise<void>) {}

  snapshot() { return this.registry.currentSnapshot(); }

  async listCredentials() {
    if (!this.credentials) throw new RouterError('Durable credential management requires PostgreSQL mode', 'credential_store_unavailable', 503, true);
    return (await this.credentials.listCredentials()).map(({ keySha256: _keySha256, ...credential }) => credential);
  }

  async createCredential(input: { id: string; tenantId: string; keySha256: string; scopes: readonly ApiScope[] }, actor: RequestPrincipal) {
    if (!this.credentials) throw new RouterError('Durable credential management requires PostgreSQL mode', 'credential_store_unavailable', 503, true);
    const created = await this.credentials.createCredential({ ...input, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    await this.refreshCredentials?.();
    const { keySha256: _keySha256, ...metadata } = created;
    return metadata;
  }

  async disableCredential(id: string, actor: RequestPrincipal) {
    if (!this.credentials) throw new RouterError('Durable credential management requires PostgreSQL mode', 'credential_store_unavailable', 503, true);
    const disabled = await this.credentials.disableCredential({ id, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    await this.refreshCredentials?.();
    const { keySha256: _keySha256, ...metadata } = disabled;
    return metadata;
  }

  async publishModels(models: readonly ModelConfiguration[], source: string, actor: RequestPrincipal) {
    if (models.length === 0) throw new RouterError('A registry snapshot must contain at least one model', 'invalid_request', 400, false);
    const ids = new Set<string>();
    let enabled = 0;
    for (const model of models) {
      if (ids.has(model.id)) throw new RouterError(`Duplicate model id '${model.id}'`, 'invalid_request', 400, false);
      if (model.maxOutputTokens > model.contextWindow) throw new RouterError(`Model '${model.id}' output limit exceeds its context window`, 'invalid_request', 400, false);
      if (model.enabled && !this.availableProviders.has(model.provider)) throw new RouterError(`Enabled model '${model.id}' references an unavailable provider`, 'invalid_request', 400, false);
      if (model.enabled) enabled += 1;
      ids.add(model.id);
    }
    if (enabled === 0) throw new RouterError('A registry snapshot must contain at least one enabled model', 'invalid_request', 400, false);
    for (const model of models) {
      const current = this.registry.get(model.id);
      if (hasModelVersionConflict(current, model)) throw new RouterError(`Model '${model.id}' version '${model.version}' is immutable; publish material changes under a new version`, 'model_version_conflict', 409, false);
      if (!needsPromotionEvidence(current, model)) continue;
      const evidence = await this.store.evidenceFor(model.id, model.version);
      const reasons = assessPromotion(model, evidence);
      if (reasons.length) throw new RouterError(`Model '${model.id}' failed promotion gates: ${reasons.join(', ')}`, 'promotion_gate_failed', 409, false);
    }
    const snapshot = await this.store.publishModels({ models, source, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    return this.registry.load(snapshot);
  }

  budgetFor(tenantId: string) { return this.store.budgetFor(tenantId); }

  setBudget(tenantId: string, limitUsd: number, actor: RequestPrincipal) {
    return this.store.setBudget({ tenantId, limitUsd, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
  }

  listAudit(limit: number) { return this.store.listAudit(limit); }

  submitEvidence(evidence: Omit<ModelPromotionEvidence, 'id' | 'submittedAt' | 'submittedByCredentialId'>, actor: RequestPrincipal) {
    return this.store.submitEvidence({ ...evidence, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
  }

  evidenceFor(modelId: string, modelVersion: string) { return this.store.evidenceFor(modelId, modelVersion); }

  async assessCandidate(model: ModelConfiguration) {
    const current = this.registry.get(model.id);
    if (hasModelVersionConflict(current, model)) return { required: true, eligible: false, reasons: ['model_version_conflict'] };
    const required = needsPromotionEvidence(current, model);
    if (!required) return { required, eligible: true, reasons: [] as string[] };
    const evidence = await this.store.evidenceFor(model.id, model.version);
    const reasons = assessPromotion(model, evidence);
    return { required, eligible: reasons.length === 0, reasons, ...(evidence ? { evidence } : {}) };
  }

  async createRollout(input: Omit<ModelRollout, 'id' | 'state' | 'sampleCount' | 'errorCount' | 'totalLatencyMs' | 'reason' | 'createdAt' | 'updatedAt'>, actor: RequestPrincipal) {
    const model = this.registry.get(input.modelId);
    if (!model || !model.enabled || model.version !== input.modelVersion) throw new RouterError('Rollout target must be the exact enabled registry model version', 'invalid_rollout_target', 409, false);
    const rollout = await this.store.createRollout({ ...input, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    this.rollouts?.upsert(rollout); return rollout;
  }
  rollout(id: string) { return this.store.rollout(id); }
  runtimeRollouts() { return this.store.runtimeRollouts(); }
  async changeRollout(id: string, action: 'promote' | 'rollback', reason: string | undefined, actor: RequestPrincipal) {
    const rollout = await this.store.changeRollout({ id, action, ...(reason ? { reason } : {}), actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    this.rollouts?.upsert(rollout); return rollout;
  }
  async recordOutcome(outcome: RolloutOutcome): Promise<ModelRollout | undefined> {
    const before = this.rollouts?.get(outcome.modelId);
    const rollout = await this.store.recordRolloutOutcome(outcome);
    if (rollout) this.rollouts?.upsert(rollout);
    return before?.state === 'canary' && rollout?.state === 'rolled_back' ? rollout : undefined;
  }

  async createShadowCampaign(input: Omit<ShadowCampaign, 'id' | 'state' | 'reservedUsd' | 'spentUsd' | 'sampleCount' | 'successCount' | 'errorCount' | 'createdAt' | 'updatedAt'>, actor: RequestPrincipal) {
    const model = this.registry.get(input.modelId);
    if (!model || model.version !== input.modelVersion || !this.availableProviders.has(model.provider)) throw new RouterError('Shadow target must be an exact registered model version with an available provider', 'invalid_shadow_target', 409, false);
    if (input.allowedDataClasses.some((value) => value !== 'public' && value !== 'internal')) throw new RouterError('Shadow campaigns may only admit public or internal data', 'invalid_shadow_data_class', 400, false);
    const campaign = await this.store.createShadowCampaign({ ...input, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    this.shadows?.load(await this.store.activeShadowCampaigns()); return campaign;
  }
  shadowCampaign(id: string) { return this.store.shadowCampaign(id); }
  async changeShadowCampaign(id: string, action: 'pause' | 'resume' | 'complete', actor: RequestPrincipal) {
    const campaign = await this.store.changeShadowCampaign({ id, action, actorCredentialId: actor.credentialId, actorTenantId: actor.tenantId });
    this.shadows?.load(await this.store.activeShadowCampaigns()); return campaign;
  }
}
