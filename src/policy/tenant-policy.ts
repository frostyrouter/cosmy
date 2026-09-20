import { RouterError } from '../domain/errors.js';
import type { DataClass, ModelConfiguration, PolicyHints, ResponseRequest } from '../domain/types.js';

export interface TenantPolicyConstraints {
  allowedProviders?: readonly string[];
  deniedProviders?: readonly string[];
  allowedModels?: readonly string[];
  deniedModels?: readonly string[];
  allowedRegions?: readonly string[];
  allowedDataClasses?: readonly DataClass[];
  maxCostUsd?: number;
  maxLatencyMs?: number;
  minQuality?: number;
  allowFallback?: boolean;
}

export interface TenantPolicyBundle extends TenantPolicyConstraints {
  tenantId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class ReloadableTenantPolicyResolver {
  private policies: ReadonlyMap<string, TenantPolicyBundle> = new Map();

  constructor(policies: readonly TenantPolicyBundle[] = []) { this.replace(policies); }

  replace(policies: readonly TenantPolicyBundle[]): void {
    const next = new Map<string, TenantPolicyBundle>();
    for (const policy of policies) {
      if (next.has(policy.tenantId)) throw new Error(`Duplicate tenant policy '${policy.tenantId}'`);
      next.set(policy.tenantId, structuredClone(policy));
    }
    this.policies = next;
  }

  resolve(request: ResponseRequest, tenantId: string): ResponseRequest {
    const bundle = this.policies.get(tenantId);
    if (!bundle) return request;
    const submitted = request.policy ?? {};
    const dataClass = submitted.dataClass ?? 'internal';
    if (bundle.allowedDataClasses && !bundle.allowedDataClasses.includes(dataClass)) throw policyRejection(`Data class '${dataClass}' is not allowed for this tenant`);
    if (submitted.region && bundle.allowedRegions && !bundle.allowedRegions.includes(submitted.region)) throw policyRejection(`Region '${submitted.region}' is not allowed for this tenant`);
    const policy: PolicyHints = {
      ...submitted,
      tenantPolicyVersion: bundle.version,
      ...(bundle.allowedRegions ? { allowedRegions: intersect(submitted.allowedRegions, bundle.allowedRegions) } : {}),
      ...(bundle.allowedProviders ? { allowedProviders: intersect(submitted.allowedProviders, bundle.allowedProviders) } : {}),
      ...(bundle.deniedProviders || submitted.deniedProviders ? { deniedProviders: union(submitted.deniedProviders, bundle.deniedProviders) } : {}),
      ...(bundle.allowedModels ? { allowedModels: intersect(submitted.allowedModels, bundle.allowedModels) } : {}),
      ...(bundle.deniedModels || submitted.deniedModels ? { deniedModels: union(submitted.deniedModels, bundle.deniedModels) } : {}),
      ...minimum('maxCostUsd', submitted.maxCostUsd, bundle.maxCostUsd),
      ...minimum('maxLatencyMs', submitted.maxLatencyMs, bundle.maxLatencyMs),
      ...maximum('minQuality', submitted.minQuality, bundle.minQuality),
      ...fallback(submitted.allowFallback, bundle.allowFallback),
    };
    return { ...request, policy };
  }

  allowsModel(tenantId: string, model: ModelConfiguration): boolean {
    const policy = this.policies.get(tenantId);
    if (!policy) return true;
    return (!policy.allowedProviders || policy.allowedProviders.includes(model.provider))
      && !policy.deniedProviders?.includes(model.provider)
      && (!policy.allowedModels || policy.allowedModels.includes(model.id))
      && !policy.deniedModels?.includes(model.id);
  }
}

function intersect(requested: readonly string[] | undefined, required: readonly string[]): string[] {
  return [...new Set((requested ?? required).filter((value) => required.includes(value)))].sort();
}

function union(left: readonly string[] | undefined, right: readonly string[] | undefined): string[] {
  return [...new Set([...(left ?? []), ...(right ?? [])])].sort();
}

function minimum<Key extends 'maxCostUsd' | 'maxLatencyMs'>(key: Key, left: number | undefined, right: number | undefined): Partial<Pick<PolicyHints, Key>> {
  const values = [left, right].filter((value): value is number => value !== undefined);
  return values.length ? { [key]: Math.min(...values) } as Pick<PolicyHints, Key> : {};
}

function maximum<Key extends 'minQuality'>(key: Key, left: number | undefined, right: number | undefined): Partial<Pick<PolicyHints, Key>> {
  const values = [left, right].filter((value): value is number => value !== undefined);
  return values.length ? { [key]: Math.max(...values) } as Pick<PolicyHints, Key> : {};
}

function fallback(requested: boolean | undefined, required: boolean | undefined): Partial<Pick<PolicyHints, 'allowFallback'>> {
  return requested === undefined && required === undefined ? {} : { allowFallback: requested !== false && required !== false };
}

function policyRejection(message: string): RouterError { return new RouterError(message, 'policy_rejection', 422, false); }
