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
}

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
    const allowedScopes: readonly ApiScope[] = ['responses:create', 'admin:read', 'admin:write'];
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
  return {
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
  };
}
