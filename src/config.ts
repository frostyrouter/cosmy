import type { ApiCredential, ApiScope } from './security/auth.js';

export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  environment: 'development' | 'test' | 'production';
  requestTimeoutMs: number;
  providerMaxRetries: number;
  persistenceMode?: 'memory' | 'postgres';
  databaseUrl?: string;
  cacheMode?: 'off' | 'memory';
  responseCacheTtlSeconds?: number;
  rateLimitMax?: number;
  tenantBudgetUsd?: number;
  apiKey?: string;
  apiCredentials?: readonly ApiCredential[];
  allowUnauthenticated?: boolean;
  idempotencyTtlSeconds?: number;
  reservationLeaseSeconds?: number;
  reconciliationSweepSeconds?: number;
  registryRefreshSeconds?: number;
  healthRefreshSeconds?: number;
  credentialRefreshSeconds?: number;
  policyRefreshSeconds?: number;
  classifierMode?: 'disabled' | 'degrade' | 'fail';
  classifierTimeoutMs?: number;
}

export type AppConfigInput = Partial<AppConfig>;

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveEnv(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Expected a non-negative number, received '${value}'`);
  return parsed > 0 ? parsed : undefined;
}

function positiveIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = numberEnv(value, fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received '${value}'`);
  return parsed;
}

function nonNegativeIntegerEnv(value: string | undefined, fallback: number): number {
  const parsed = numberEnv(value, fallback);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, received '${value}'`);
  return parsed;
}

function validateConfig(config: AppConfig): AppConfig {
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65_535) throw new Error(`Expected port between 0 and 65535, received '${config.port}'`);
  if (!Number.isFinite(config.requestTimeoutMs) || config.requestTimeoutMs <= 0) throw new Error(`Expected a positive request timeout, received '${config.requestTimeoutMs}'`);
  if (!Number.isInteger(config.providerMaxRetries) || config.providerMaxRetries < 0) throw new Error(`Expected non-negative provider retries, received '${config.providerMaxRetries}'`);
  if (config.responseCacheTtlSeconds !== undefined && (!Number.isInteger(config.responseCacheTtlSeconds) || config.responseCacheTtlSeconds < 0)) throw new Error(`Expected a non-negative cache TTL, received '${config.responseCacheTtlSeconds}'`);
  if (config.rateLimitMax !== undefined && (!Number.isInteger(config.rateLimitMax) || config.rateLimitMax < 0)) throw new Error(`Expected a non-negative rate limit, received '${config.rateLimitMax}'`);
  if (config.tenantBudgetUsd !== undefined && (!Number.isFinite(config.tenantBudgetUsd) || config.tenantBudgetUsd <= 0)) throw new Error(`Expected a positive tenant budget, received '${config.tenantBudgetUsd}'`);
  if (config.idempotencyTtlSeconds !== undefined && (!Number.isInteger(config.idempotencyTtlSeconds) || config.idempotencyTtlSeconds <= 0)) throw new Error(`Expected a positive idempotency TTL, received '${config.idempotencyTtlSeconds}'`);
  if (config.reservationLeaseSeconds !== undefined && (!Number.isInteger(config.reservationLeaseSeconds) || config.reservationLeaseSeconds <= 0)) throw new Error(`Expected a positive reservation lease, received '${config.reservationLeaseSeconds}'`);
  if (config.reconciliationSweepSeconds !== undefined && (!Number.isInteger(config.reconciliationSweepSeconds) || config.reconciliationSweepSeconds < 0)) throw new Error(`Expected a non-negative reconciliation interval, received '${config.reconciliationSweepSeconds}'`);
  if (config.registryRefreshSeconds !== undefined && (!Number.isInteger(config.registryRefreshSeconds) || config.registryRefreshSeconds < 0)) throw new Error(`Expected a non-negative registry refresh interval, received '${config.registryRefreshSeconds}'`);
  if (config.healthRefreshSeconds !== undefined && (!Number.isInteger(config.healthRefreshSeconds) || config.healthRefreshSeconds < 0)) throw new Error(`Expected a non-negative health refresh interval, received '${config.healthRefreshSeconds}'`);
  if (config.credentialRefreshSeconds !== undefined && (!Number.isInteger(config.credentialRefreshSeconds) || config.credentialRefreshSeconds < 0)) throw new Error(`Expected a non-negative credential refresh interval, received '${config.credentialRefreshSeconds}'`);
  if (config.policyRefreshSeconds !== undefined && (!Number.isInteger(config.policyRefreshSeconds) || config.policyRefreshSeconds < 0)) throw new Error(`Expected a non-negative policy refresh interval, received '${config.policyRefreshSeconds}'`);
  if (config.classifierTimeoutMs !== undefined && (!Number.isFinite(config.classifierTimeoutMs) || config.classifierTimeoutMs <= 0)) throw new Error(`Expected a positive classifier timeout, received '${config.classifierTimeoutMs}'`);
  return config;
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Expected boolean environment value, received '${value}'`);
}

