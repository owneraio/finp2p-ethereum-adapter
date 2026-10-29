import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import {
  ConfigStore, Validator, allFields, createConfigRouter, ethereumAdapterSchema, ethereumAdapterValidators,
} from '../src/services/configuration';

const API_KEY = '3f2a9c4e-7b1d-4e8a-9f60-2c5d8b1e0a74';
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END PRIVATE KEY-----\n';

async function listen(app: express.Application | http.RequestListener): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(app as http.RequestListener);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

async function configApi(validators: Record<string, Validator> = {}) {
  const store = new ConfigStore(ethereumAdapterSchema());
  const app = express();
  app.use('/config', createConfigRouter({ store, validators }));
  const server = await listen(app);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${server.url}/config${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any, text: '' };
  };
  return { store, call, close: server.close };
}

const fireblocksValues = {
  'organization.id': 'bank-us',
  'ledger.provider': 'fireblocks',
  'network.rpcUrl': 'https://rpc.example',
  'fireblocks.apiKey': API_KEY,
  'fireblocks.privateKey': PEM,
  'accounts.escrow': '206',
};

describe('configuration metadata', () => {
  const schema = ethereumAdapterSchema();
  const ids = new Set(allFields(schema).map(f => f.id));

  test('every secret is sealed and every other field is stored', () => {
    for (const f of allFields(schema)) expect(f.treatment).toBe(f.classification === 'secret' ? 'sealed' : 'stored');
  });

  test('field ids and environment variables are unique', () => {
    const fields = allFields(schema);
    expect(new Set(fields.map(f => f.id)).size).toBe(fields.length);
    expect(new Set(fields.map(f => f.env)).size).toBe(fields.length);
  });

  test('every check has a validator and reads only known fields', () => {
    const refs = [...schema.groups.map(g => g.validation), ...allFields(schema).map(f => f.validation)].filter(Boolean);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ethereumAdapterValidators[ref!.ref]).toBeDefined();
      for (const input of ref!.inputs) expect(ids.has(input)).toBe(true);
    }
  });

  test('conditions refer to known fields', () => {
    const walk = (c: any): string[] => !c ? [] : [...(c.field ? [c.field] : []), ...(c.all ?? []).flatMap(walk), ...walk(c.not)];
    for (const g of schema.groups) {
      for (const f of walk(g.when)) expect(ids.has(f)).toBe(true);
      for (const field of g.fields) for (const f of [...walk(field.when), ...walk(typeof field.required === 'object' ? field.required : undefined)]) expect(ids.has(f)).toBe(true);
    }
  });
});

