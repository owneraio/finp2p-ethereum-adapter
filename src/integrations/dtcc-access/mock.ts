import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { createHash, generateKeyPairSync, KeyObject, randomBytes, timingSafeEqual } from "crypto";
import jwt from "jsonwebtoken";

export interface MockUser {
  username: string;
  password: string;
  entity: string;
  scopes: string[];
}

export interface MockServiceAccount {
  clientId: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  entity: string;
  scopes: string[];
}

export interface MockClient {
  clientId: string;
  redirectUris: string[];
}

export interface MockIdentityOptions {
  users: MockUser[];
  serviceAccounts: MockServiceAccount[];
  clients: MockClient[];
  tokenTtlSeconds?: number;
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  challenge: string;
  user: MockUser;
  scopes: string[];
  expiresAt: number;
}

const CODE_TTL_MS = 60_000;
export const GATEWAY_AUDIENCE = 'dtcc-gateway';

const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * Stands in for DTCC Identity (IDT): OIDC discovery and keys, user login by
 * authorization code + PKCE, service-account tokens by client credentials or
 * password, all RS256 tokens carrying the entity and scopes.
 */
export class MockIdentity {
  issuer = '';
  tokenRequests = 0;
  readonly kid = base64url(randomBytes(8));
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly codes = new Map<string, PendingCode>();

