import { createPublicKey, JsonWebKey } from "crypto";
import jwt, { JwtPayload } from "jsonwebtoken";

/** DTCC's docs describe a username and password; the solution brief describes client credentials. Both are supported until DTCC confirms. */
export type ServiceAccountCredentials =
  | { grant: 'client_credentials'; clientId: string; clientSecret: string }
  | { grant: 'password'; clientId: string; username: string; password: string };

export interface IssuedToken {
  token: string;
  expiresAt: number;
  claims: JwtPayload;
}

export class IdentityError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

interface Discovery {
  issuer: string;
  token_endpoint: string;
  jwks_uri: string;
}

const HTTP_TIMEOUT_MS = 10_000;

/** OIDC client for DTCC Identity (IDT): service-account tokens and verification of IDT-issued user tokens. */
export class IdentityClient {
  private discovery?: Promise<Discovery>;
  private keys = new Map<string, JsonWebKey>();

  constructor(readonly issuer: string, private readonly credentials: ServiceAccountCredentials) {}

  async serviceAccountToken(scope?: string): Promise<IssuedToken> {
    const { token_endpoint } = await this.discover();
    const body = new URLSearchParams({ grant_type: this.credentials.grant });
    const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
    if (this.credentials.grant === 'client_credentials') {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(this.credentials.clientId)}:${encodeURIComponent(this.credentials.clientSecret)}`).toString('base64')}`;
    } else {
      body.set('client_id', this.credentials.clientId);
      body.set('username', this.credentials.username);
      body.set('password', this.credentials.password);
    }
    if (scope) body.set('scope', scope);
    const res = await fetch(token_endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    const payload: any = await res.json().catch(() => ({}));
    if (!res.ok || !payload.access_token) {
      throw new IdentityError(`DTCC Identity refused the service account (${res.status} ${payload.error ?? ''}${payload.error_description ? `: ${payload.error_description}` : ''})`.trim(), res.status);
    }
    const claims = jwt.decode(payload.access_token) as JwtPayload | null;
    const expiresAt = claims?.exp ? claims.exp * 1000 : Date.now() + Number(payload.expires_in ?? 300) * 1000;
    return { token: payload.access_token, expiresAt, claims: claims ?? {} };
  }

  /** Verifies a token's signature against IDT's published keys, its issuer and expiry. */
  async verify(token: string, audience?: string): Promise<JwtPayload> {
    const header = jwt.decode(token, { complete: true })?.header;
    if (!header?.kid) throw new IdentityError('The token has no key id', 401);
    const key = await this.key(header.kid);
    try {
      return jwt.verify(token, createPublicKey({ key, format: 'jwk' }), {
        algorithms: ['RS256'], issuer: this.issuer, ...(audience ? { audience } : {}),
      }) as JwtPayload;
    } catch (e) {
      throw new IdentityError(`The token is not valid: ${(e as Error).message}`, 401);
    }
  }

  private async key(kid: string): Promise<JsonWebKey> {
    if (!this.keys.has(kid)) {
      const { jwks_uri } = await this.discover();
      const res = await fetch(jwks_uri, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (!res.ok) throw new IdentityError(`DTCC Identity keys are unavailable (${res.status})`, 502);
      const { keys } = await res.json() as { keys: (JsonWebKey & { kid: string })[] };
      for (const k of keys) this.keys.set(k.kid, k);
    }
    const key = this.keys.get(kid);
    if (!key) throw new IdentityError(`DTCC Identity does not publish key ${kid}`, 401);
    return key;
  }

  private discover(): Promise<Discovery> {
    this.discovery ??= (async () => {
      const res = await fetch(`${this.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (!res.ok) throw new IdentityError(`DTCC Identity discovery failed (${res.status})`, 502);
      const doc = await res.json() as Discovery;
      if (doc.issuer !== this.issuer) throw new IdentityError(`DTCC Identity reports issuer ${doc.issuer}, expected ${this.issuer}`, 502);
      return doc;
    })().catch(e => {
      this.discovery = undefined;
      throw e instanceof IdentityError ? e : new IdentityError(`DTCC Identity is unreachable: ${(e as Error).message}`, 502);
    });
    return this.discovery;
  }
}
