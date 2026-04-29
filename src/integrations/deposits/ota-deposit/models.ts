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
  ephemeralAddress: string;
  custodyAccountId: string;
  ephemeralWallet: CustodyWallet;
  sweepTarget: string;
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
