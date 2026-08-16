import { performance } from 'node:perf_hooks';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { CachedOidcAuthenticator } from '../src/security/oidc-auth.js';

const TOTAL = Number(process.env.BENCH_TOTAL ?? 10_000);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 64);
if (!Number.isInteger(TOTAL) || TOTAL <= 0) throw new Error('BENCH_TOTAL must be a positive integer');
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY <= 0) throw new Error('BENCH_CONCURRENCY must be a positive integer');

const issuer = 'https://benchmark.invalid';
const pair = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'benchmark', alg: 'RS256', use: 'sig' };
let jwksFetches = 0;
const authenticator = new CachedOidcAuthenticator({
  issuer, audience: 'cosmy-router', jwksUri: `${issuer}/jwks`, algorithms: ['RS256'], tenantClaim: 'tenant_id', scopeClaim: 'scope', scopePrefix: 'cosmy:',
  maximumTokenAgeSeconds: 3_600, clockToleranceSeconds: 5, maximumJwksStaleSeconds: 86_400, requestTimeoutMs: 2_000, tokenType: 'at+jwt',
}, async () => {
  jwksFetches += 1;
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
});
await authenticator.refresh();
const now = Math.floor(Date.now() / 1_000);
const token = await new SignJWT({ tenant_id: 'tenant-a', scope: 'cosmy:responses:create cosmy:routing:read' })
  .setProtectedHeader({ alg: 'RS256', kid: 'benchmark', typ: 'at+jwt' }).setIssuer(issuer).setAudience('cosmy-router')
  .setSubject('benchmark-workload').setIssuedAt(now).setExpirationTime(now + 3_600).sign(pair.privateKey);
const authorization = `Bearer ${token}`;
for (let index = 0; index < 500; index += 1) await authenticator.authenticate(authorization);

function percentile(sorted: number[], value: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((value / 100) * sorted.length))] ?? 0;
}

const latencies: number[] = [];
let failures = 0;
let next = 0;
const started = performance.now();
async function worker(): Promise<void> {
  while (true) {
    const index = next++;
    if (index >= TOTAL) return;
    const requestStarted = performance.now();
    const principal = await authenticator.authenticate(authorization);
    latencies.push(performance.now() - requestStarted);
    if (!principal || principal.tenantId !== 'tenant-a') failures += 1;
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
const elapsedMs = performance.now() - started;
latencies.sort((left, right) => left - right);
console.log(JSON.stringify({
  total: TOTAL, concurrency: CONCURRENCY, verificationsPerSecond: Math.round((TOTAL / elapsedMs) * 1_000),
  meanMs: +(latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(3),
  p50Ms: +percentile(latencies, 50).toFixed(3), p95Ms: +percentile(latencies, 95).toFixed(3), p99Ms: +percentile(latencies, 99).toFixed(3),
  maximumMs: +(latencies.at(-1) ?? 0).toFixed(3), jwksFetches, failures,
}, null, 2));
if (failures > 0 || jwksFetches !== 1) process.exitCode = 1;
