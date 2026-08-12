import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { defaultModels } from './registry/default-models.js';
import { InMemoryModelRegistry } from './registry/memory-registry.js';
import { InMemoryUsageLedger } from './stores/memory-usage-ledger.js';
import { InMemoryHealthStore } from './stores/memory-health-store.js';
import { configuredClassifier, configuredModelManifests, configuredProviders } from './providers/configured.js';
import { DeterministicRouter } from './routing/router.js';
import { RequestExecutor } from './execution/executor.js';
import { resilientProviders } from './execution/resilience.js';
import { RouterService } from './service/router-service.js';
import { registerRoutes } from './api/http.js';
import { registerAdminRoutes } from './api/admin-http.js';
import { registerDiagnosticsRoute, registerMetricsRoute } from './api/metrics-http.js';
import { InMemoryMetrics } from './observability/metrics.js';
import { resolveConfig, type AppConfigInput } from './config.js';
import type { ProviderAdapter } from './ports/provider.js';
import type { RequestClassifier } from './ports/classifier.js';
import type { BudgetAdministration, HealthSnapshotStore, HealthStore, ModelRegistry, UsageLedger } from './ports/stores.js';
import type { MetricsSink } from './observability/metrics.js';
import { applyControlPlaneMigration, createPostgresSqlClient, type PostgresSqlClient } from './persistence/postgres.js';
import { PostgresControlPlaneStore, PostgresDecisionStore, PostgresIdempotencyStore, PostgresRegistryRepository, PostgresReservationRepository } from './persistence/sql-adapters.js';
import { InMemoryResponseCache } from './persistence/memory-cache.js';
import { InMemoryIdempotencyStore } from './persistence/memory-idempotency.js';
import { InMemoryDecisionStore } from './persistence/memory-decisions.js';
import { sha256ApiKey, StaticApiKeyAuthenticator, type RequestAuthenticator } from './security/auth.js';
import { InMemoryControlPlaneStore } from './control-plane/memory-store.js';
import { ControlPlaneService } from './control-plane/service.js';
import { InMemoryRolloutRegistry, type RolloutOutcome } from './rollouts/rollout.js';
import type { ControlPlaneStore } from './persistence/contracts.js';
import { ShadowCoordinator } from './shadow/coordinator.js';

export interface AppDependencies {
  registry?: ModelRegistry;
  usage?: UsageLedger;
  health?: HealthStore;
  providers?: readonly ProviderAdapter[];
  metrics?: MetricsSink;
  cache?: import('./persistence/contracts.js').ResponseCache;
  authenticator?: RequestAuthenticator;
  idempotency?: import('./persistence/contracts.js').IdempotencyStore;
  decisions?: import('./persistence/contracts.js').DecisionStore;
  classifier?: RequestClassifier | null;
  env?: NodeJS.ProcessEnv;
}

