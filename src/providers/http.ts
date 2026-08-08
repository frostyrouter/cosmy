import { ProviderError, RequestCancelledError } from '../domain/errors.js';

export interface HttpClient {
  request(url: string, init: RequestInit): Promise<Response>;
}

export const nativeHttpClient: HttpClient = {
  request: (url, init) => fetch(url, init),
};

export function jsonHeaders(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${apiKey}`, ...extra };
}

export async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try { parsed = text ? JSON.parse(text) : {}; } catch { throw new ProviderError(`Provider returned invalid JSON (${response.status})`, response.status >= 500); }
  if (!response.ok) {
    let message: unknown = parsed;
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) message = (parsed as { error: unknown }).error;
    if (typeof message === 'object' && message !== null && 'message' in message) message = (message as { message: unknown }).message;
    throw new ProviderError(typeof message === 'string' && message ? message : `HTTP ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ProviderError('Provider returned a non-object response', false);
  return parsed as Record<string, unknown>;
}

export async function* readSse(response: Response, signal: AbortSignal): AsyncIterable<{ event?: string; data: string }> {
  if (!response.ok) {
    const body = await response.text();
    throw new ProviderError(`Streaming provider error (${response.status}): ${body.slice(0, 300)}`, response.status === 408 || response.status === 429 || response.status >= 500);
  }
  if (!response.body) throw new ProviderError('Provider returned an empty stream', false);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  const dispatch = function* (line: string): Iterable<{ event?: string; data: string }> {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) {
      yield event === undefined ? { data: line.slice(5).trim() } : { event, data: line.slice(5).trim() };
      event = undefined;
    } else if (line === '') event = undefined;
  };
  try {
    while (true) {
      if (signal.aborted) throw new RequestCancelledError();
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? '';
      for (const line of lines) yield* dispatch(line);
      if (next.done) break;
    }
    if (buffer) yield* dispatch(buffer);
  } finally { reader.releaseLock(); }
}

export function asRecord(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
export function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function asString(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
export function asNumber(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
