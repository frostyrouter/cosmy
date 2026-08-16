import { ProviderError } from '../domain/errors.js';

export function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') throw new ProviderError('Provider returned invalid tool arguments', true);
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Normalize all provider-specific parse failures to a safe protocol error.
  }
  throw new ProviderError('Provider returned invalid tool arguments', true);
}

export function syntheticToolCallId(requestId: string | undefined, index: number): string {
  return `${requestId ?? 'unknown'}:tool:${index}`;
}

export function toolCallId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0 && value.length <= 256) return value;
  return fallback;
}

export function toolName(value: unknown): string {
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value)) return value;
  throw new ProviderError('Provider returned an invalid tool name', true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