describe('configuration API', () => {
  test('serves the schema', async () => {
    const api = await configApi();
    const { status, body } = await api.call('GET', '/schema');
    expect(status).toBe(200);
    expect(body.groups.map((g: any) => g.id)).toEqual(expect.arrayContaining(['organization', 'network', 'fireblocks', 'taurus']));
    api.close();
  });

  test('a rejected value saves nothing', async () => {
    const api = await configApi();
    const res = await api.call('PUT', '/values', { values: { 'organization.id': 'bank-us', 'fireblocks.apiKey': 'not-a-uuid', 'no.such.field': 'x' } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['fireblocks.apiKey', 'no.such.field']);
    const view = await api.call('GET', '/values');
    expect(view.body.values['organization.id']).toBeUndefined();
    api.close();
  });

  test('a secret comes back only as a fingerprint', async () => {
    const api = await configApi();
    const res = await api.call('PUT', '/values', { values: { 'fireblocks.privateKey': PEM } });
    expect(res.status).toBe(200);
    expect(res.body.values['fireblocks.privateKey']).toEqual({ sealed: true, fingerprint: expect.stringMatching(/^SHA256:[0-9a-f]{16}$/) });
    expect(JSON.stringify(res.body)).not.toContain('MIIEvQ');
    expect(JSON.stringify((await api.call('GET', '/values')).body)).not.toContain('MIIEvQ');
    api.close();
  });

  test('NETWORK_HOST is required with Fireblocks but optional with Taurus', async () => {
    const api = await configApi();
    await api.call('PUT', '/values', { values: { 'ledger.provider': 'taurus' } });
    let problems = (await api.call('GET', '/values')).body.problems;
    expect(problems.find((p: any) => p.ref === 'network.rpcUrl')).toBeUndefined();
    await api.call('PUT', '/values', { values: { 'ledger.provider': 'fireblocks' } });
    problems = (await api.call('GET', '/values')).body.problems;
    expect(problems).toContainEqual(expect.objectContaining({ kind: 'missing', ref: 'network.rpcUrl' }));
    api.close();
  });

  test('a check waits for its required inputs and does not run for an inactive group', async () => {
    const api = await configApi({ fireblocks: async () => ({ status: 'valid', message: 'ok' }), taurus: async () => ({ status: 'valid', message: 'ok' }) });
    await api.call('PUT', '/values', { values: { 'ledger.provider': 'fireblocks', 'fireblocks.apiKey': API_KEY } });
    const waiting = await api.call('POST', '/validate', { group: 'fireblocks' });
    expect(waiting.status).toBe(409);
    expect(waiting.body.missing).toEqual(['fireblocks.privateKey']);
    const inactive = await api.call('POST', '/validate', { group: 'taurus' });
    expect(inactive.status).toBe(409);
    expect((await api.call('POST', '/validate', { group: 'nope' })).status).toBe(404);
    api.close();
  });

  test('apply needs every check passed on the current values', async () => {
    const seen: any[] = [];
    const api = await configApi({
      fireblocks: async (v) => { seen.push(v); return { status: 'valid', message: 'Fireblocks accepted the key' }; },
      'network.rpcUrl': async () => ({ status: 'valid', message: 'chain 11155111' }),
    });
    expect((await api.call('PUT', '/values', { values: fireblocksValues })).status).toBe(200);

    let apply = await api.call('POST', '/apply');
    expect(apply.status).toBe(409);
    expect(apply.body.problems.map((p: any) => p.kind)).toEqual(['unvalidated', 'unvalidated']);

    expect((await api.call('POST', '/validate', { group: 'fireblocks' })).body.status).toBe('valid');
    expect(seen[0]['fireblocks.privateKey']).toBe(PEM);
    expect((await api.call('POST', '/validate', { field: 'network.rpcUrl' })).body.status).toBe('valid');

    await api.call('PUT', '/values', { values: { 'fireblocks.apiKey': '00000000-0000-4000-8000-000000000000' } });
    apply = await api.call('POST', '/apply');
    expect(apply.status).toBe(409);
    expect(apply.body.problems).toEqual([expect.objectContaining({ kind: 'stale', ref: 'fireblocks' })]);

    await api.call('POST', '/validate', { group: 'fireblocks' });
    apply = await api.call('POST', '/apply');
    expect(apply.status).toBe(200);
    expect(apply.body.version).toBe(1);
    expect(api.store.appliedEnvironment()).toEqual(expect.objectContaining({
      PROVIDER_TYPE: 'fireblocks', FIREBLOCKS_API_KEY: '00000000-0000-4000-8000-000000000000', FIREBLOCKS_API_PRIVATE_KEY: PEM,
      FIREBLOCKS_API_BASE_URL: 'https://api.fireblocks.io', NETWORK_HOST: 'https://rpc.example', ASSET_ESCROW_CUSTODY_ACCOUNT_ID: '206',
    }));
    expect(api.store.appliedEnvironment()).not.toHaveProperty('TAURUS_HOST');
    api.close();
  });

  test('check messages never echo a sealed value', async () => {
    const api = await configApi({ fireblocks: async (v) => ({ status: 'invalid', message: `bad key ${v['fireblocks.privateKey']}` }) });
    await api.call('PUT', '/values', { values: fireblocksValues });
    const res = await api.call('POST', '/validate', { group: 'fireblocks' });
    expect(res.body.status).toBe('invalid');
    expect(res.body.message).not.toContain('MIIEvQ');
    expect(res.body.message).toContain('••••');
    api.close();
  });
});

describe('RPC check', () => {
  test('reports the chain id, sending basic auth when credentials are set', async () => {
    let authorization: string | undefined;
    const rpc = await listen((req: http.IncomingMessage, res: http.ServerResponse) => {
      authorization = req.headers.authorization;
      let body = '';
      req.on('data', (c: Buffer) => { body += c; });
      req.on('end', () => {
        const { id } = JSON.parse(body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: '0xaa36a7' }));
      });
    });
    const result = await ethereumAdapterValidators['network.rpcUrl']({ 'network.rpcUrl': rpc.url, 'network.auth': 'user:pass' });
    expect(result.status).toBe('valid');
    expect(result.details).toContainEqual({ label: 'Chain ID', value: '11155111' });
    expect(authorization).toBe(`Basic ${Buffer.from('user:pass').toString('base64')}`);
    rpc.close();
  });

  test('an unreachable RPC is invalid, not an error', async () => {
    const result = await ethereumAdapterValidators['network.rpcUrl']({ 'network.rpcUrl': 'http://127.0.0.1:1' });
    expect(result.status).toBe('invalid');
    expect(result.message).toMatch(/did not answer eth_chainId/);
  });
});
