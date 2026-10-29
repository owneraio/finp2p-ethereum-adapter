import { Condition, ConfigSchema, FieldMeta, ValidationRef } from './schema';

export const VALIDATE_PATH = '/config/validate';

const UUID = { pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$', message: 'Expected a UUID, like 3f2a9c4e-7b1d-4e8a-9f60-2c5d8b1e0a74.' };
const URL = { pattern: '^https?://\\S+$', message: 'Expected a URL starting with http:// or https://.' };
const ADDRESS = { pattern: '^0x[0-9a-fA-F]{40}$', message: 'Expected an address: 0x followed by 40 hex characters.' };
const HEX_KEY = { pattern: '^(0x)?[0-9a-fA-F]{64}$', message: 'Expected a private key: 64 hex characters, optionally prefixed with 0x.' };
const HEX = { pattern: '^[0-9a-fA-F]+$', message: 'Expected hex characters only.' };
const PEM = { pattern: '^\\s*-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]+-----END [A-Z ]*PRIVATE KEY-----\\s*$', message: 'Expected a PEM private key, from -----BEGIN … PRIVATE KEY----- to -----END … PRIVATE KEY-----.' };
const INTEGER = { pattern: '^\\d+$', message: 'Expected a whole number.' };
const DECIMAL = { pattern: '^\\d+(\\.\\d+)?$', message: 'Expected a number, like 0.01.' };

const field = (f: Omit<FieldMeta, 'treatment'>): FieldMeta => ({ ...f, treatment: f.classification === 'secret' ? 'sealed' : 'stored' });
const check = (ref: string, scope: ValidationRef['scope'], inputs: string[], description: string): ValidationRef => ({ ref, scope, path: VALIDATE_PATH, inputs, description });
const provider = (...types: string[]): Condition => ({ field: 'ledger.provider', in: types });
const CUSTODY = ['fireblocks', 'dfns', 'taurus'];

/** The Ethereum adapter's configuration: one field per environment variable it reads today. */
export function ethereumAdapterSchema(): ConfigSchema {
  return {
    schemaVersion: 1,
    component: 'finp2p-ethereum-adapter',
    groups: [
      {
        id: 'organization', title: 'Organization', critical: true,
        description: 'Who runs this adapter and how it keeps balances.',
        fields: [
          field({ id: 'organization.id', env: 'ORGANIZATION_ID', label: 'Organization ID', type: 'string', classification: 'public', required: true,
            help: 'The FinP2P organization that owns this adapter.' }),
          field({ id: 'organization.accountModel', env: 'ACCOUNT_MODEL', label: 'Account model', type: 'enum', classification: 'public', required: false, default: 'segregated',
            options: [{ value: 'segregated', label: 'Segregated: one wallet per investor' }, { value: 'omnibus', label: 'Omnibus: one wallet, balances kept by the adapter' }] }),
        ],
      },
      {
        id: 'router', title: 'FinP2P router', critical: false,
        description: 'Where the adapter reaches the FinP2P router and its OSS.',
        fields: [
          field({ id: 'router.address', env: 'FINP2P_ADDRESS', label: 'Router URL', type: 'url', classification: 'public', required: provider('finp2p-contract'), format: URL }),
          field({ id: 'router.ossUrl', env: 'OSS_URL', label: 'OSS URL', type: 'url', classification: 'public', required: provider('finp2p-contract'), format: URL }),
        ],
      },
      {
        id: 'ledger', title: 'Signing', critical: true,
        description: 'How the adapter signs: with its own operator key, or through a custody provider.',
        fields: [
          field({ id: 'ledger.provider', env: 'PROVIDER_TYPE', label: 'Signing', type: 'enum', classification: 'public', required: true, default: 'finp2p-contract',
            options: [
              { value: 'finp2p-contract', label: 'Operator key, FinP2P contract' },
              { value: 'fireblocks', label: 'Fireblocks' },
              { value: 'dfns', label: 'DFNS' },
              { value: 'taurus', label: 'Taurus PROTECT' }] }),
        ],
      },
      {
        id: 'network', title: 'Network', critical: true,
        description: 'The Ethereum RPC the adapter reads the chain from and, with an operator key, submits to.',
        fields: [
          field({ id: 'network.rpcUrl', env: 'NETWORK_HOST', label: 'RPC URL', type: 'url', classification: 'confidential', format: URL,
            required: provider('finp2p-contract', 'fireblocks', 'dfns'),
            help: 'Optional with Taurus: PROTECT serves chain reads. When set, it must be the same chain.',
            validation: check('network.rpcUrl', 'field', ['network.rpcUrl', 'network.auth'], 'Calls eth_chainId on the RPC and reports the chain.') }),
          field({ id: 'network.auth', env: 'NETWORK_AUTH', label: 'RPC credentials', type: 'string', classification: 'secret', required: false,
            placeholder: 'user:password', help: 'Only if the RPC requires basic authentication.' }),
        ],
      },
      {
        id: 'contract', title: 'FinP2P contract', critical: true, when: provider('finp2p-contract'),
        description: 'The FinP2P contract and the operator key that calls it.',
        fields: [
          field({ id: 'contract.address', env: 'FINP2P_CONTRACT_ADDRESS', label: 'Contract address', type: 'address', classification: 'public', required: true, format: ADDRESS }),
          field({ id: 'contract.operatorKey', env: 'OPERATOR_PRIVATE_KEY', label: 'Operator private key', type: 'string', classification: 'secret', required: true, format: HEX_KEY }),
        ],
        validation: check('contract', 'group', ['network.rpcUrl', 'network.auth', 'contract.address', 'contract.operatorKey'],
          'Checks a contract is deployed at the address on the RPC\'s chain and derives the operator address from the key.'),
      },
      {
        id: 'fireblocks', title: 'Fireblocks', critical: true, when: provider('fireblocks'),
        description: 'The Fireblocks workspace and the API user the adapter signs with.',
        fields: [
          field({ id: 'fireblocks.apiBaseUrl', env: 'FIREBLOCKS_API_BASE_URL', label: 'Workspace', type: 'enum', classification: 'public', required: false, default: 'https://api.fireblocks.io',
            options: [
              { value: 'https://api.fireblocks.io', label: 'Production · api.fireblocks.io' },
              { value: 'https://sandbox-api.fireblocks.io', label: 'Sandbox · sandbox-api.fireblocks.io' },
              { value: 'https://eu-api.fireblocks.io/v1', label: 'Production EU · eu-api.fireblocks.io' },
              { value: 'https://eu2-api.fireblocks.io/v1', label: 'Production EU2 · eu2-api.fireblocks.io' }] }),
          field({ id: 'fireblocks.apiKey', env: 'FIREBLOCKS_API_KEY', label: 'API key', type: 'string', classification: 'confidential', required: true, format: UUID }),
          field({ id: 'fireblocks.privateKey', env: 'FIREBLOCKS_API_PRIVATE_KEY', label: 'API private key', type: 'text', classification: 'secret', required: true, format: PEM,
            help: 'The .key file created with the API user.' }),
          field({ id: 'fireblocks.chainId', env: 'FIREBLOCKS_CHAIN_ID', label: 'Chain ID', type: 'integer', classification: 'public', required: false, default: '1', format: INTEGER }),
        ],
        validation: check('fireblocks', 'group', ['fireblocks.apiBaseUrl', 'fireblocks.apiKey', 'fireblocks.privateKey'],
          'Signs a read-only request with the API key and lists one vault account.'),
      },
      {
        id: 'dfns', title: 'DFNS', critical: true, when: provider('dfns'),
        description: 'The DFNS organization, its service account and the credential that signs.',
        fields: [
          field({ id: 'dfns.baseUrl', env: 'DFNS_BASE_URL', label: 'API URL', type: 'url', classification: 'public', required: false, default: 'https://api.dfns.io', format: URL }),
          field({ id: 'dfns.orgId', env: 'DFNS_ORG_ID', label: 'Organization ID', type: 'string', classification: 'confidential', required: true,
            format: { pattern: '^or-[a-z0-9-]+$', message: 'DFNS organization IDs start with or-.' } }),
          field({ id: 'dfns.authToken', env: 'DFNS_AUTH_TOKEN', label: 'Service account token', type: 'text', classification: 'secret', required: true,
            format: { pattern: '^[\\w-]+\\.[\\w-]+\\.[\\w-]+$', message: 'A service account token is a JWT: three parts separated by dots.' } }),
          field({ id: 'dfns.credId', env: 'DFNS_CRED_ID', label: 'Credential ID', type: 'string', classification: 'confidential', required: true }),
          field({ id: 'dfns.privateKey', env: 'DFNS_PRIVATE_KEY', label: 'Credential private key', type: 'text', classification: 'secret', required: true, format: PEM }),
        ],
        validation: check('dfns', 'group', ['dfns.baseUrl', 'dfns.orgId', 'dfns.authToken', 'dfns.credId', 'dfns.privateKey'],
          'Lists one wallet with the service account token. The credential key is checked for format; its first signed request confirms it.'),
      },
      {
        id: 'taurus', title: 'Taurus PROTECT', critical: true, when: provider('taurus'),
        description: 'The PROTECT instance and API key the adapter submits requests with.',
        fields: [
          field({ id: 'taurus.host', env: 'TAURUS_HOST', label: 'Instance URL', type: 'url', classification: 'public', required: true, format: URL }),
          field({ id: 'taurus.apiKey', env: 'TAURUS_API_KEY', label: 'API key', type: 'string', classification: 'confidential', required: true, format: UUID }),
          field({ id: 'taurus.apiSecret', env: 'TAURUS_API_SECRET', label: 'API secret', type: 'string', classification: 'secret', required: true, format: HEX }),
          field({ id: 'taurus.authScheme', env: 'TAURUS_AUTH_SCHEME', label: 'Auth scheme', type: 'enum', classification: 'public', required: false, default: 'TPV1',
            options: [{ value: 'TPV1', label: 'TPV1 · PROTECT' }, { value: 'TDXV1', label: 'TDXV1 · Taurus-NETWORK' }] }),
          field({ id: 'taurus.blockchain', env: 'TAURUS_BLOCKCHAIN', label: 'Blockchain', type: 'string', classification: 'public', required: false, default: 'ETH' }),
          field({ id: 'taurus.network', env: 'TAURUS_NETWORK', label: 'Network', type: 'string', classification: 'public', required: false, default: 'mainnet',
            help: 'As PROTECT names it; the check reports the chain it really is.' }),
          field({ id: 'taurus.operationMode', env: 'TAURUS_OPERATION_MODE', label: 'Operation mode', type: 'enum', classification: 'public', required: false, default: 'transfer-only',
            options: [{ value: 'transfer-only', label: 'Transfers only' }, { value: 'contract-call', label: 'Contract calls' }] }),
          field({ id: 'taurus.operatorKey', env: 'TAURUS_OPERATOR_PRIVATE_KEY', label: 'Approver key', type: 'text', classification: 'secret', required: false,
            help: 'Key of a RequestApprover service account. Without it, requests wait for a human approver.' }),
        ],
        validation: check('taurus', 'group', ['taurus.host', 'taurus.apiKey', 'taurus.apiSecret', 'taurus.authScheme', 'taurus.blockchain', 'taurus.network'],
          'Signs a read-only request and reads the chain PROTECT reports for the blockchain and network.'),
      },
      {
        id: 'accounts', title: 'Custody accounts', critical: true, when: provider(...CUSTODY),
        description: 'The custody accounts the adapter uses for escrow, omnibus balances and gas.',
        fields: [
          field({ id: 'accounts.escrow', env: 'ASSET_ESCROW_CUSTODY_ACCOUNT_ID', label: 'Escrow account ID', type: 'string', classification: 'public',
            required: { all: [provider('fireblocks', 'dfns'), { not: { field: 'organization.accountModel', equals: 'omnibus' } }] },
            help: 'Holds escrowed assets. With the omnibus model, the omnibus account is used when this is empty.' }),
          field({ id: 'accounts.omnibus', env: 'OMNIBUS_CUSTODY_ACCOUNT_ID', label: 'Omnibus account ID', type: 'string', classification: 'public',
            required: { field: 'organization.accountModel', equals: 'omnibus' } }),
          field({ id: 'accounts.gasFunding', env: 'GAS_FUNDING_CUSTODY_ACCOUNT_ID', label: 'Gas funding account ID', type: 'string', classification: 'public', required: false }),
          field({ id: 'accounts.gasAmount', env: 'GAS_FUNDING_AMOUNT', label: 'Gas top-up amount', type: 'decimal', classification: 'public', format: DECIMAL,
            required: { field: 'accounts.gasFunding' }, help: 'Native coin sent to a wallet that runs low. Required once a gas funding account is set.' }),
          field({ id: 'accounts.issuerKey', env: 'ASSET_ISSUER_PRIVATE_KEY', label: 'Issuer private key', type: 'string', classification: 'secret', required: false, format: HEX_KEY,
            help: 'Needed to deploy and issue tokens.' }),
        ],
      },
    ],
  };
}
