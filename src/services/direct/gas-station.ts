import { parseEther } from 'ethers';
import { logger } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { CustodyWallet } from './custody-provider';

/** How long GasStation.ensureGas waits for the target balance to reflect the funding tx. */
export const GAS_FUNDING_TIMEOUT_MS = 60_000;
/** Poll interval for target balance during GasStation.ensureGas. */
export const GAS_FUNDING_POLL_INTERVAL_MS = 1_000;

/**
 * Tops up a target wallet from a dedicated funding wallet so it has gas for the
 * next on-chain tx. Custody-agnostic: works with any signer/provider pair.
 *
 * `ensureGas` blocks until the target balance is observed on-chain (poll-by-
 * balance) — the side-effect that actually matters is the same regardless of
 * whether the underlying signer's sendTransaction returns after broadcast or
 * after mining.
 */
export class GasStation {
  constructor(
    public readonly wallet: CustodyWallet,
    public readonly amount: string,
  ) {}

  /**
   * Top up `walletAddress` so it holds at least `txCount` × the configured
   * amount — a wallet signing several instructions of one plan needs more
   * than the single-transaction threshold.
   */
  async ensureGas(walletAddress: string, txCount: number = 1): Promise<void> {
    const threshold = parseEther(this.amount) * BigInt(Math.max(1, txCount));
    let balance = await this.wallet.provider.getBalance(walletAddress);
    if (balance >= threshold) {
      logger.info(`Gas station: ${walletAddress} already funded (balance ${balance} >= ${threshold}), skipping`);
      return;
    }

    logger.info(`Gas station: topping up ${walletAddress} to ${threshold} (balance ${balance}, ${txCount} tx)`);
    const tx = await this.wallet.signer.sendTransaction({
      to: walletAddress,
      value: threshold,
    });
    logger.info(`Gas station: top-up tx ${tx.hash} submitted for ${walletAddress}, polling for on-chain balance`);

    const deadline = Date.now() + GAS_FUNDING_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, GAS_FUNDING_POLL_INTERVAL_MS));
      balance = await this.wallet.provider.getBalance(walletAddress);
      if (balance >= threshold) {
        logger.info(`Gas station: ${walletAddress} funded on-chain (balance ${balance})`);
        return;
      }
    }
    throw new Error(`Gas top-up to ${walletAddress} did not reflect on-chain after ${GAS_FUNDING_TIMEOUT_MS}ms (last balance: ${balance})`);
  }
}
