import { JsonRpcProvider, Wallet, parseUnits, NonceManager } from 'ethers';
import { FireblocksSDK } from 'fireblocks-sdk';
import { ContractsManager, ERC20Contract } from '@owneraio/finp2p-contracts';
import { FireblocksRawSigner } from '../src/services/direct/fireblocks-raw-signer';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { resolve } from 'path';
import winston from 'winston';

dotenv.config({ path: resolve(process.cwd(), '.env.fireblocks') });

const logger = winston.createLogger({ silent: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.fireblocks`);
  return value;
}

describe('FireblocksRawSigner - real Fireblocks SDK with local chain', () => {
  let provider: JsonRpcProvider;
  let deployerWallet: Wallet;
  let signer: FireblocksRawSigner;
  let signerAddress: string;

  beforeAll(async () => {
    const rpcUrl = process.env.HARDHAT_RPC_URL || 'http://localhost:8545';
    provider = new JsonRpcProvider(rpcUrl);
    await provider.send('hardhat_reset', []);

    // Hardhat account #0 as deployer/funder
    deployerWallet = new Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider,
    );

    // Real Fireblocks SDK
    const apiKey = requireEnv('FIREBLOCKS_API_KEY');
    const apiBaseUrl = requireEnv('FIREBLOCKS_API_BASE_URL');
    const vaultId = requireEnv('FIREBLOCKS_VAULT_ID');

    let apiPrivateKey: string;
    if (process.env.FIREBLOCKS_API_PRIVATE_KEY) {
      apiPrivateKey = process.env.FIREBLOCKS_API_PRIVATE_KEY;
    } else if (process.env.FIREBLOCKS_API_PRIVATE_KEY_BASE64) {
      apiPrivateKey = Buffer.from(process.env.FIREBLOCKS_API_PRIVATE_KEY_BASE64, 'base64').toString('utf-8');
    } else {
      const keyPath = requireEnv('FIREBLOCKS_API_PRIVATE_KEY_PATH');
      apiPrivateKey = fs.readFileSync(resolve(process.cwd(), keyPath), 'utf-8');
    }

    const fireblocksSdk = new FireblocksSDK(apiPrivateKey, apiKey, apiBaseUrl);

    signer = new FireblocksRawSigner(
      { fireblocksSdk, vaultAccountId: vaultId, assetId: 'ETH_TEST5' },
      provider,
    );

    // Get the Fireblocks vault address
    signerAddress = await signer.getAddress();
    console.log(`Fireblocks vault address: ${signerAddress}`);

    // Fund the vault address on local hardhat
    const fundTx = await deployerWallet.sendTransaction({
      to: signerAddress,
      value: parseUnits('10', 'ether'),
    });
    await fundTx.wait();
    console.log(`Funded ${signerAddress} with 10 ETH on local chain`);
  });

  it('should resolve vault address', () => {
    expect(signerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('should sign and submit ETH transfer via Fireblocks raw signing', async () => {
    const recipient = await deployerWallet.getAddress();
    const balanceBefore = await provider.getBalance(recipient);

    const wrappedSigner = new NonceManager(signer);
    const tx = await wrappedSigner.sendTransaction({
      to: recipient,
      value: parseUnits('0.1', 'ether'),
    });
    const receipt = await tx.wait();

    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe(1);

    const balanceAfter = await provider.getBalance(recipient);
    expect(balanceAfter - balanceBefore).toBe(parseUnits('0.1', 'ether'));
  });

  it('should deploy ERC20 and do mint+transfer via Fireblocks raw signing', async () => {
    const wrappedSigner = new NonceManager(signer);

    // Deploy
    const cm = new ContractsManager(provider, wrappedSigner, logger);
    const tokenAddress = await cm.deployERC20('FireblocksTest', 'FBT', 6, signerAddress);
    expect(tokenAddress).toBeDefined();
    console.log(`ERC20 deployed at: ${tokenAddress}`);

    // Mint
    const erc20 = new ERC20Contract(provider, wrappedSigner, tokenAddress, logger);
    const mintTx = await erc20.mint(signerAddress, parseUnits('1000', 6));
    await mintTx.wait();

    const balance = await erc20.balanceOf(signerAddress);
    expect(balance).toBe(parseUnits('1000', 6));

    // Transfer
    const recipient = await deployerWallet.getAddress();
    const transferTx = await erc20.transfer(recipient, parseUnits('100', 6));
    await transferTx.wait();

    expect(await erc20.balanceOf(signerAddress)).toBe(parseUnits('900', 6));
    expect(await erc20.balanceOf(recipient)).toBe(parseUnits('100', 6));
  });
});
