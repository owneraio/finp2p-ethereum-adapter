/**
 * @jest-environment node
 */

import { FireblocksSDK } from 'fireblocks-sdk';
import { FireblocksAppConfig } from '../src/services/direct/fireblocks-config';
import { FireblocksRawSigner } from '../src/services/direct/fireblocks-raw-signer';
import { FireblocksCustodyProvider } from '../src/services/direct/fireblocks-provider';
import { createVaultManagementFunctions } from '../src/vaults';

jest.mock('@fireblocks/fireblocks-web3-provider', () => ({
  ApiBaseUrl: { Production: 'production' },
  ChainId: { MAINNET: 'mainnet' },
  FireblocksWeb3Provider: jest.fn(),
}));

jest.mock('fireblocks-sdk', () => ({
  FireblocksSDK: jest.fn(),
}));

jest.mock('../src/vaults', () => ({
  createVaultManagementFunctions: jest.fn(),
}));

jest.mock('../src/services/direct/fireblocks-raw-signer', () => ({
  FireblocksRawSigner: jest.fn(),
}));

describe('FireblocksCustodyProvider local submit role validation', () => {
  const providerStub = { label: 'rpc-provider' } as any;
  const signerStub = { label: 'config-signer' } as any;
  const mockFireblocksSdk = FireblocksSDK as unknown as jest.Mock;
  const mockCreateVaultManagementFunctions = createVaultManagementFunctions as jest.MockedFunction<typeof createVaultManagementFunctions>;
  const mockFireblocksRawSigner = FireblocksRawSigner as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFireblocksSdk.mockImplementation(() => ({}));
    mockCreateVaultManagementFunctions.mockReturnValue({
      getVaultIdForAddress: jest.fn(),
    } as any);
    mockFireblocksRawSigner.mockImplementation(({ vaultAccountId }: { vaultAccountId: string }) => ({
      kind: 'fireblocks-raw-signer',
      vaultAccountId,
      getAddress: jest.fn().mockResolvedValue(`0x${vaultAccountId}`),
    }));
  });

  const buildConfig = (overrides: Partial<FireblocksAppConfig> = {}): FireblocksAppConfig => ({
    type: 'fireblocks',
    orgId: 'org-1',
    provider: providerStub,
    signer: signerStub,
    finP2PClient: undefined,
    proofProvider: undefined,
    accountMappingType: 'derivation',
    accountModel: 'segregated',
    apiKey: 'fb-api-key',
    apiPrivateKey: 'fb-private-key',
    chainId: undefined,
    apiBaseUrl: 'https://fireblocks.example',
    assetIssuerVaultId: 'issuer-vault',
    assetEscrowVaultId: 'escrow-vault',
    omnibusVaultId: undefined,
    localSubmit: true,
    gasFunding: undefined,
    ...overrides,
  });

  it('fails fast when issuer wallet config is missing', async () => {
    await expect(FireblocksCustodyProvider.create(buildConfig({
      assetIssuerVaultId: undefined,
    }))).rejects.toThrow('FIREBLOCKS_ASSET_ISSUER_VAULT_ID');
  });

  it('fails fast when escrow wallet config is missing', async () => {
    await expect(FireblocksCustodyProvider.create(buildConfig({
      assetEscrowVaultId: undefined,
    }))).rejects.toThrow('FIREBLOCKS_ASSET_ESCROW_VAULT_ID');
  });

  it('fails fast when omnibus wallet config is missing for omnibus mode', async () => {
    await expect(FireblocksCustodyProvider.create(buildConfig({
      accountModel: 'omnibus',
      omnibusVaultId: undefined,
    }))).rejects.toThrow('FIREBLOCKS_OMNIBUS_VAULT_ID');
  });

  it('creates real local-submit wallets for configured roles', async () => {
    const custodyProvider = await FireblocksCustodyProvider.create(buildConfig({
      accountModel: 'omnibus',
      omnibusVaultId: 'omnibus-vault',
    }));

    expect(mockFireblocksRawSigner).toHaveBeenCalledTimes(3);
    expect(custodyProvider.issuer.provider).toBe(providerStub);
    expect(custodyProvider.issuer.signer).not.toBe(providerStub);
    expect(custodyProvider.escrow.provider).toBe(providerStub);
    expect(custodyProvider.escrow.signer).not.toBe(providerStub);
    expect(custodyProvider.omnibus?.provider).toBe(providerStub);
    expect(custodyProvider.omnibus?.signer).not.toBe(providerStub);
  });
});
