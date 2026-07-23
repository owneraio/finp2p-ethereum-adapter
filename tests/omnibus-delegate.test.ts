import { OmnibusDelegate } from '../src/services/omnibus/omnibus-delegate';
import { CustodyProvider, CustodyWallet } from '../src/services/custody/custody-provider';
import { AccountResolver, AssetStore } from '../src/services/accounts/account-resolver';
import { tokenStandardRegistry } from '../src/integrations/token-standards/registry';
import winston from 'winston';

// The delegate talks to token standards only through the TokenStandard SPI, so the
// test mocks the standard, not any plugin internals (mocking the plugin's ERC20
// contract wrapper couples the test to plugin implementation details — the rc that
// switched to its own contract class + on-chain decimals reader broke exactly that).
const ERC20 = 'ERC20';
const mockStandard = {
  deploy: jest.fn(),
  decimals: jest.fn(),
  balanceOf: jest.fn(),
  mint: jest.fn(),
  transfer: jest.fn(),
  burn: jest.fn(),
  hold: jest.fn(),
  release: jest.fn(),
};
tokenStandardRegistry.register(ERC20, mockStandard as any);

const ok = (transactionId: string) => ({ status: 'success' as const, transactionId, timestamp: 1700000000 });
const fail = (reason: string) => ({ status: 'failure' as const, reason });

const mockGetAsset = jest.fn();
const mockSaveAsset = jest.fn();

const logger = winston.createLogger({ silent: true });

function createMockSigner(address: string) {
  return { getAddress: jest.fn().mockResolvedValue(address) } as any;
}

function createMockWallet(address: string): CustodyWallet {
  return {
    provider: {} as any,
    signer: createMockSigner(address),
  };
}

const mockReadProvider = {
  waitForTransaction: jest.fn(),
  getBlock: jest.fn(),
  getNetwork: jest.fn().mockResolvedValue({ chainId: 11155111n, name: 'sepolia' }),
} as any;

function createMockCustodyProvider(overrides: Partial<CustodyProvider> = {}): CustodyProvider {
  return {
    resolveWallet: jest.fn(),
    ...overrides,
  };
}

function createMockAccountMapping(): AccountResolver {
  return {
    resolveAccount: jest.fn(),
    resolveFinId: jest.fn(),
  };
}

const TEST_ASSET = {
  assetId: 'test-asset-123',
  assetType: 'finp2p' as const,
  ledgerIdentifier: { assetIdentifierType: 'CAIP-19' as const, network: '', tokenId: '', standard: ERC20 },
};
const TEST_DB_ASSET = {
  id: TEST_ASSET.assetId,
  type: TEST_ASSET.assetType,
  contract_address: '0xTOKEN_CONTRACT',
  decimals: 6,
  token_standard: ERC20,
};

