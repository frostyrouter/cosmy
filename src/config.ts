export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  environment: 'development' | 'test' | 'production';
  requestTimeoutMs: number;
  providerMaxRetries: number;
  persistenceMode?: 'memory' | 'postgres';
  databaseUrl?: string;
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = env.ROUTER_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error(`Unsupported ROUTER_ENV: ${environment}`);
  }
  return {
    host: env.HOST ?? '0.0.0.0',
    port: numberEnv(env.PORT, 8080),
    logLevel: env.LOG_LEVEL ?? 'info',
    environment: environment as AppConfig['environment'],
    requestTimeoutMs: numberEnv(env.REQUEST_TIMEOUT_MS, 60_000),
    providerMaxRetries: numberEnv(env.PROVIDER_MAX_RETRIES, 2),
    persistenceMode: env.PERSISTENCE_MODE === 'postgres' ? 'postgres' : 'memory',
    ...(env.DATABASE_URL ? { databaseUrl: env.DATABASE_URL } : {}),
  };
}
