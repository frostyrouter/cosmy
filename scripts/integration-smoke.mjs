const baseUrl = process.env.COSMY_INTEGRATION_URL ?? 'http://127.0.0.1:18080';
const timeoutMs = Number(process.env.COSMY_SMOKE_TIMEOUT_MS ?? 60_000);
const started = Date.now();

async function waitForHealth() {
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Router did not become healthy within ${timeoutMs}ms`);
}

await waitForHealth();
const payload = { messages: [{ role: 'user', content: 'hello from integration smoke' }] };
async function complete() {
  const response = await fetch(`${baseUrl}/v1/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Router response failed with HTTP ${response.status}`);
  return response.json();
}
const first = await complete();
const second = await complete();
if (first.status !== 'completed' || !first.output || second.status !== 'completed' || second.output !== first.output) throw new Error('Router returned an invalid or inconsistent cached completion');
if (first.requestId === second.requestId) throw new Error('Cached completion reused the original request ID');
console.log(JSON.stringify({ status: second.status, model: second.model, provider: second.provider, cacheVerified: true }));
