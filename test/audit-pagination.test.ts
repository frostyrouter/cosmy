import { describe, expect, it } from 'vitest';
import { decodeAuditCursor, encodeAuditCursor } from '../src/control-plane/audit-pagination.js';

describe('audit pagination cursors', () => {
  it('round-trips a canonical event position', () => {
    const position = { id: '123e4567-e89b-42d3-a456-426614174000', occurredAt: '2026-08-16T18:00:00.000Z' };
    expect(decodeAuditCursor(encodeAuditCursor(position))).toEqual(position);
  });

  it('rejects malformed, non-canonical, and oversized cursors', () => {
    expect(() => decodeAuditCursor('not+base64')).toThrowError(/invalid or expired/u);
    expect(() => decodeAuditCursor(Buffer.from('{}').toString('base64url'))).toThrowError(/invalid or expired/u);
    expect(() => decodeAuditCursor('a'.repeat(513))).toThrowError(/invalid or expired/u);
  });
});
