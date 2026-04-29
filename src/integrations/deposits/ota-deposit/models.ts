import { CustodyWallet } from "../../../services/direct";

/**
 * In-flight OTA deposit: a freshly-provisioned custody account waiting for funds.
 * Held in memory by the BalanceWatcher; cleared once the inbound has been swept
 * and the receipt exported.
 */
export interface OtaDeposit {
  correlationId: string;
  finId: string;
  assetId: string;
  contractAddress: string;
  /** ERC20 decimals — used to translate between the caller's human-readable amount
   * (the deposit API convention, e.g. "0.1") and on-chain base units (100000). */
  decimals: number;
  ephemeralAddress: string;
  custodyAccountId: string;
  ephemeralWallet: CustodyWallet;
  sweepTarget: string;
  /** Human-readable amount as accepted from the caller (e.g. "0.1"); optional. */
  expectedAmount?: string;
  createdAt: number;
}

/**
 * Result handed to the plugin only after the OTA watcher has detected the inbound AND
 * successfully swept the funds to the sweep target. The watcher does not fire this until
 * sweep confirms — see BalanceWatcher.pollOnce. This guarantees the receipt downstream
 * carries a real on-chain transaction id and that funds are no longer at the ephemeral.
 */
export interface OtaResult {
  deposit: OtaDeposit;
  receivedAmount: string;
  sweepTxHash: string;
}
