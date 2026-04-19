import { OmnibusDelegate } from '../src/services/direct/omnibus-delegate';
import { CustodyProvider, CustodyWallet } from '../src/services/direct/custody-provider';
import { AccountMappingService, AssetStore } from '../src/services/direct/account-mapping';
import { tokenStandardRegistry, ERC20TokenStandard, ERC20_TOKEN_STANDARD } from '../src/services/direct';
import winston from 'winston';

tokenStandardRegistry.register(ERC20_TOKEN_STANDARD, new ERC20TokenStandard());

// Mock @owneraio/finp2p-contracts
const mockBalanceOf = jest.fn();
const mockTransfer = jest.fn();
const mockDeployERC20Detached = jest.fn();
jest.mock('@owneraio/finp2p-contracts', () => ({
  ERC20Contract: jest.fn().mockImplementation(() => ({
    balanceOf: mockBalanceOf,
    transfer: mockTransfer,
  })),
  ContractsManager: jest.fn().mockImplementation(() => ({
    deployERC20: mockDeployERC20Detached,
  })),
}));

// Mock asset store
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

function createMockCustodyProvider(overrides: Partial<CustodyProvider> = {}): CustodyProvider {
  return {
    issuer: createMockWallet('0xISSUER'),
    escrow: createMockWallet('0xESCROW'),
    omnibus: createMockWallet('0xOMNIBUS'),
    rpcProvider: {
      waitForTransaction: jest.fn(),
      getBlock: jest.fn(),
    } as any,
    resolveWallet: jest.fn(),
    ...overrides,
  };
}

function createMockAccountMapping(): AccountMappingService {
  return {
    resolveAccount: jest.fn(),
    resolveFinId: jest.fn(),
  };
}

const TEST_ASSET = {
  assetId: 'test-asset-123',
  assetType: 'finp2p' as const,
  ledgerIdentifier: { assetIdentifierType: 'CAIP-19' as const, network: '', tokenId: '', standard: 'ERC20' },
};
const TEST_DB_ASSET = {
  id: TEST_ASSET.assetId,
  type: TEST_ASSET.assetType,
  contract_address: '0xTOKEN_CONTRACT',
  decimals: 6,
  token_standard: 'ERC20',
};

