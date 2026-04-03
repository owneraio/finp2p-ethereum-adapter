import { JsonRpcProvider, Wallet, Transaction, keccak256, parseUnits, SigningKey, NonceManager } from 'ethers';
import { TransactionOperation, TransactionStatus, PeerType } from 'fireblocks-sdk';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import { FireblocksRawSigner } from '../src/services/direct/fireblocks-raw-signer';
import winston from 'winston';

const logger = winston.createLogger({ silent: true });

// Hardhat account #1 (operator)
const PRIVATE_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const VAULT_ID = '1';

/**
 * Creates a mock FireblocksSDK that signs using a local private key.
 * Simulates the raw signing flow: createTransaction → poll → signedMessages.
 */
function createMockFireblocksSdk(privateKey: string) {
  const signingKey = new SigningKey(privateKey);
  const address = new Wallet(privateKey).address;
  const txStore = new Map<string, any>();
  let txCounter = 0;

  return {
    getDepositAddresses: jest.fn().mockResolvedValue([{ address }]),

    createTransaction: jest.fn().mockImplementation(async (args: any) => {
      const txId = `mock-tx-${++txCounter}`;

      if (args.operation === TransactionOperation.RAW) {
        const rawMessages = args.extraParameters?.rawMessageData?.messages ?? args.rawMessageData?.messages;
        if (!rawMessages?.length) throw new Error('No raw messages');

        const hash = `0x${rawMessages[0].content}`;
        const sig = signingKey.sign(hash);

        txStore.set(txId, {
          id: txId,
          status: TransactionStatus.COMPLETED,
          signedMessages: [{
            content: rawMessages[0].content,
            algorithm: 'MPC_ECDSA_SECP256K1',
            derivationPath: [44, 60, 0, 0, 0],
            signature: {
              fullSig: sig.r.slice(2) + sig.s.slice(2),
              r: sig.r.slice(2),
              s: sig.s.slice(2),
              v: sig.v - 27,
            },
            publicKey: signingKey.compressedPublicKey,
          }],
        });
      }

      return { id: txId, status: TransactionStatus.SUBMITTED };
    }),

    getTransactionById: jest.fn().mockImplementation(async (txId: string) => {
      const tx = txStore.get(txId);
      if (!tx) throw new Error(`Unknown tx: ${txId}`);
      return tx;
    }),
  };
}

describe('FireblocksRawSigner - local submit with real chain', () => {
  let provider: JsonRpcProvider;
  let deployerWallet: Wallet;
  let mockSdk: ReturnType<typeof createMockFireblocksSdk>;
  let rawSigner: FireblocksRawSigner;

  beforeEach(async () => {
    const rpcUrl = process.env.HARDHAT_RPC_URL || 'http://localhost:8545';
    provider = new JsonRpcProvider(rpcUrl);

    // Reset hardhat state between tests
    await provider.send('hardhat_reset', []);

    // Hardhat account #0 as deployer (has ETH, deploys contracts)
    deployerWallet = new Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider,
    );

    mockSdk = createMockFireblocksSdk(PRIVATE_KEY);
    rawSigner = new NonceManager(new FireblocksRawSigner(
      { fireblocksSdk: mockSdk as any, vaultAccountId: VAULT_ID },
      provider,
    )) as any;
  });

  it('should resolve address from vault deposit addresses', async () => {
    const address = await rawSigner.getAddress();
    const expected = new Wallet(PRIVATE_KEY).address;
    expect(address).toBe(expected);
  });

  it('should sign and submit a simple ETH transfer', async () => {
    const signerAddress = await rawSigner.getAddress();

    // Fund the raw signer address from deployer
    const fundTx = await deployerWallet.sendTransaction({
      to: signerAddress,
      value: parseUnits('1', 'ether'),
    });
    await fundTx.wait();

    // Send ETH using the raw signer
    const recipient = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    const tx = await rawSigner.sendTransaction({
      to: recipient,
      value: parseUnits('0.1', 'ether'),
    });
    const receipt = await tx.wait();

    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe(1);

    // Verify Fireblocks SDK was called with RAW operation
    expect(mockSdk.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: TransactionOperation.RAW,
        source: { type: PeerType.VAULT_ACCOUNT, id: VAULT_ID },
      }),
    );
  });

  it('should deploy and interact with ERC20 via ContractsManager', async () => {
    const signerAddress = await rawSigner.getAddress();

    // Deploy ERC20 using the raw signer (signs deploy tx via mock Fireblocks)
    const cm = new ContractsManager(provider, rawSigner, logger);
    const tokenAddress = await cm.deployERC20('TestToken', 'TT', 6, signerAddress);
    expect(tokenAddress).toBeDefined();

    // Mint tokens
    const erc20 = new ERC20Contract(provider, rawSigner, tokenAddress, logger);
    const mintTx = await erc20.mint(signerAddress, parseUnits('1000', 6));
    const mintReceipt = await mintTx.wait();
    expect(mintReceipt!.status).toBe(1);

    // Check balance
    const balance = await erc20.balanceOf(signerAddress);
    expect(balance).toBe(parseUnits('1000', 6));

    // Transfer tokens
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
    const transferTx = await erc20.transfer(recipient, parseUnits('100', 6));
    const transferReceipt = await transferTx.wait();
    expect(transferReceipt!.status).toBe(1);

    // Verify balances
    const senderBalance = await erc20.balanceOf(signerAddress);
    const recipientBalance = await erc20.balanceOf(recipient);
    expect(senderBalance).toBe(parseUnits('900', 6));
    expect(recipientBalance).toBe(parseUnits('100', 6));
  });
});
