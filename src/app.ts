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
import { registerAdminRoutes } from './api/admin-http.js';
import { registerMetricsRoute } from './api/metrics-http.js';
import { InMemoryMetrics } from './observability/metrics.js';
import { loadConfig, type AppConfig } from './config.js';
import type { ProviderAdapter } from './ports/provider.js';
import type { BudgetAdministration, HealthStore, ModelRegistry, UsageLedger } from './ports/stores.js';
import type { MetricsSink } from './observability/metrics.js';
import { applyControlPlaneMigration, createPostgresSqlClient, type PostgresSqlClient } from './persistence/postgres.js';
import { PostgresControlPlaneStore, PostgresIdempotencyStore, PostgresRegistryRepository, PostgresReservationRepository } from './persistence/sql-adapters.js';
import { InMemoryResponseCache } from './persistence/memory-cache.js';
import { InMemoryIdempotencyStore } from './persistence/memory-idempotency.js';
import { sha256ApiKey, StaticApiKeyAuthenticator, type RequestAuthenticator } from './security/auth.js';
import { InMemoryControlPlaneStore } from './control-plane/memory-store.js';
import { ControlPlaneService } from './control-plane/service.js';

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
  let postgres: PostgresSqlClient | undefined;
  let registryRepository: PostgresRegistryRepository | undefined;
  let reservationRecovery: PostgresReservationRepository | undefined;
  let reservationHeartbeatMs = 30_000;
  if (config.persistenceMode === 'postgres') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
    postgres = await createPostgresSqlClient(config.databaseUrl);
    try {
      await applyControlPlaneMigration(postgres);
    } catch (error) {
      await postgres.close();
      throw error;
    }
    app.addHook('onClose', async () => { await postgres?.close(); });
  }
  const seedModels = [...defaultModels, ...configuredModelManifests()];
  let registry = dependencies.registry;
  if (!registry && postgres) {
    registryRepository = new PostgresRegistryRepository(postgres);
    let snapshot = await registryRepository.getCurrent();
    snapshot ??= await registryRepository.publish(seedModels, 'startup-bootstrap');
    const durableRegistry = new InMemoryModelRegistry();
    durableRegistry.load(snapshot);
    registry = durableRegistry;
  }
  registry ??= new InMemoryModelRegistry(seedModels);
  let usage = dependencies.usage;
  if (!usage && postgres) {
    const minimumLeaseSeconds = Math.ceil(config.requestTimeoutMs / 1_000) + 30;
    const leaseSeconds = Math.max(config.reservationLeaseSeconds ?? 300, minimumLeaseSeconds);
    reservationHeartbeatMs = Math.min(30_000, Math.max(1_000, Math.floor(leaseSeconds * 1_000 / 3)));
    reservationRecovery = new PostgresReservationRepository(postgres, config.tenantBudgetUsd, leaseSeconds);
    usage = reservationRecovery;
  }
  usage ??= new InMemoryUsageLedger(config.tenantBudgetUsd !== undefined ? { '*': config.tenantBudgetUsd } : {});
  let cache = dependencies.cache;
  if (!cache && config.cacheMode === 'memory') {
    cache = new InMemoryResponseCache();
  }
  const health = dependencies.health ?? new InMemoryHealthStore();
  const metrics = dependencies.metrics ?? new InMemoryMetrics();
  registerMetricsRoute(app, metrics, authenticator);
  const router = new DeterministicRouter(registry);
  const providers = resilientProviders(configuredProviders(process.env, registry.snapshot()), { maxRetries: config.providerMaxRetries, timeoutMs: config.requestTimeoutMs });
  const providerAdapters = dependencies.providers ?? providers;
  const executor = new RequestExecutor(providerAdapters, usage, health, metrics, config.requestTimeoutMs, reservationHeartbeatMs);
  const db = postgres;
  const readyCheck = db
    ? async (): Promise<boolean> => {
        try { await db.query('SELECT 1'); return true; } catch { return false; }
      }
    : undefined;
  const registryVersion = () => (registry as { currentSnapshot?: () => { version: number } }).currentSnapshot?.().version;
  const idempotency = dependencies.idempotency ?? (postgres ? new PostgresIdempotencyStore(postgres) : new InMemoryIdempotencyStore());
  registerRoutes(app, new RouterService(router, executor, cache, config.responseCacheTtlSeconds, registryVersion, idempotency, config.idempotencyTtlSeconds ?? 86_400, metrics), readyCheck, authenticator);
  if (registry instanceof InMemoryModelRegistry && (postgres || isBudgetAdministration(usage))) {
    const controlStore = postgres ? new PostgresControlPlaneStore(postgres) : new InMemoryControlPlaneStore(registry, usage as UsageLedger & BudgetAdministration);
    registerAdminRoutes(app, new ControlPlaneService(controlStore, registry, new Set(providerAdapters.map((provider) => provider.name))), authenticator);
  }
  if (registryRepository && registry instanceof InMemoryModelRegistry) {
    const refreshSeconds = config.registryRefreshSeconds ?? 15;
    if (refreshSeconds > 0) {
      const durableRegistry = registry;
      const repository = registryRepository;
      const timer = setInterval(() => {
        void repository.getCurrent().then((snapshot) => {
          if (snapshot && snapshot.version > durableRegistry.currentSnapshot().version) durableRegistry.load(snapshot);
        }).catch((error: unknown) => { metrics.increment?.('registry_refresh_failure'); app.log.error({ err: error }, 'registry refresh failed'); });
      }, refreshSeconds * 1_000);
      timer.unref();
      app.addHook('onClose', async () => { clearInterval(timer); });
    }
  }
  if (reservationRecovery) {
    await reservationRecovery.reconcileExpired();
    const sweepSeconds = config.reconciliationSweepSeconds ?? 30;
    if (sweepSeconds > 0) {
      const recovery = reservationRecovery;
      const timer = setInterval(() => {
        void recovery.reconcileExpired().then((count) => {
          if (count > 0) app.log.warn({ count }, 'reconciled expired usage reservations');
          if (count > 0) metrics.increment?.('reservation_recovered', count);
        }).catch((error: unknown) => app.log.error({ err: error }, 'reservation recovery sweep failed'));
      }, sweepSeconds * 1_000);
      timer.unref();
      app.addHook('onClose', async () => { clearInterval(timer); });
    }
  }
  return app;
}

function isBudgetAdministration(usage: UsageLedger): usage is UsageLedger & BudgetAdministration {
  const candidate = usage as Partial<BudgetAdministration>;
  return typeof candidate.budgetFor === 'function' && typeof candidate.setBudget === 'function';
}
