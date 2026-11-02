import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { createHash, randomBytes } from "crypto";
import {
  DtccAccess, IdentityClient, MockIdentity, MockIdentityOptions, ServiceAccountCredentials,
  createDtccAccessRouter, dtccGatewayProvider,
} from "../src/integrations/dtcc-access";

const CHAIN_ID = 1337n;
const REDIRECT_URI = 'http://127.0.0.1/dtcc/callback';

const options: MockIdentityOptions = {
  users: [
    { username: 'alice', password: 'alice-pass', entity: 'MF-0001', scopes: ['tokenization', 'collateral'] },
    { username: 'bob', password: 'bob-pass', entity: 'MF-0002', scopes: ['tokenization'] },
  ],
  serviceAccounts: [{
    clientId: 'connector', clientSecret: 'connector-secret', username: 'connector-user', password: 'Connector-Pass1!',
    entity: 'MF-0001', scopes: ['tokenization', 'collateral'],
  }],
  clients: [{ clientId: 'router-ui', redirectUris: [REDIRECT_URI] }],
};

const clientCredentials: ServiceAccountCredentials = { grant: 'client_credentials', clientId: 'connector', clientSecret: 'connector-secret' };

async function listen(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

const json = (res: Response): Promise<any> => res.json();
const base64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The Router UI's part: authorization code + PKCE at DTCC Identity, returning the user token. */
async function login(issuer: string, username: string, password: string, verifierOverride?: string): Promise<{ status: number; body: any }> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const params = { response_type: 'code', client_id: 'router-ui', redirect_uri: REDIRECT_URI, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };
  const page = await fetch(`${issuer}/authorize?${new URLSearchParams(params)}`);
  expect(page.status).toBe(200);
  const signIn = await fetch(`${issuer}/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...params, username, password }) });
  expect(signIn.status).toBe(302);
  const location = new URL(signIn.headers.get('location')!);
  expect(location.searchParams.get('state')).toBe('xyz');
  const res = await fetch(`${issuer}/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code', code: location.searchParams.get('code')!, redirect_uri: REDIRECT_URI,
      client_id: 'router-ui', code_verifier: verifierOverride ?? verifier,
    }),
  });
  return { status: res.status, body: await res.json() };
}