  constructor(private readonly options: MockIdentityOptions) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  router(): express.Router {
    const router = express.Router();
    router.use(express.urlencoded({ extended: false }));

    router.get('/.well-known/openid-configuration', (_req, res) => {
      res.json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'client_credentials', 'password'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
        id_token_signing_alg_values_supported: ['RS256'],
      });
    });

    router.get('/jwks', (_req, res) => {
      res.json({ keys: [{ ...this.publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig', alg: 'RS256' }] });
    });

    router.get('/authorize', (req, res) => {
      const params = this.authorizeParams(req.query as Record<string, string>);
      if ('error' in params) {
        res.status(400).json(params);
        return;
      }
      res.type('html').send(this.loginPage(req.query as Record<string, string>));
    });

    router.post('/authorize', (req, res) => {
      const params = this.authorizeParams(req.body);
      if ('error' in params) {
        res.status(400).json(params);
        return;
      }
      const user = this.options.users.find(u => u.username === req.body.username && same(u.password, String(req.body.password ?? '')));
      if (!user) {
        res.status(401).type('html').send(this.loginPage(req.body, 'Unknown user or wrong password'));
        return;
      }
      const requested = String(req.body.scope ?? '').split(' ').filter(Boolean);
      const code = base64url(randomBytes(24));
      this.codes.set(code, {
        clientId: params.clientId, redirectUri: params.redirectUri, challenge: params.challenge, user,
        scopes: requested.length ? requested.filter(s => user.scopes.includes(s)) : user.scopes,
        expiresAt: Date.now() + CODE_TTL_MS,
      });
      const target = new URL(params.redirectUri);
      target.searchParams.set('code', code);
      if (req.body.state) target.searchParams.set('state', req.body.state);
      res.redirect(302, target.toString());
    });

    router.post('/token', (req, res) => {
      this.tokenRequests++;
      const body = req.body as Record<string, string>;
      const fail = (status: number, error: string, description?: string): void => {
        res.status(status).json({ error, error_description: description });
      };

      if (body.grant_type === 'authorization_code') {
        const pending = this.codes.get(body.code);
        this.codes.delete(body.code);
        if (!pending || pending.expiresAt < Date.now()) return void fail(400, 'invalid_grant', 'Unknown or expired code');
        if (pending.clientId !== body.client_id || pending.redirectUri !== body.redirect_uri) return void fail(400, 'invalid_grant', 'Client or redirect URI mismatch');
        if (!body.code_verifier || base64url(createHash('sha256').update(body.code_verifier).digest()) !== pending.challenge) {
          return void fail(400, 'invalid_grant', 'PKCE verification failed');
        }
        return void res.json(this.tokenResponse(pending.user.username, pending.user.entity, pending.scopes, pending.clientId));
      }

      let account: MockServiceAccount | undefined;
      if (body.grant_type === 'client_credentials') {
        const [id, secret] = Buffer.from((req.headers.authorization ?? '').replace(/^Basic\s+/i, ''), 'base64').toString().split(':').map(decodeURIComponent);
        account = this.options.serviceAccounts.find(a => a.clientId === id && a.clientSecret && same(a.clientSecret, secret ?? ''));
      } else if (body.grant_type === 'password') {
        account = this.options.serviceAccounts.find(a => a.clientId === body.client_id && a.username === body.username && a.password && same(a.password, body.password ?? ''));
      } else {
        return void fail(400, 'unsupported_grant_type');
      }
      if (!account) return void fail(401, 'invalid_client', 'Unknown service account or wrong credentials');
      const requested = String(body.scope ?? '').split(' ').filter(Boolean);
      const beyond = requested.filter(s => !account!.scopes.includes(s));
      if (beyond.length) return void fail(400, 'invalid_scope', `Not granted to the service account: ${beyond.join(' ')}`);
      return void res.json(this.tokenResponse(account.clientId, account.entity, requested.length ? requested : account.scopes, GATEWAY_AUDIENCE));
    });

    return router;
  }

  /** Stands in for the DTCC Gateway in front of the AppChain RPC: rejects calls without a valid IDT token, forwards the rest. */
  gateway(upstreamRpcUrl: string): express.Router {
    const router = express.Router();
    router.post('/', express.json({ limit: '5mb' }), async (req, res) => {
      const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      try {
        if (!token) throw new Error('No bearer token');
        jwt.verify(token, this.publicKey, { algorithms: ['RS256'], issuer: this.issuer });
      } catch (e) {
        res.status(401).json({ error: `Gateway rejected the call: ${(e as Error).message}` });
        return;
      }
      const upstream = await fetch(upstreamRpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req.body) });
      res.status(upstream.status).type('json').send(await upstream.text());
    });
    return router;
  }

  async listen(port = 0, upstreamRpcUrl?: string): Promise<{ url: string; gatewayUrl?: string; close: () => Promise<void> }> {
    const app = express();
    app.use('/', this.router());
    if (upstreamRpcUrl) app.use('/gateway/rpc', this.gateway(upstreamRpcUrl));
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    this.issuer = url;
    return {
      url,
      gatewayUrl: upstreamRpcUrl ? `${url}/gateway/rpc` : undefined,
      close: () => new Promise(resolve => server.close(() => resolve())),
    };
  }

  private authorizeParams(q: Record<string, string>): { clientId: string; redirectUri: string; challenge: string } | { error: string; error_description: string } {
    const client = this.options.clients.find(c => c.clientId === q.client_id);
    if (!client || !client.redirectUris.includes(q.redirect_uri)) return { error: 'invalid_request', error_description: 'Unknown client or redirect URI' };
    if (q.response_type !== 'code') return { error: 'unsupported_response_type', error_description: 'Only the authorization code flow is supported' };
    if (!q.code_challenge || q.code_challenge_method !== 'S256') return { error: 'invalid_request', error_description: 'PKCE with S256 is required' };
    return { clientId: client.clientId, redirectUri: q.redirect_uri, challenge: q.code_challenge };
  }

  private tokenResponse(sub: string, entity: string, scopes: string[], audience: string) {
    const ttl = this.options.tokenTtlSeconds ?? 300;
    const access_token = jwt.sign({ entity, scope: scopes.join(' ') }, this.privateKey, {
      algorithm: 'RS256', keyid: this.kid, issuer: this.issuer, subject: sub, audience, expiresIn: ttl, jwtid: base64url(randomBytes(12)),
    });
    return { access_token, token_type: 'Bearer', expires_in: ttl, scope: scopes.join(' ') };
  }

  private loginPage(q: Record<string, string>, error?: string): string {
    const hidden = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope']
      .filter(k => q[k]).map(k => `<input type="hidden" name="${k}" value="${escapeHtml(String(q[k]))}">`).join('');
    return `<!doctype html><title>DTCC Identity (mock)</title><h1>DTCC Identity (mock)</h1>${error ? `<p>${escapeHtml(error)}</p>` : ''}`
      + `<form method="post" action="${this.issuer}/authorize">${hidden}<label>User <input name="username"></label> <label>Password <input name="password" type="password"></label> <button>Sign in</button></form>`;
  }
}
