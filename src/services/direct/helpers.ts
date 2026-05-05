import { AssetRecord } from '@owneraio/finp2p-ethereum-token-standard';
import { parseEther } from 'ethers';
import winston from 'winston';
import { CustodyWallet, GasStation } from './custody-provider';
import { AssetStore } from './account-mapping';

export async function getAssetFromDb(assetStore: AssetStore, assetId: string): Promise<AssetRecord> {
  const dbAsset = await assetStore.getAsset(assetId);
  if (dbAsset === undefined) throw new Error(`Asset ${assetId} is not registered in DB`);
  return {
    contractAddress: dbAsset.contract_address,
    decimals: dbAsset.decimals,
    tokenStandard: dbAsset.token_standard,
  };
}

/**
 * Top up `wallet` from the gas station only if its current balance is below the
 * configured top-up amount. Useful for direct mode (per-investor wallets each
 * may need funding once) and equally for omnibus mode (few long-lived signers
 * shared across every operation — without the balance guard we'd send a top-up
 * tx before every hold/release/transfer).
 */
export async function fundGasIfNeeded(logger: winston.Logger, gasStation: GasStation | undefined, wallet: CustodyWallet): Promise<void> {
  if (!gasStation) return;
  try {
    const targetAddress = await wallet.signer.getAddress();
    const threshold = parseEther(gasStation.amount);
    const balance = await wallet.provider.getBalance(targetAddress);
    if (balance >= threshold) return;
    await gasStation.wallet.signer.sendTransaction({
      to: targetAddress,
      value: threshold,
    });
    logger.info(`Gas-funded ${targetAddress} with ${gasStation.amount} (balance was ${balance})`);
  } catch (e) {
    logger.warn(`Gas funding failed (wallet may already have sufficient gas): ${e}`);
  }
}
