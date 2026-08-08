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

export interface AppDependencies {
  registry?: InMemoryModelRegistry;
  usage?: InMemoryUsageLedger;
  health?: InMemoryHealthStore;
}

export async function buildApp(config: AppConfig = loadConfig(), dependencies: AppDependencies = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });
  await app.register(cors, { origin: false });
  await app.register(rateLimit, { max: config.environment === 'production' ? 120 : 1_000, timeWindow: '1 minute' });
  const registry = dependencies.registry ?? new InMemoryModelRegistry([...defaultModels, ...configuredModelManifests()]);
  const usage = dependencies.usage ?? new InMemoryUsageLedger();
  const health = dependencies.health ?? new InMemoryHealthStore();
  const metrics = new InMemoryMetrics();
  const router = new DeterministicRouter(registry);
  const providers = resilientProviders(configuredProviders(process.env, registry.snapshot()), { maxRetries: config.providerMaxRetries, timeoutMs: config.requestTimeoutMs });
  const executor = new RequestExecutor(providers, usage, health, metrics);
  registerRoutes(app, new RouterService(router, executor));
  return app;
}