function credentialsEnv(value: string | undefined): readonly ApiCredential[] | undefined {
  if (!value) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('COSMY_API_CREDENTIALS must be valid JSON'); }
  if (!Array.isArray(parsed)) throw new Error('COSMY_API_CREDENTIALS must be a JSON array');
  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) throw new Error(`Credential at index ${index} must be an object`);
    const value = entry as Record<string, unknown>;
    const scopes = value.scopes ?? ['responses:create'];
    const allowedScopes: readonly ApiScope[] = ['responses:create', 'routing:read', 'admin:read', 'admin:write', 'metrics:read'];
    if (typeof value.id !== 'string' || typeof value.tenantId !== 'string' || typeof value.keySha256 !== 'string' || !Array.isArray(scopes) || scopes.some((scope) => !allowedScopes.includes(scope as ApiScope))) {
      throw new Error(`Credential at index ${index} is invalid`);
    }
    return { id: value.id, tenantId: value.tenantId, keySha256: value.keySha256, scopes: scopes as ApiScope[], ...(value.disabled === true ? { disabled: true } : {}) };
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = env.ROUTER_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error(`Unsupported ROUTER_ENV: ${environment}`);
  }
  const production = environment === 'production';
  const apiCredentials = credentialsEnv(env.COSMY_API_CREDENTIALS);
  const tenantBudgetUsd = positiveEnv(env.TENANT_BUDGET_USD);
  const configuredClassifierMode = env.CLASSIFIER_MODE;
  if (configuredClassifierMode !== undefined && !['disabled', 'degrade', 'fail'].includes(configuredClassifierMode)) {
    throw new Error(`Unsupported CLASSIFIER_MODE: ${configuredClassifierMode}`);
  }
  const defaultClassifierMode = environment === 'production' ? 'fail' : env.DEEPSEEK_API_KEY ? 'degrade' : 'disabled';
  const classifierMode = (configuredClassifierMode ?? defaultClassifierMode) as NonNullable<AppConfig['classifierMode']>;
  return validateConfig({
    host: env.HOST ?? '0.0.0.0',
    port: numberEnv(env.PORT, 8080),
    logLevel: env.LOG_LEVEL ?? 'info',
    environment: environment as AppConfig['environment'],
    requestTimeoutMs: numberEnv(env.REQUEST_TIMEOUT_MS, 60_000),
    providerMaxRetries: numberEnv(env.PROVIDER_MAX_RETRIES, 2),
    persistenceMode: env.PERSISTENCE_MODE === 'postgres' ? 'postgres' : 'memory',
    ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
    cacheMode: env.CACHE_MODE === 'memory' ? 'memory' : 'off',
    responseCacheTtlSeconds: numberEnv(env.RESPONSE_CACHE_TTL_SECONDS, 60),
    ...(env.RATE_LIMIT_MAX ? { rateLimitMax: numberEnv(env.RATE_LIMIT_MAX, 0) } : {}),
    ...(tenantBudgetUsd !== undefined ? { tenantBudgetUsd } : {}),
    ...(env.COSMY_API_KEY ? { apiKey: env.COSMY_API_KEY } : {}),
    ...(apiCredentials ? { apiCredentials } : {}),
    allowUnauthenticated: booleanEnv(env.ALLOW_UNAUTHENTICATED, !production),
    idempotencyTtlSeconds: positiveIntegerEnv(env.IDEMPOTENCY_TTL_SECONDS, 86_400),
    reservationLeaseSeconds: positiveIntegerEnv(env.RESERVATION_LEASE_SECONDS, 300),
    reconciliationSweepSeconds: nonNegativeIntegerEnv(env.RECONCILIATION_SWEEP_SECONDS, 30),
    registryRefreshSeconds: nonNegativeIntegerEnv(env.REGISTRY_REFRESH_SECONDS, 15),
    healthRefreshSeconds: nonNegativeIntegerEnv(env.HEALTH_REFRESH_SECONDS, 2),
    credentialRefreshSeconds: nonNegativeIntegerEnv(env.CREDENTIAL_REFRESH_SECONDS, 2),
    policyRefreshSeconds: nonNegativeIntegerEnv(env.POLICY_REFRESH_SECONDS, 2),
    classifierMode,
    classifierTimeoutMs: numberEnv(env.CLASSIFIER_TIMEOUT_MS, 3_000),
  });
}

/** Applies environment-aware defaults to programmatic partial configuration. */
export function resolveConfig(input: AppConfigInput = {}, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = input.environment ?? env.ROUTER_ENV ?? 'development';
  const defaults = loadConfig({ ...env, ROUTER_ENV: environment });
  const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as AppConfigInput;
  return validateConfig({ ...defaults, ...defined });
}
