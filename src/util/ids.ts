import { randomUUID } from 'node:crypto';

export function requestId(): string { return `req_${randomUUID()}`; }

export function nowIso(): string { return new Date().toISOString(); }

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
