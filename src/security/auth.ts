import { createHash } from 'node:crypto';

export type ApiScope = 'responses:create' | 'admin:read' | 'admin:write';

export interface ApiCredential {
  id: string;
  tenantId: string;
  keySha256: string;
  scopes: readonly ApiScope[];
  disabled?: boolean;
}

export interface RequestPrincipal {
  credentialId: string;
  tenantId: string;
  scopes: readonly ApiScope[];
}

export interface RequestAuthenticator {
  authenticate(authorization: string | undefined): RequestPrincipal | undefined;
}

export function sha256ApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

export class StaticApiKeyAuthenticator implements RequestAuthenticator {
  private readonly byDigest: ReadonlyMap<string, RequestPrincipal>;

  constructor(credentials: readonly ApiCredential[]) {
    const entries: Array<[string, RequestPrincipal]> = [];
    for (const credential of credentials) {
      if (!/^[a-f0-9]{64}$/u.test(credential.keySha256)) throw new Error(`Credential '${credential.id}' has an invalid SHA-256 digest`);
      if (!credential.id || !credential.tenantId) throw new Error('Credential id and tenantId are required');
      if (credential.disabled) continue;
      if (entries.some(([digest]) => digest === credential.keySha256)) throw new Error(`Credential '${credential.id}' has a duplicate SHA-256 digest`);
      entries.push([credential.keySha256, { credentialId: credential.id, tenantId: credential.tenantId, scopes: [...credential.scopes] }]);
    }
    this.byDigest = new Map(entries);
  }

  authenticate(authorization: string | undefined): RequestPrincipal | undefined {
    if (!authorization?.startsWith('Bearer ')) return undefined;
    const token = authorization.slice(7);
    if (!token) return undefined;
    return this.byDigest.get(sha256ApiKey(token));
  }
}
