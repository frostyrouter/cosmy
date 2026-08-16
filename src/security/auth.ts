import { createHash } from 'node:crypto';

export type ApiScope = 'responses:create' | 'routing:read' | 'admin:read' | 'admin:write' | 'metrics:read';

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
    this.byDigest = credentialMap(credentials);
  }

  authenticate(authorization: string | undefined): RequestPrincipal | undefined {
    return authenticateFrom(this.byDigest, authorization);
  }
}

export class ReloadableApiKeyAuthenticator implements RequestAuthenticator {
  private byDigest: ReadonlyMap<string, RequestPrincipal>;

  constructor(private readonly bootstrapCredentials: readonly ApiCredential[] = [], dynamicCredentials: readonly ApiCredential[] = []) {
    this.byDigest = credentialMap([...bootstrapCredentials, ...dynamicCredentials]);
  }

  replaceDynamic(credentials: readonly ApiCredential[]): void {
    this.byDigest = credentialMap([...this.bootstrapCredentials, ...credentials]);
  }

  authenticate(authorization: string | undefined): RequestPrincipal | undefined {
    return authenticateFrom(this.byDigest, authorization);
  }

  get enabledCredentialCount(): number { return this.byDigest.size; }
}

function credentialMap(credentials: readonly ApiCredential[]): ReadonlyMap<string, RequestPrincipal> {
    const entries: Array<[string, RequestPrincipal]> = [];
    const ids = new Set<string>();
    for (const credential of credentials) {
      if (!/^[a-f0-9]{64}$/u.test(credential.keySha256)) throw new Error(`Credential '${credential.id}' has an invalid SHA-256 digest`);
      if (!credential.id || !credential.tenantId) throw new Error('Credential id and tenantId are required');
      if (ids.has(credential.id)) throw new Error(`Credential '${credential.id}' has a duplicate id`);
      ids.add(credential.id);
      if (credential.disabled) continue;
      if (entries.some(([digest]) => digest === credential.keySha256)) throw new Error(`Credential '${credential.id}' has a duplicate SHA-256 digest`);
      entries.push([credential.keySha256, { credentialId: credential.id, tenantId: credential.tenantId, scopes: [...credential.scopes] }]);
    }
  return new Map(entries);
}

function authenticateFrom(byDigest: ReadonlyMap<string, RequestPrincipal>, authorization: string | undefined): RequestPrincipal | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice(7);
  if (!token) return undefined;
  return byDigest.get(sha256ApiKey(token));
}
