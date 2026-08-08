export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  environment: 'development' | 'test' | 'production';
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
  };
}
