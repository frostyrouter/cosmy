import { randomUUID } from 'node:crypto';

export function requestId(): string { return `req_${randomUUID()}`; }

let cachedSecond = 0;
let cachedIso = '';
export function nowIso(): string {
  const second = Math.floor(Date.now() / 1_000);
  if (second !== cachedSecond) {
    cachedSecond = second;
    cachedIso = new Date(second * 1_000).toISOString();
  }
  return cachedIso;
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
