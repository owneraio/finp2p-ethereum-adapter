/**
 * Standalone test of the DTCC CollateralDepositPlugin.depositCustom()
 * Calls the plugin directly without the adapter or skeleton.
 *
 * Usage: npx ts-node scripts/test-dtcc-deposit.ts
 * Requires env vars: FIREBLOCKS_*, FINP2P_ADDRESS, OSS_URL, FACTORY_ADDRESS, etc.
 */
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { JsonRpcProvider } from 'ethers';
import { FinP2PClient } from '@owneraio/finp2p-client';
import { CollateralDepositPlugin } from '@owneraio/finp2p-ethereum-dtcc-plugin';
import winston, { format, transports } from 'winston';

dotenv.config({ path: resolve(process.cwd(), '.env.fireblocks') });

const logger = winston.createLogger({
  level: 'debug',
  transports: [new transports.Console()],
  format: format.combine(format.timestamp(), format.json()),
});

async function main() {
  const orgId = process.env.ORGANIZATION_ID || 'org-a';
  const rpcUrl = process.env.NETWORK_HOST;
  if (!rpcUrl) throw new Error('NETWORK_HOST not set');

  const finP2PUrl = process.env.FINP2P_ADDRESS;
  const ossUrl = process.env.OSS_URL;
  if (!finP2PUrl || !ossUrl) throw new Error('FINP2P_ADDRESS and OSS_URL required');

  const provider = new JsonRpcProvider(rpcUrl);
  // In local-submit mode we don't have a real signer at this level — plugin uses its own
  const signer = provider as any;

  const finP2PClient = new FinP2PClient(finP2PUrl, ossUrl);

  console.log('=== DTCC Deposit Plugin Standalone Test ===');
  console.log(`orgId: ${orgId}`);
  console.log(`rpcUrl: ${rpcUrl}`);
  console.log(`finP2PUrl: ${finP2PUrl}`);
  console.log(`FACTORY_ADDRESS: ${process.env.FACTORY_ADDRESS}`);
  console.log();

  console.log('[1] Creating CollateralDepositPlugin...');
  const plugin = new CollateralDepositPlugin(orgId, provider, signer, finP2PClient, logger);
  console.log('    Done');

  const testOwner = {
    type: 'finId' as const,
    finId: process.env.TEST_FIN_ID || '02f74c0f590747e0772492a5c4fbd2104736fa7efb0fb6f7228e5ee198208f9a24',
  };

  const testDetails = {
    currency: 'USD',
    assets: [
      { assetId: 'test-asset', quantity: '100' },
    ],
  };

  console.log(`[2] Calling depositCustom(owner=${testOwner.finId.slice(0, 20)}...)...`);
  const t0 = Date.now();
  try {
    const result = await plugin.depositCustom(testOwner, undefined, testDetails);
    console.log(`    Result in ${Date.now() - t0}ms:`, JSON.stringify(result, null, 2));
  } catch (e: any) {
    console.error(`    FAILED after ${Date.now() - t0}ms`);
    console.error(`    Error: ${e.message}`);
    if (e.code) console.error(`    Code: ${e.code}`);
    console.error(e.stack);
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