describe('DTCC access', () => {
  let mock: MockIdentity;
  let identity: { url: string; gatewayUrl?: string; close: () => Promise<void> };
  let rpc: { url: string; close: () => void };
  let rpcCalls = 0;

  beforeAll(async () => {
    rpc = await listen((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c; });
      req.on('end', () => {
        rpcCalls++;
        const calls = JSON.parse(body);
        const answer = (c: any) => ({ jsonrpc: '2.0', id: c.id, result: c.method === 'eth_chainId' ? '0x539' : '0x2a' });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(Array.isArray(calls) ? calls.map(answer) : answer(calls)));
      });
    });
    mock = new MockIdentity(options);
    identity = await mock.listen(0, rpc.url);
  });

  afterAll(async () => {
    await identity.close();
    rpc.close();
  });

  test('the gateway rejects a call without a DTCC Identity token', async () => {
    const res = await fetch(identity.gatewayUrl!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    expect(res.status).toBe(401);
  });

  describe('service-account mode', () => {
    test('reads the chain through the gateway, reusing one token', async () => {
      const access = new DtccAccess(new IdentityClient(identity.url, clientCredentials), { mode: 'service-account', maxDelegationSeconds: 3600 });
      const provider = dtccGatewayProvider(identity.gatewayUrl!, access);
      const before = mock.tokenRequests;
      expect((await provider.getNetwork()).chainId).toBe(CHAIN_ID);
      expect(await provider.getBlockNumber()).toBe(42);
      expect(await provider.send('eth_blockNumber', [])).toBe('0x2a');
      expect(mock.tokenRequests - before).toBe(1);
      provider.destroy();
    });

    test('the password grant from DTCC\'s docs works the same way', async () => {
      const access = new DtccAccess(
        new IdentityClient(identity.url, { grant: 'password', clientId: 'connector', username: 'connector-user', password: 'Connector-Pass1!' }),
        { mode: 'service-account', maxDelegationSeconds: 3600 },
      );
      const provider = dtccGatewayProvider(identity.gatewayUrl!, access, CHAIN_ID);
      expect(await provider.getBlockNumber()).toBe(42);
      provider.destroy();
    });

    test('a wrong secret fails the call with the reason from DTCC Identity', async () => {
      const access = new DtccAccess(new IdentityClient(identity.url, { ...clientCredentials, clientSecret: 'wrong' }), { mode: 'service-account', maxDelegationSeconds: 3600 });
      const provider = dtccGatewayProvider(identity.gatewayUrl!, access, CHAIN_ID);
      await expect(provider.getBlockNumber()).rejects.toThrow(/refused the service account \(401 invalid_client/);
      provider.destroy();
    });
  });

  describe('delegated mode', () => {
    let now = Date.now();
    let access: DtccAccess;
    let api: { url: string; close: () => void };

    beforeEach(async () => {
      now = Date.now();
      access = new DtccAccess(new IdentityClient(identity.url, clientCredentials), {
        mode: 'delegated', maxDelegationSeconds: 3600, userAudience: 'router-ui', now: () => now,
      });
      const app = express();
      app.use('/dtcc', createDtccAccessRouter(access));
      api = await listen(app);
    });

    afterEach(() => api.close());

    const delegate = (userToken: string, body: object) => fetch(`${api.url}/dtcc/delegation`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${userToken}` }, body: JSON.stringify(body),
    });

    test('calls fail until a user delegates, run under the delegation, and stop when it is revoked', async () => {
      const provider = dtccGatewayProvider(identity.gatewayUrl!, access, CHAIN_ID);
      await expect(provider.send('eth_blockNumber', [])).rejects.toThrow(/needs a user delegation/);

      const { status, body } = await login(identity.url, 'alice', 'alice-pass');
      expect(status).toBe(200);
      const granted = await delegate(body.access_token, { windowSeconds: 600, scopes: ['tokenization'] });
      expect(granted.status).toBe(201);
      expect((await json(granted)).delegation).toEqual(expect.objectContaining({ subject: 'alice', entity: 'MF-0001', scopes: ['tokenization'] }));

      const calls = rpcCalls;
      expect(await provider.send('eth_blockNumber', [])).toBe('0x2a');
      expect(rpcCalls).toBeGreaterThan(calls);
      expect((await json(await fetch(`${api.url}/dtcc/delegation`))).delegation.subject).toBe('alice');

      expect((await fetch(`${api.url}/dtcc/delegation`, { method: 'DELETE' })).status).toBe(204);
      await expect(provider.send('eth_blockNumber', [])).rejects.toThrow(/needs a user delegation/);
      provider.destroy();
    });

    test('a delegation ends with its window', async () => {
      const { body } = await login(identity.url, 'alice', 'alice-pass');
      expect((await delegate(body.access_token, { windowSeconds: 60 })).status).toBe(201);
      expect(await access.token()).toBeTruthy();
      now += 61_000;
      await expect(access.token()).rejects.toThrow(/needs a user delegation/);
      expect((await json(await fetch(`${api.url}/dtcc/delegation`))).delegation).toBeNull();
    });

    test('a delegation never exceeds the user', async () => {
      const alice = (await login(identity.url, 'alice', 'alice-pass')).body.access_token;
      const bob = (await login(identity.url, 'bob', 'bob-pass')).body.access_token;

      const beyondScopes = await delegate(bob, { windowSeconds: 600, scopes: ['collateral'] });
      expect(beyondScopes.status).toBe(403);
      expect((await json(beyondScopes)).error).toMatch(/does not hold the scopes collateral/);

      const otherEntity = await delegate(bob, { windowSeconds: 600 });
      expect(otherEntity.status).toBe(403);
      expect((await json(otherEntity)).error).toMatch(/acts for entity MF-0002, but the service account belongs to MF-0001/);

      expect((await delegate(alice, { windowSeconds: 7200 })).status).toBe(400);
      expect(access.delegation()).toBeUndefined();
    });

    test('only tokens signed by DTCC Identity for the Router UI are accepted', async () => {
      const alice = (await login(identity.url, 'alice', 'alice-pass')).body.access_token;
      const [h, p, s] = alice.split('.');
      const forged = [h, base64url(Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), entity: 'MF-0001', sub: 'mallory' }))), s].join('.');
      expect((await delegate(forged, { windowSeconds: 600 })).status).toBe(401);

      const serviceToken = await new IdentityClient(identity.url, clientCredentials).serviceAccountToken();
      const wrongAudience = await delegate(serviceToken.token, { windowSeconds: 600 });
      expect(wrongAudience.status).toBe(401);
      expect((await json(wrongAudience)).error).toMatch(/audience/);

      const missing = await fetch(`${api.url}/dtcc/delegation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"windowSeconds":600}' });
      expect(missing.status).toBe(401);
    });
  });

  describe('DTCC Identity mock', () => {
    test('PKCE: the code only redeems with its verifier', async () => {
      const res = await login(identity.url, 'alice', 'alice-pass', base64url(randomBytes(32)));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_grant');
    });

    test('a service account cannot ask for scopes it was not granted', async () => {
      await expect(new IdentityClient(identity.url, clientCredentials).serviceAccountToken('settlement')).rejects.toThrow(/invalid_scope/);
    });

    test('a wrong password does not sign in', async () => {
      const params = { response_type: 'code', client_id: 'router-ui', redirect_uri: REDIRECT_URI, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', username: 'alice', password: 'nope' };
      const res = await fetch(`${identity.url}/authorize`, { method: 'POST', redirect: 'manual', body: new URLSearchParams(params) });
      expect(res.status).toBe(401);
    });
  });
});
