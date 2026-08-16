import { RouterError } from '../domain/errors.js';
import type { AuditEvent, AuditPosition } from '../persistence/contracts.js';

interface AuditCursorPayload extends AuditPosition { v: 1 }

export function encodeAuditCursor(event: Pick<AuditEvent, 'id' | 'occurredAt'>): string {
  return Buffer.from(JSON.stringify({ v: 1, occurredAt: event.occurredAt, id: event.id } satisfies AuditCursorPayload), 'utf8').toString('base64url');
}

export function decodeAuditCursor(cursor: string): AuditPosition {
  try {
    if (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error('invalid encoding');
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('non-canonical encoding');
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    if (value.v !== 1 || typeof value.id !== 'string' || typeof value.occurredAt !== 'string' || Object.keys(value).length !== 3) throw new Error('invalid payload');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id)) throw new Error('invalid id');
    if (!Number.isFinite(Date.parse(value.occurredAt)) || new Date(value.occurredAt).toISOString() !== value.occurredAt) throw new Error('invalid timestamp');
    return { id: value.id, occurredAt: value.occurredAt };
  } catch {
    throw new RouterError('Audit cursor is invalid or expired', 'invalid_request', 400, false);
  }
}