export async function buildApp(inputConfig: AppConfigInput = {}, dependencies: AppDependencies = {}): Promise<FastifyInstance> {
  const configEnv = dependencies.env ?? (inputConfig.environment === 'test' ? {} : process.env);
  const config = resolveConfig(inputConfig, configEnv);
  // Explicit test configuration must never inherit ambient credentials and make paid calls.
  const runtimeEnv = dependencies.env ?? (config.environment === 'test' ? {} : process.env);
  const availableClassifier = dependencies.classifier === undefined ? configuredClassifier(runtimeEnv) : dependencies.classifier ?? undefined;
  const classifierMode = config.classifierMode ?? (config.environment === 'production' ? 'fail' : availableClassifier ? 'degrade' : 'disabled');
  const classifier = classifierMode === 'disabled' ? undefined : availableClassifier;
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
  if (classifierMode === 'fail' && !availableClassifier) throw new Error('DEEPSEEK_API_KEY is required when CLASSIFIER_MODE=fail');
  let postgres: PostgresSqlClient | undefined;
  let rolloutPostgres: PostgresSqlClient | undefined;
  let shadowPostgres: PostgresSqlClient | undefined;
  let registryRepository: PostgresRegistryRepository | undefined;
  let reservationRecovery: PostgresReservationRepository | undefined;
  let reservationHeartbeatMs = 30_000;
  if (config.persistenceMode === 'postgres') {
    if (!config.databaseUrl) throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
    postgres = await createPostgresSqlClient(config.databaseUrl);
    try {
      await applyControlPlaneMigration(postgres);
      rolloutPostgres = await createPostgresSqlClient(config.databaseUrl, { maxConnections: 4, statementTimeoutMs: 100, queryTimeoutMs: 200, connectionTimeoutMs: 200 });
      shadowPostgres = await createPostgresSqlClient(config.databaseUrl, { maxConnections: 4, statementTimeoutMs: 2_000, queryTimeoutMs: 3_000, connectionTimeoutMs: 500 });
    } catch (error) {
      await rolloutPostgres?.close();
      await postgres.close();
      throw error;
    }
    app.addHook('onClose', async () => { await shadowPostgres?.close(); await rolloutPostgres?.close(); await postgres?.close(); });
  }
  const seedModels = [...defaultModels, ...configuredModelManifests(runtimeEnv)];
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
  const providers = resilientProviders(configuredProviders(runtimeEnv, registry.snapshot()), { maxRetries: config.providerMaxRetries, timeoutMs: config.requestTimeoutMs });
  const providerAdapters = dependencies.providers ?? providers;
  const rolloutRegistry = new InMemoryRolloutRegistry();
  const controlStore: ControlPlaneStore | undefined = registry instanceof InMemoryModelRegistry && (postgres || isBudgetAdministration(usage))
    ? postgres ? new PostgresControlPlaneStore(postgres, rolloutPostgres, shadowPostgres) : new InMemoryControlPlaneStore(registry, usage as UsageLedger & BudgetAdministration)
    : undefined;
  if (controlStore) rolloutRegistry.load(await controlStore.runtimeRollouts());
  const shadowCoordinator = controlStore ? new ShadowCoordinator(controlStore, registry, providerAdapters, metrics, 4, 1_000, Math.min(config.requestTimeoutMs, 30_000)) : undefined;
  if (shadowCoordinator && controlStore) shadowCoordinator.load(await controlStore.activeShadowCampaigns());
  const router = new DeterministicRouter(registry, {
    ...(classifier ? { classifier } : {}),
    classifierTimeoutMs: config.classifierTimeoutMs ?? 3_000,
    failureMode: classifierMode === 'fail' ? 'fail' : 'degrade',
    admission: rolloutRegistry,
    ...(isHealthSnapshotStore(health) ? { health } : {}),
  });
  const rolloutObserver = controlStore ? {
    recordOutcome: async (outcome: RolloutOutcome) => {
      const before = rolloutRegistry.get(outcome.modelId);
      if (!before || before.state !== 'canary' || before.modelVersion !== outcome.modelVersion) return;
      const updated = await controlStore.recordRolloutOutcome(outcome);
      if (updated) rolloutRegistry.upsert(updated);
      if (before?.state === 'canary' && updated?.state === 'rolled_back') metrics.increment?.('rollout_auto_rollback');
    },
  } : undefined;
  const executor = new RequestExecutor(providerAdapters, usage, health, metrics, config.requestTimeoutMs, reservationHeartbeatMs, rolloutObserver);
  const db = postgres;
  const readyCheck = db
    ? async (): Promise<boolean> => {
        try { await db.query('SELECT 1'); return true; } catch { return false; }
      }
    : undefined;
  const registryVersion = () => (registry as { currentSnapshot?: () => { version: number } }).currentSnapshot?.().version;
  const idempotency = dependencies.idempotency ?? (postgres ? new PostgresIdempotencyStore(postgres) : new InMemoryIdempotencyStore());
  const decisions = dependencies.decisions ?? (postgres ? new PostgresDecisionStore(postgres) : new InMemoryDecisionStore());
  registerRoutes(app, new RouterService(router, executor, cache, config.responseCacheTtlSeconds, registryVersion, idempotency, config.idempotencyTtlSeconds ?? 86_400, metrics, shadowCoordinator, decisions, config.requestTimeoutMs), readyCheck, authenticator);
  registerDiagnosticsRoute(app, async () => {
    const current = (registry as { currentSnapshot?: () => { version: number; source: string; createdAt: string } }).currentSnapshot?.();
    const models = registry.snapshot();
    const ready = readyCheck ? await readyCheck() : true;
    return {
      status: ready ? 'ready' : 'unready',
      registry: { ...(current ?? {}), modelCount: models.length, enabledModelCount: models.filter((model) => model.enabled).length },
      persistence: postgres ? 'postgres' : 'memory',
      metrics: metrics.snapshot(),
    };
  }, authenticator);
  if (controlStore && registry instanceof InMemoryModelRegistry) {
    registerAdminRoutes(app, new ControlPlaneService(controlStore, registry, new Set(providerAdapters.map((provider) => provider.name)), rolloutRegistry, shadowCoordinator), authenticator);
  }
  if (registryRepository && registry instanceof InMemoryModelRegistry) {
    const refreshSeconds = config.registryRefreshSeconds ?? 15;
    if (refreshSeconds > 0) {
      const durableRegistry = registry;
      const repository = registryRepository;
      const timer = setInterval(() => {
        void repository.getCurrent().then(async (snapshot) => {
          if (snapshot && snapshot.version > durableRegistry.currentSnapshot().version) durableRegistry.load(snapshot);
          if (controlStore) rolloutRegistry.load(await controlStore.runtimeRollouts());
          if (controlStore && shadowCoordinator) shadowCoordinator.load(await controlStore.activeShadowCampaigns());
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
  if (controlStore) {
    const recovered = await controlStore.reconcileExpiredShadows(); if (recovered > 0) metrics.increment?.('shadow_reservation_recovered', recovered);
    const timer = setInterval(() => { void controlStore.reconcileExpiredShadows().then((count) => { if (count > 0) metrics.increment?.('shadow_reservation_recovered', count); }).catch(() => metrics.increment?.('shadow_execution_failure')); }, 30_000);
    timer.unref(); app.addHook('onClose', async () => { clearInterval(timer); });
  }
  return app;
}

function isBudgetAdministration(usage: UsageLedger): usage is UsageLedger & BudgetAdministration {
  const candidate = usage as Partial<BudgetAdministration>;
  return typeof candidate.budgetFor === 'function' && typeof candidate.setBudget === 'function';
}

function isHealthSnapshotStore(health: HealthStore): health is HealthSnapshotStore {
  return typeof (health as Partial<HealthSnapshotStore>).snapshot === 'function';
}
