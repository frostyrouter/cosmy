import { performance } from 'node:perf_hooks';
import { Session } from 'node:inspector/promises';
import { buildApp } from '../src/app.js';

const TOTAL = Number(process.env.BENCH_TOTAL ?? 20_000);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 64);
const PAYLOAD = process.env.BENCH_PAYLOAD ?? 'simple';
const BENCH_ENV = process.env.BENCH_ENV ?? 'test';

if (!Number.isInteger(TOTAL) || TOTAL <= 0) throw new Error('BENCH_TOTAL must be a positive integer');
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY <= 0) throw new Error('BENCH_CONCURRENCY must be a positive integer');
if (!['development', 'test', 'production'].includes(BENCH_ENV)) throw new Error('BENCH_ENV must be development, test, or production');

function makeBody(): object {
  if (PAYLOAD === 'large') {
    const messages = [];
    for (let i = 0; i < 20; i++) messages.push({ role: 'user', content: `Message ${i} with some technical content about api and sql optimization for latency analysis`.repeat(5) });
    return { model: 'sim-balanced', messages, maxOutputTokens: 500 };
  }
  return { model: 'sim-small-text', messages: [{ role: 'user', content: 'Rewrite this email politely for a customer' }] };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

const app = await buildApp({ host: '127.0.0.1', port: 0, logLevel: process.env.BENCH_LOG_LEVEL ?? 'silent', environment: BENCH_ENV as 'development' | 'test' | 'production', rateLimitMax: Number(process.env.BENCH_RATE_LIMIT_MAX ?? 100_000) });
await app.listen({ host: '127.0.0.1', port: 0 });
const port = (app.server.address() as { port: number }).port;
const url = `http://127.0.0.1:${port}/v1/responses`;
const body = makeBody();

for (let i = 0; i < 200; i++) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await response.arrayBuffer();
}

const latencies: number[] = [];
const errors: number[] = [];
const started = performance.now();

let profiler: Session | undefined;
if (process.env.BENCH_PROFILE) {
  profiler = new Session();
  profiler.connect();
  await profiler.post('Profiler.enable');
  await profiler.post('Profiler.start', { samplingInterval: 100 });
}

let next = 0;
async function worker(): Promise<void> {
  while (true) {
    const index = next++;
    if (index >= TOTAL) return;
    const requestStart = performance.now();
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (response.status !== 200) errors.push(response.status);
      await response.arrayBuffer();
    } catch {
      errors.push(0);
    }
    latencies.push(performance.now() - requestStart);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const elapsedMs = performance.now() - started;

if (profiler) {
  const { profile } = await profiler.post('Profiler.stop');
  const profilePath = process.env.BENCH_PROFILE;
  if (profilePath) await import('node:fs/promises').then((fs) => fs.writeFile(profilePath, JSON.stringify(profile)));
  profiler.disconnect();
}
latencies.sort((a, b) => a - b);

console.log(JSON.stringify({
  total: TOTAL,
  concurrency: CONCURRENCY,
  payload: PAYLOAD,
  requestsPerSecond: Math.round((TOTAL / elapsedMs) * 1000),
  meanMs: +(latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(3),
  p50Ms: +percentile(latencies, 50).toFixed(3),
  p90Ms: +percentile(latencies, 90).toFixed(3),
  p95Ms: +percentile(latencies, 95).toFixed(3),
  p99Ms: +percentile(latencies, 99).toFixed(3),
  maxMs: +latencies.at(-1)!.toFixed(3),
  errors: errors.length,
}, null, 2));

await app.close();
if (errors.length > 0) process.exitCode = 1;
