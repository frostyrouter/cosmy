import { randomUUID } from 'node:crypto';
import { RouterError } from '../domain/errors.js';
import type { ApiScope } from '../security/auth.js';
import type { CredentialStore, ManagedApiCredential } from './contracts.js';
import type { SqlClient } from './sql-adapters.js';

interface CredentialRow {
  credential_id: string;
  tenant_id: string;
  key_sha256: string;
  scopes: ApiScope[];
  disabled: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

const columns = 'credential_id, tenant_id, key_sha256, scopes, disabled, created_at, updated_at';

export class PostgresCredentialStore implements CredentialStore {
  constructor(private readonly db: SqlClient) {}

  async listCredentials(): Promise<readonly ManagedApiCredential[]> {
    const result = await this.db.query<CredentialRow>(`SELECT ${columns} FROM api_credentials ORDER BY credential_id`);
    return result.rows.map(credential);
  }

  async createCredential(input: { id: string; tenantId: string; keySha256: string; scopes: readonly ApiScope[]; actorCredentialId: string; actorTenantId: string }): Promise<ManagedApiCredential> {
    if (!this.db.transaction) throw new Error('Credential creation requires a transactional SQL client');
    try {
      return await this.db.transaction(async (tx) => {
        const result = await tx.query<CredentialRow>(`INSERT INTO api_credentials (credential_id, tenant_id, key_sha256, scopes) VALUES ($1, $2, $3, $4) RETURNING ${columns}`, [input.id, input.tenantId, input.keySha256, input.scopes]);
        await audit(tx, input.actorCredentialId, input.actorTenantId, 'credential.create', `credential:${input.id}`, { tenantId: input.tenantId, scopes: input.scopes });
        return credential(result.rows[0]!);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        const existing = (await this.db.query<CredentialRow>(`SELECT ${columns} FROM api_credentials WHERE credential_id = $1`, [input.id])).rows[0];
        if (existing && existing.tenant_id === input.tenantId && existing.key_sha256 === input.keySha256 && sameScopes(existing.scopes, input.scopes)) return credential(existing);
        throw new RouterError('Credential id or key digest already exists', 'credential_conflict', 409, false);
      }
      throw error;
    }
  }

  async disableCredential(input: { id: string; actorCredentialId: string; actorTenantId: string }): Promise<ManagedApiCredential> {
    if (!this.db.transaction) throw new Error('Credential disable requires a transactional SQL client');
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('cosmy:credential-admin-mutation'))");
      const target = (await tx.query<CredentialRow>(`SELECT ${columns} FROM api_credentials WHERE credential_id = $1 FOR UPDATE`, [input.id])).rows[0];
      if (!target) throw new RouterError('Credential was not found', 'credential_not_found', 404, false);
      if (target.disabled) return credential(target);
      if (target.scopes.includes('admin:write')) {
        const remaining = await tx.query<{ count: string | number }>("SELECT count(*) AS count FROM api_credentials WHERE disabled = false AND credential_id <> $1 AND 'admin:write' = ANY(scopes)", [input.id]);
        if (Number(remaining.rows[0]?.count ?? 0) === 0) throw new RouterError('Create another durable admin credential before disabling the last one', 'credential_last_admin', 409, false);
      }
      const result = await tx.query<CredentialRow>(`UPDATE api_credentials SET disabled = true, updated_at = now() WHERE credential_id = $1 AND disabled = false RETURNING ${columns}`, [input.id]);
      const row = result.rows[0];
      if (!row) throw new RouterError('Credential was not found or is already disabled', 'credential_not_mutable', 409, false);
      await audit(tx, input.actorCredentialId, input.actorTenantId, 'credential.disable', `credential:${input.id}`, {});
      return credential(row);
    });
  }
}

function sameScopes(left: readonly ApiScope[], right: readonly ApiScope[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((scope, index) => scope === sortedRight[index]);
}

function credential(row: CredentialRow): ManagedApiCredential {
  return { id: row.credential_id, tenantId: row.tenant_id, keySha256: row.key_sha256, scopes: [...row.scopes], ...(row.disabled ? { disabled: true } : {}), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

function audit(db: SqlClient, actorCredentialId: string, actorTenantId: string, action: 'credential.create' | 'credential.disable', target: string, details: Record<string, unknown>): Promise<unknown> {
  return db.query('SELECT append_admin_audit_event($1, $2, $3, $4, $5, $6::jsonb)', [randomUUID(), actorCredentialId, actorTenantId, action, target, JSON.stringify(details)]);
}