describe('OmnibusDelegate', () => {
  let delegate: OmnibusDelegate;
  let custodyProvider: CustodyProvider;
  let accountMapping: AccountResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAsset.mockResolvedValue(TEST_DB_ASSET);
    mockSaveAsset.mockResolvedValue(undefined);

    custodyProvider = createMockCustodyProvider();
    accountMapping = createMockAccountMapping();
    const mockAssetStore = { getAsset: mockGetAsset, saveAsset: mockSaveAsset } as unknown as AssetStore;
    delegate = new OmnibusDelegate(logger, custodyProvider, createMockWallet('0xOMNIBUS'), createMockWallet('0xESCROW'), mockReadProvider, undefined, accountMapping, mockAssetStore);
  });

  it('should throw when constructed without an omnibus wallet', () => {
    const mockAssetStore = { getAsset: jest.fn(), saveAsset: jest.fn() } as unknown as AssetStore;
    expect(() => new OmnibusDelegate(logger, custodyProvider, undefined as any, createMockWallet('0xESCROW'), mockReadProvider, undefined, accountMapping, mockAssetStore))
      .toThrow('Omnibus wallet is required');
  });

  describe('getOmnibusBalance', () => {
    it('returns the balance string the standard reports', async () => {
      mockStandard.balanceOf.mockResolvedValue('1.5');
      const balance = await delegate.getOmnibusBalance(TEST_ASSET.assetId, TEST_ASSET.assetType);
      expect(balance).toBe('1.5');
    });

    it('reads via the injected read provider and the omnibus address', async () => {
      mockStandard.balanceOf.mockResolvedValue('0.0');
      await delegate.getOmnibusBalance(TEST_ASSET.assetId, TEST_ASSET.assetType);
      // arg0 = the single read-only provider (not the omnibus custody transport); arg3 = omnibus address
      expect(mockStandard.balanceOf).toHaveBeenCalledWith(mockReadProvider, expect.anything(), expect.anything(), '0xOMNIBUS', expect.anything());
    });
  });

  describe('outboundTransfer', () => {
    it('should transfer to resolved destination address', async () => {
      mockStandard.transfer.mockResolvedValue(ok('0xTX_HASH'));
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue('0xDEST_ADDRESS');

      const result = await delegate.outboundTransfer(
        'idem-1',
        { finId: 'source-fin-id' } as any,
        { finId: 'dest-fin-id' } as any,
        TEST_ASSET,
        '1.5',
        undefined,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.transactionId).toBe('0xTX_HASH');
      // standard.transfer(omnibusWallet, asset, to, amount, logger); amount = parseUnits('1.5', 6)
      expect(mockStandard.transfer).toHaveBeenCalledWith(expect.anything(), expect.anything(), '0xDEST_ADDRESS', 1500000n, expect.anything());
    });

    it('should use crypto address directly when the finId is unmapped', async () => {
      mockStandard.transfer.mockResolvedValue(ok('0xTX_HASH'));
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue(undefined);

      const result = await delegate.outboundTransfer(
        'idem-2',
        { finId: 'source-fin-id' } as any,
        { finId: 'dest-fin-id', account: { type: 'crypto', address: '0xDIRECT_ADDR' } } as any,
        TEST_ASSET,
        '2.0',
        undefined,
      );

      expect(result.success).toBe(true);
      expect(mockStandard.transfer).toHaveBeenCalledWith(expect.anything(), expect.anything(), '0xDIRECT_ADDR', 2000000n, expect.anything());
    });

    it('should propagate a standard-level failure', async () => {
      mockStandard.transfer.mockResolvedValue(fail('transfer reverted'));
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue('0xDEST');

      const result = await delegate.outboundTransfer(
        'idem-3',
        {} as any,
        { finId: 'dest' } as any,
        TEST_ASSET,
        '1.0',
        undefined,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('transfer reverted');
    });
  });

  describe('hold', () => {
    it('should hold from omnibus to escrow via the standard', async () => {
      mockStandard.hold.mockResolvedValue(ok('0xHOLD_TX'));

      const result = await delegate.hold(
        'idem-hold',
        {} as any, undefined,
        TEST_ASSET, '10.0', 'op-1', undefined,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.transactionId).toBe('0xHOLD_TX');
      // standard.hold(omnibusWallet, escrowWallet, asset, amount, logger)
      const call = mockStandard.hold.mock.calls[0];
      expect(await call[0].signer.getAddress()).toBe('0xOMNIBUS'); // source wallet
      expect(await call[1].signer.getAddress()).toBe('0xESCROW');  // escrow wallet
      expect(call[3]).toBe(10000000n);
    });
  });

  describe('release', () => {
    it('releases to the omnibus address when the destination is locally mapped', async () => {
      mockStandard.release.mockResolvedValue(ok('0xRELEASE_TX'));
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue('0xLOCAL_INVESTOR');

      const result = await delegate.release(
        'idem-release',
        {} as any,
        { finId: 'local-investor-finId' } as any,
        TEST_ASSET, '5.0', 'op-2', undefined,
      );

      expect(result.success).toBe(true);
      // standard.release(escrowWallet, asset, onChainTarget, amount, logger)
      expect(mockStandard.release).toHaveBeenCalledWith(expect.anything(), expect.anything(), '0xOMNIBUS', 5000000n, expect.anything());
    });

    it('releases to the external counterparty address when the destination is unmapped', async () => {
      mockStandard.release.mockResolvedValue(ok('0xCROSS_ORG_TX'));
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue(undefined);

      const result = await delegate.release(
        'idem-release-cross-org',
        {} as any,
        { finId: 'remote-org-finId', account: { type: 'crypto', address: '0xREMOTE_ORG_OMNIBUS' } } as any,
        TEST_ASSET, '7.0', 'op-cross', undefined,
      );

      expect(result.success).toBe(true);
      expect(mockStandard.release).toHaveBeenCalledWith(expect.anything(), expect.anything(), '0xREMOTE_ORG_OMNIBUS', 7000000n, expect.anything());
    });

    it('should fail cleanly when neither local mapping nor external address is provided', async () => {
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue(undefined);

      const result = await delegate.release(
        'idem-release-bad',
        {} as any,
        { finId: 'unknown-finId' } as any,
        TEST_ASSET, '1.0', 'op-bad', undefined,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('Cannot resolve release destination');
      expect(mockStandard.release).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('should release from escrow back to the omnibus', async () => {
      mockStandard.release.mockResolvedValue(ok('0xROLLBACK_TX'));

      const result = await delegate.rollback(
        'idem-rollback',
        {} as any,
        TEST_ASSET, '3.0', 'op-3', undefined,
      );

      expect(result.success).toBe(true);
      expect(mockStandard.release).toHaveBeenCalledWith(expect.anything(), expect.anything(), '0xOMNIBUS', 3000000n, expect.anything());
    });
  });

  describe('createAsset', () => {
    it('should deploy via the standard when no tokenIdentifier provided', async () => {
      mockStandard.deploy.mockResolvedValue({ contractAddress: '0xNEW_TOKEN', decimals: 2, tokenStandard: ERC20 });

      const result = await delegate.createAsset(
        'idem-create', TEST_ASSET.assetId, undefined,
        undefined, 'TestCoin', undefined, undefined,
      );

      expect(mockStandard.deploy).toHaveBeenCalled();
      expect(result.ledgerIdentifier.tokenId).toBe('0xNEW_TOKEN');
      expect(result.ledgerIdentifier.network).toBe('eip155:11155111');
      expect(mockSaveAsset).toHaveBeenCalledWith(expect.objectContaining({
        contract_address: '0xNEW_TOKEN',
        id: TEST_ASSET.assetId,
      }));
    });

    it('should bind an existing token and read decimals via the standard', async () => {
      mockStandard.decimals.mockResolvedValue(8);

      const result = await delegate.createAsset(
        'idem-create-2', TEST_ASSET.assetId,
        { tokenIdentifier: { tokenId: '0xEXISTING_TOKEN', network: 'eip155:42161' } } as any,
        undefined, 'TestCoin', undefined, undefined,
      );

      expect(result.ledgerIdentifier.tokenId).toBe('0xEXISTING_TOKEN');
      expect(result.ledgerIdentifier.network).toBe('eip155:42161');
      expect(mockStandard.deploy).not.toHaveBeenCalled();
      // decimals read through the standard SPI against the read provider
      expect(mockStandard.decimals).toHaveBeenCalledWith(mockReadProvider, '0xEXISTING_TOKEN', expect.anything());
      expect(mockSaveAsset).toHaveBeenCalledWith(expect.objectContaining({
        contract_address: '0xEXISTING_TOKEN',
        decimals: 8,
      }));
    });

    it('should fall back to chain-derived network when bind omits it', async () => {
      mockStandard.decimals.mockResolvedValue(6);

      const result = await delegate.createAsset(
        'idem-create-3', TEST_ASSET.assetId,
        { tokenIdentifier: { tokenId: '0xANY' } } as any,
        undefined, undefined, undefined, undefined,
      );

      expect(result.ledgerIdentifier.network).toBe('eip155:11155111');
    });
  });
});
