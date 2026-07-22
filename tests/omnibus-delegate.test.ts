import { OmnibusDelegate } from '../src/services/omnibus/omnibus-delegate';
import { CustodyProvider, CustodyWallet } from '../src/services/custody/custody-provider';
import { AccountResolver, AssetStore } from '../src/services/accounts/account-resolver';
import { tokenStandardRegistry } from '../src/integrations/token-standards/registry';
import { ERC20TokenStandard, TokenStandardName as ERC20_TOKEN_STANDARD } from '@owneraio/finp2p-ethereum-erc20-plugin';
import winston from 'winston';

tokenStandardRegistry.register(ERC20_TOKEN_STANDARD, new ERC20TokenStandard({} as any, createMockSigner('0xISSUER')));

// Mock @owneraio/finp2p-contracts
const mockBalanceOf = jest.fn();
const mockTransfer = jest.fn();
const mockDecimals = jest.fn();
jest.mock('@owneraio/finp2p-contracts', () => ({
  ERC20Contract: jest.fn().mockImplementation(() => ({
    balanceOf: mockBalanceOf,
    transfer: mockTransfer,
    decimals: mockDecimals,
  })),
}));

// Mock ethers ContractFactory so ERC20TokenStandard.deploy doesn't try to hit an RPC.
const mockContractFactoryDeploy = jest.fn();
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ContractFactory: jest.fn().mockImplementation(() => ({
      deploy: mockContractFactoryDeploy,
    })),
  };
});

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

const mockReadProvider = {
  waitForTransaction: jest.fn(),
  getBlock: jest.fn(),
  getNetwork: jest.fn().mockResolvedValue({ chainId: 11155111n, name: 'sepolia' }),
} as any;

function createMockCustodyProvider(overrides: Partial<CustodyProvider> = {}): CustodyProvider {
  return {
    escrow: createMockWallet('0xESCROW'),
    omnibus: createMockWallet('0xOMNIBUS'),
    rpcProvider: mockReadProvider,
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
  let accountMapping: AccountResolver;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAsset.mockResolvedValue(TEST_DB_ASSET);
    mockSaveAsset.mockResolvedValue(undefined);

    custodyProvider = createMockCustodyProvider();
    accountMapping = createMockAccountMapping();
    const mockAssetStore = { getAsset: mockGetAsset, saveAsset: mockSaveAsset } as unknown as AssetStore;
    delegate = new OmnibusDelegate(logger, custodyProvider, mockReadProvider, accountMapping, mockAssetStore);
  });

  it('should throw if custody provider has no omnibus wallet', () => {
    const noOmnibus = createMockCustodyProvider({ omnibus: undefined });
    const mockAssetStore = { getAsset: jest.fn(), saveAsset: jest.fn() } as unknown as AssetStore;
    expect(() => new OmnibusDelegate(logger, noOmnibus, mockReadProvider, accountMapping, mockAssetStore))
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
    it('should transfer from escrow to omnibus when destination is locally mapped', async () => {
      const mockReceipt = { hash: '0xRELEASE_TX', status: 1, getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }) };
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(mockReceipt) });
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue('0xLOCAL_INVESTOR');

      const result = await delegate.release(
        'idem-release',
        {} as any,
        { finId: 'local-investor-finId' } as any,
        TEST_ASSET, '5.0', 'op-2', undefined,
      );

      expect(result.success).toBe(true);
      expect(mockTransfer).toHaveBeenCalledWith('0xOMNIBUS', 5000000n);
    });

    it('should transfer from escrow to external counterparty address when destination is unmapped', async () => {
      const mockReceipt = { hash: '0xCROSS_ORG_TX', status: 1, getBlock: jest.fn().mockResolvedValue({ timestamp: 1700000000 }) };
      mockTransfer.mockResolvedValue({ wait: jest.fn().mockResolvedValue(mockReceipt) });
      (accountMapping.resolveAccount as jest.Mock).mockResolvedValue(undefined);

      const result = await delegate.release(
        'idem-release-cross-org',
        {} as any,
        { finId: 'remote-org-finId', account: { type: 'crypto', address: '0xREMOTE_ORG_OMNIBUS' } } as any,
        TEST_ASSET, '7.0', 'op-cross', undefined,
      );

      expect(result.success).toBe(true);
      expect(mockTransfer).toHaveBeenCalledWith('0xREMOTE_ORG_OMNIBUS', 7000000n);
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
      mockContractFactoryDeploy.mockResolvedValue({
        waitForDeployment: jest.fn().mockResolvedValue(undefined),
        getAddress: jest.fn().mockResolvedValue(deployedAddress),
      });

      const result = await delegate.createAsset(
        'idem-create', TEST_ASSET.assetId, undefined,
        undefined, 'TestCoin', undefined, undefined,
      );

      expect(result.ledgerIdentifier.tokenId).toBe(deployedAddress);
      expect(result.ledgerIdentifier.network).toBe('eip155:11155111');
      expect(mockSaveAsset).toHaveBeenCalledWith(expect.objectContaining({
        contract_address: deployedAddress,
        id: TEST_ASSET.assetId,
      }));
    });

    it('should use provided tokenIdentifier address and read decimals on-chain', async () => {
      const existingAddress = '0xEXISTING_TOKEN';
      mockDecimals.mockResolvedValue(8n);

      const result = await delegate.createAsset(
        'idem-create-2', TEST_ASSET.assetId,
        { tokenIdentifier: { tokenId: existingAddress, network: 'eip155:42161' } } as any,
        undefined, 'TestCoin', undefined, undefined,
      );

      expect(result.ledgerIdentifier.tokenId).toBe(existingAddress);
      expect(result.ledgerIdentifier.network).toBe('eip155:42161');
      expect(mockContractFactoryDeploy).not.toHaveBeenCalled();
      expect(mockSaveAsset).toHaveBeenCalledWith(expect.objectContaining({
        contract_address: existingAddress,
        decimals: 8,
      }));
    });

    it('should fall back to chain-derived network when bind omits it', async () => {
      mockDecimals.mockResolvedValue(6n);

      const result = await delegate.createAsset(
        'idem-create-3', TEST_ASSET.assetId,
        { tokenIdentifier: { tokenId: '0xANY' } } as any,
        undefined, undefined, undefined, undefined,
      );

      expect(result.ledgerIdentifier.network).toBe('eip155:11155111');
    });
  });
});
