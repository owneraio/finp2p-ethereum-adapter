import console from "console";
import { readFileSync } from "node:fs";
import process from "process";
import { MockIdentity, MockIdentityOptions } from "../src/integrations/dtcc-access";

// Local stand-in for DTCC Identity and the Gateway in front of an AppChain RPC.
// DTCC_MOCK_CONFIG: JSON file with users, serviceAccounts and clients (defaults below).
// DTCC_MOCK_UPSTREAM_RPC: when set, /gateway/rpc forwards authenticated JSON-RPC calls to it.

const DEFAULTS: MockIdentityOptions = {
  users: [{ username: 'operator', password: 'operator-pass', entity: 'MF-0001', scopes: ['tokenization', 'collateral'] }],
  serviceAccounts: [{
    clientId: 'ownera-connector', clientSecret: 'connector-secret',
    username: 'ownera-connector', password: 'Connector-Pass1!',
    entity: 'MF-0001', scopes: ['tokenization', 'collateral'],
  }],
  clients: [{ clientId: 'router-ui', redirectUris: ['http://localhost:3000/dtcc/callback'] }],
};

async function main() {
  const configPath = process.env.DTCC_MOCK_CONFIG;
  const port = Number(process.env.DTCC_MOCK_PORT || 3200);
  const upstreamRpcUrl = process.env.DTCC_MOCK_UPSTREAM_RPC || undefined;
  const options: MockIdentityOptions = configPath ? JSON.parse(readFileSync(configPath, 'utf8')) : DEFAULTS;

  const mock = new MockIdentity(options);
  const { url, gatewayUrl } = await mock.listen(port, upstreamRpcUrl);
  console.log(`DTCC Identity (mock): ${url}`);
  console.log(`  DTCC_IDT_ISSUER=${url}`);
  if (gatewayUrl) console.log(`  NETWORK_HOST=${gatewayUrl}  (forwards to ${upstreamRpcUrl})`);
  if (!configPath) console.log('  using the built-in example users and service account; set DTCC_MOCK_CONFIG to use your own');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
