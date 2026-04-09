/**
 * Reproduces a hold (ERC20 transfer) via Fireblocks to measure timing.
 * Uses the same code path as the adapter: FireblocksWeb3Provider → ERC20Contract.transfer().
 *
 * Usage: npx ts-node scripts/test-hold-timing.ts
 * Requires .env.fireblocks or env vars set.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { BrowserProvider, parseUnits, formatUnits } from 'ethers';
import { ERC20Contract } from '@owneraio/finp2p-contracts';
import { createFireblocksEthersProvider } from '../src/services/direct/fireblocks-config';

dotenv.config({ path: resolve(process.cwd(), '.env.fireblocks') });

const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

async function main() {
  const fs = await import('fs');
  const apiKey = process.env.FIREBLOCKS_API_KEY!;
  let apiPrivateKey: string;
  if (process.env.FIREBLOCKS_API_PRIVATE_KEY) {
    apiPrivateKey = process.env.FIREBLOCKS_API_PRIVATE_KEY;
  } else if (process.env.FIREBLOCKS_API_PRIVATE_KEY_BASE64) {
    apiPrivateKey = Buffer.from(process.env.FIREBLOCKS_API_PRIVATE_KEY_BASE64, 'base64').toString('utf-8');
  } else if (process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH) {
    apiPrivateKey = fs.readFileSync(resolve(process.cwd(), process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH), 'utf-8');
  } else {
    throw new Error('No Fireblocks private key configured');
  }
  const chainId = Number(process.env.FIREBLOCKS_CHAIN_ID ?? 11155111);
  const apiBaseUrl = process.env.FIREBLOCKS_API_BASE_URL ?? 'https://sandbox-api.fireblocks.io';
  const sourceVaultId = process.env.TEST_SOURCE_VAULT ?? process.env.FIREBLOCKS_ASSET_ISSUER_VAULT_ID ?? '17';
  const escrowVaultId = process.env.TEST_ESCROW_VAULT ?? process.env.FIREBLOCKS_ASSET_ESCROW_VAULT_ID ?? '16';
  const tokenAddress = process.env.TEST_TOKEN_ADDRESS ?? USDC_SEPOLIA;
  const amount = process.env.TEST_AMOUNT ?? '1'; // 1 token unit (will be parsed with decimals)

  console.log('=== Fireblocks Hold Timing Test ===');
  console.log(`Source vault: ${sourceVaultId}`);
  console.log(`Escrow vault: ${escrowVaultId}`);
  console.log(`Token: ${tokenAddress}`);
  console.log(`Amount: ${amount}`);
  console.log();

  // Create source wallet (the one doing the hold/transfer)
  console.log('[1] Creating Fireblocks provider for source vault...');
  const t0 = Date.now();
  const sourceWallet = await createFireblocksEthersProvider({
    apiKey, privateKey: apiPrivateKey, chainId: chainId as any, apiBaseUrl,
    vaultAccountIds: [sourceVaultId],
  });
  console.log(`    Done in ${Date.now() - t0}ms`);

  // Create escrow wallet (to get the escrow address)
  console.log('[2] Creating Fireblocks provider for escrow vault...');
  const t1 = Date.now();
  const escrowWallet = await createFireblocksEthersProvider({
    apiKey, privateKey: apiPrivateKey, chainId: chainId as any, apiBaseUrl,
    vaultAccountIds: [escrowVaultId],
  });
  console.log(`    Done in ${Date.now() - t1}ms`);

  const sourceAddress = await sourceWallet.signer.getAddress();
  const escrowAddress = await escrowWallet.signer.getAddress();
  console.log(`\nSource address: ${sourceAddress}`);
  console.log(`Escrow address: ${escrowAddress}`);

  // Check balance
  const logger = { info: console.log, warn: console.warn, error: console.error, debug: console.debug, warning: console.warn, alert: console.error };
  const erc20 = new ERC20Contract(sourceWallet.provider, sourceWallet.signer, tokenAddress, logger as any);

  console.log('\n[3] Checking source balance...');
  const t2 = Date.now();
  const balance = await erc20.balanceOf(sourceAddress);
  const decimals = await erc20.decimals();
  console.log(`    Balance: ${formatUnits(balance, Number(decimals))} (raw: ${balance})`);
  console.log(`    Done in ${Date.now() - t2}ms`);

  const transferAmount = parseUnits(amount, Number(decimals));
  console.log(`\nTransfer amount: ${transferAmount} (${amount} tokens)`);

  if (balance < transferAmount) {
    console.log('\n⚠ Insufficient balance — transfer will revert.');
    console.log('  Proceeding anyway to measure Fireblocks timing...\n');
  }

  // Do the transfer (hold = transfer to escrow)
  console.log('[4] Sending transfer (hold) via Fireblocks...');
  const t3 = Date.now();
  try {
    const tx = await erc20.transfer(escrowAddress, transferAmount);
    const tSigned = Date.now();
    console.log(`    TX submitted in ${tSigned - t3}ms — hash: ${tx.hash}`);

    console.log('[5] Waiting for receipt...');
    const receipt = await tx.wait();
    const tConfirmed = Date.now();
    console.log(`    Confirmed in ${tConfirmed - tSigned}ms — status: ${receipt?.status}`);
    console.log(`    Total: ${tConfirmed - t3}ms`);
  } catch (e: any) {
    const tFailed = Date.now();
    console.error(`    FAILED after ${tFailed - t3}ms`);
    console.error(`    Error: ${e.shortMessage ?? e.message}`);
    if (e.reason) console.error(`    Reason: ${e.reason}`);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