describe('OmnibusDelegate', () => {
  let delegate: OmnibusDelegate;
  let custodyProvider: CustodyProvider;
  let accountMapping: AccountMappingService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAsset.mockResolvedValue(TEST_DB_ASSET);
    mockSaveAsset.mockResolvedValue(undefined);

    custodyProvider = createMockCustodyProvider();
    accountMapping = createMockAccountMapping();
    const mockAssetStore = { getAsset: mockGetAsset, saveAsset: mockSaveAsset } as unknown as AssetStore;
    delegate = new OmnibusDelegate(logger, custodyProvider, accountMapping, mockAssetStore);
  });

  it('should throw if custody provider has no omnibus wallet', () => {
    const noOmnibus = createMockCustodyProvider({ omnibus: undefined });
    const mockAssetStore = { getAsset: jest.fn(), saveAsset: jest.fn() } as unknown as AssetStore;
    expect(() => new OmnibusDelegate(logger, noOmnibus, accountMapping, mockAssetStore))
      .toThrow('Omnibus wallet is required');
  });

  describe('getOmnibusBalance', () => {
    it('should return decimal-formatted string (vanilla-service uses PG NUMERIC)', async () => {
      // 1.5 tokens with 6 decimals = 1500000 smallest units on-chain
      mockBalanceOf.mockResolvedValue(1500000n);

      const balance = await delegate.getOmnibusBalance(TEST_ASSET.assetId, TEST_ASSET.assetType);

      expect(balance).toBe('1.5');
      // Must be parseable by PG NUMERIC (fractional support)
      expect(Number(balance)).toBe(1.5);
    });

    it('should return "0.0" for zero balance', async () => {
      mockBalanceOf.mockResolvedValue(0n);

      const balance = await delegate.getOmnibusBalance(TEST_ASSET.assetId, TEST_ASSET.assetType);

      expect(balance).toBe('0.0');
    });

    it('should return large balances as decimal strings', async () => {
      // 1000 tokens with 6 decimals = 1000000000 smallest units
      mockBalanceOf.mockResolvedValue(1000000000n);

      const balance = await delegate.getOmnibusBalance(TEST_ASSET.assetId, TEST_ASSET.assetType);

      expect(balance).toBe('1000.0');
    });

    it('should query the omnibus wallet address', async () => {
      mockBalanceOf.mockResolvedValue(0n);

      await delegate.getOmnibusBalance(TEST_ASSET.assetId, TEST_ASSET.assetType);

      expect(mockBalanceOf).toHaveBeenCalledWith('0xOMNIBUS');
    });
  });

  describe('outboundTransfer', () => {
    it('should transfer to resolved destination address', async () => {
      const mockReceipt = { hash: '0xTX_HASH', status: 1, getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }) };
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(mockReceipt) });
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
      expect(mockTransfer).toHaveBeenCalledWith('0xDEST_ADDRESS', 1500000n); // parseUnits('1.5', 6)
    });

    it('should use crypto address directly', async () => {
      const mockReceipt = { hash: '0xTX_HASH', status: 1, getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }) };
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(mockReceipt) });

      const result = await delegate.outboundTransfer(
        'idem-2',
        { finId: 'source-fin-id' } as any,
        { finId: 'dest-fin-id', account: { type: 'crypto', address: '0xDIRECT_ADDR' } } as any,
        TEST_ASSET,
        '2.0',
        undefined,
      );

      expect(result.success).toBe(true);
      expect(mockTransfer).toHaveBeenCalledWith('0xDIRECT_ADDR', 2000000n);
    });

    it('should return failure when receipt is null', async () => {
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(null) });

      const result = await delegate.outboundTransfer(
        'idem-3',
        {} as any,
        { finId: 'dest', account: { type: 'crypto', address: '0xDEST' } } as any,
        TEST_ASSET,
        '1.0',
        undefined,
      );

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('null');
    });
  });

  describe('hold', () => {
    it('should transfer from omnibus to escrow', async () => {
      const mockReceipt = { hash: '0xHOLD_TX', status: 1, getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }) };
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(mockReceipt) });

      const result = await delegate.hold(
        'idem-hold',
        {} as any, undefined,
        TEST_ASSET, '10.0', 'op-1', undefined,
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.transactionId).toBe('0xHOLD_TX');
      expect(mockTransfer).toHaveBeenCalledWith('0xESCROW', 10000000n);
    });
  });

  describe('release', () => {
    it('should transfer from escrow to omnibus', async () => {
      const mockReceipt = { hash: '0xRELEASE_TX', status: 1, getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }) };
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(mockReceipt) });

      const result = await delegate.release(
        'idem-release',
        {} as any,
        {} as any,
        TEST_ASSET, '5.0', 'op-2', undefined,
      );

      expect(result.success).toBe(true);
      expect(mockTransfer).toHaveBeenCalledWith('0xOMNIBUS', 5000000n);
    });
  });

  describe('rollback', () => {
    it('should transfer from escrow back to omnibus', async () => {
      const mockReceipt = { hash: '0xROLLBACK_TX', status: 1, getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }) };
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(mockReceipt) });

      const result = await delegate.rollback(
        'idem-rollback',
        {} as any,
        TEST_ASSET, '3.0', 'op-3', undefined,
      );

      expect(result.success).toBe(true);
      expect(mockTransfer).toHaveBeenCalledWith('0xOMNIBUS', 3000000n);
    });
  });

  describe('createAsset', () => {
    it('should deploy ERC20 when no tokenIdentifier provided', async () => {
      const deployedAddress = '0xNEW_TOKEN';
      mockDeployERC20Detached.mockResolvedValue(deployedAddress);

      const result = await delegate.createAsset(
        'idem-create', TEST_ASSET.assetId, undefined,
        undefined, 'TestCoin', undefined, undefined,
      );

      expect(result.ledgerIdentifier.tokenId).toBe(deployedAddress);
      expect(mockSaveAsset).toHaveBeenCalledWith(expect.objectContaining({
        contract_address: deployedAddress,
        id: TEST_ASSET.assetId,
        type: 'finp2p',
      }));
    });

    it('should use provided tokenIdentifier address', async () => {
      const existingAddress = '0xEXISTING_TOKEN';

      const result = await delegate.createAsset(
        'idem-create-2', TEST_ASSET.assetId,
        { tokenIdentifier: { tokenId: existingAddress } } as any,
        undefined, 'TestCoin', undefined, undefined,
      );

      expect(result.ledgerIdentifier.tokenId).toBe(existingAddress);
      expect(mockDeployERC20Detached).not.toHaveBeenCalled();
      expect(mockSaveAsset).toHaveBeenCalledWith(expect.objectContaining({
        contract_address: existingAddress,
      }));
    });
  });
});
