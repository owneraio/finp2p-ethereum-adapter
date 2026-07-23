import { parseEther } from "ethers";
import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FundingWallet, GAS_FUNDING_TIMEOUT_MS, GAS_FUNDING_POLL_INTERVAL_MS } from "./gas-station";

export const DEFAULT_ACTIVATION_AMOUNT = "0.001";

/**
 * One-time recipient activation for Hedera-style networks: an account alias
 * comes into existence (and receives its canonical 0.0.x id) on its first
 * native transfer. Balance > 0 proves the address is already activated;
 * balance 0 gets the one-time touch — a false negative (activated but empty
 * account) costs one harmless tiny transfer, a false positive is impossible.
 *
 * Distinct from GasStation on purpose: gas funding is sender-side, recurring
 * and threshold-scaled; activation is recipient-side and once per wallet
 * lifetime. Both send from the same funding wallet, so callers must not run
 * them concurrently.
 */
export class WalletActivator {
  constructor(
    private readonly fundingWallet: FundingWallet,
    private readonly amount: string,
  ) {}

  /** @returns true when an activation transfer was sent, false when the address was already active */
  async ensureActivated(address: string): Promise<boolean> {
    let balance = await this.fundingWallet.provider.getBalance(address);
    if (balance > 0n) {
      logger.info(`Wallet activation: ${address} already active (balance ${balance}), skipping`);
      return false;
    }

    logger.info(`Wallet activation: ${address} has zero balance, sending ${this.amount} to activate`);
    const tx = await this.fundingWallet.signer.sendTransaction({
      to: address,
      value: parseEther(this.amount),
    });
    logger.info(`Wallet activation: activation tx ${tx.hash} submitted for ${address}, polling for on-chain balance`);

    const deadline = Date.now() + GAS_FUNDING_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, GAS_FUNDING_POLL_INTERVAL_MS));
      balance = await this.fundingWallet.provider.getBalance(address);
      if (balance > 0n) {
        logger.info(`Wallet activation: ${address} confirmed active on-chain (balance ${balance})`);
        return true;
      }
    }
    throw new Error(`Activation transfer to ${address} did not reflect on-chain after ${GAS_FUNDING_TIMEOUT_MS}ms`);
  }
}
