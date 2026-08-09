import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { defaultModels } from './registry/default-models.js';
import { InMemoryModelRegistry } from './registry/memory-registry.js';
import { InMemoryUsageLedger } from './stores/memory-usage-ledger.js';
import { InMemoryHealthStore } from './stores/memory-health-store.js';
import { configuredModelManifests, configuredProviders } from './providers/configured.js';
import { DeterministicRouter } from './routing/router.js';
import { RequestExecutor } from './execution/executor.js';
import { resilientProviders } from './execution/resilience.js';
import { RouterService } from './service/router-service.js';
import { registerRoutes } from './api/http.js';
import { InMemoryMetrics } from './observability/metrics.js';
import { loadConfig, type AppConfig } from './config.js';
import type { ProviderAdapter } from './ports/provider.js';
import type { HealthStore, ModelRegistry, UsageLedger } from './ports/stores.js';
import type { MetricsSink } from './observability/metrics.js';
import { applyControlPlaneMigration, createPostgresSqlClient, type PostgresSqlClient } from './persistence/postgres.js';
import { PostgresIdempotencyStore, PostgresReservationRepository } from './persistence/sql-adapters.js';
import { InMemoryResponseCache } from './persistence/memory-cache.js';
import { InMemoryIdempotencyStore } from './persistence/memory-idempotency.js';
import { sha256ApiKey, StaticApiKeyAuthenticator, type RequestAuthenticator } from './security/auth.js';

export interface AppDependencies {
  registry?: ModelRegistry;
  usage?: UsageLedger;
  health?: HealthStore;
  providers?: readonly ProviderAdapter[];
  metrics?: MetricsSink;
  cache?: import('./persistence/contracts.js').ResponseCache;
  authenticator?: RequestAuthenticator;
  idempotency?: import('./persistence/contracts.js').IdempotencyStore;
}

export async function buildApp(config: AppConfig = loadConfig(), dependencies: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, ajv: { customOptions: { removeAdditional: false } } });
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    try { done(null, JSON.parse(String(body))); } catch { done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
  });
  await app.register(cors, { origin: false });
  const rateLimitMax = config.rateLimitMax ?? (config.environment === 'production' ? 120 : 1_000);
  if (rateLimitMax > 0) await app.register(rateLimit, { max: rateLimitMax, timeWindow: '1 minute' });
  const configuredCredentials = config.apiCredentials ?? (config.apiKey ? [{ id: 'legacy', tenantId: 'default', keySha256: sha256ApiKey(config.apiKey), scopes: ['responses:create' as const] }] : []);
  const authenticator = dependencies.authenticator ?? (configuredCredentials.length ? new StaticApiKeyAuthenticator(configuredCredentials) : undefined);
  if (config.environment === 'production' && !config.allowUnauthenticated && !authenticator) {
    throw new Error('Production requires COSMY_API_CREDENTIALS or explicit ALLOW_UNAUTHENTICATED=true');
  }
  const registry = dependencies.registry ?? new InMemoryModelRegistry([...defaultModels, ...configuredModelManifests()]);
  let postgres: PostgresSqlClient | undefined;
  let usage = dependencies.usage;
  if (!usage && config.persistenceMode === 'postgres') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
    postgres = await createPostgresSqlClient(config.databaseUrl);
    try {
      await applyControlPlaneMigration(postgres);
      usage = new PostgresReservationRepository(postgres, config.tenantBudgetUsd);
    } catch (error) {
      await postgres.close();
      throw error;
    }
    app.addHook('onClose', async () => { await postgres?.close(); });
  }
  usage ??= new InMemoryUsageLedger(config.tenantBudgetUsd !== undefined ? { '*': config.tenantBudgetUsd } : {});
  let cache = dependencies.cache;
  if (!cache && config.cacheMode === 'memory') {
    cache = new InMemoryResponseCache();
  }
  const health = dependencies.health ?? new InMemoryHealthStore();
  const metrics = dependencies.metrics ?? new InMemoryMetrics();
  const router = new DeterministicRouter(registry);
  const providers = resilientProviders(configuredProviders(process.env, registry.snapshot()), { maxRetries: config.providerMaxRetries, timeoutMs: config.requestTimeoutMs });
  const executor = new RequestExecutor(dependencies.providers ?? providers, usage, health, metrics, config.requestTimeoutMs);
  const db = postgres;
  const readyCheck = db
    ? async (): Promise<boolean> => {
        try { await db.query('SELECT 1'); return true; } catch { return false; }
      }
    : undefined;
  const registryVersion = () => (registry as { currentSnapshot?: () => { version: number } }).currentSnapshot?.().version;
  const idempotency = dependencies.idempotency ?? (postgres ? new PostgresIdempotencyStore(postgres) : new InMemoryIdempotencyStore());
  registerRoutes(app, new RouterService(router, executor, cache, config.responseCacheTtlSeconds, registryVersion, idempotency, config.idempotencyTtlSeconds ?? 86_400), readyCheck, authenticator);
  return app;
}
