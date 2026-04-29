import { CustodyWallet } from "../../../services/direct";

/**
 * In-flight OTA deposit: a freshly-provisioned custody account waiting for funds.
 * Held in memory by the BalanceWatcher; cleared once the inbound has been swept
 * and the receipt exported.
 */
export interface OtaIntent {
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

/** Result handed to the plugin once the OTA watcher has detected and (best-effort) swept funds. */
export interface OtaResult {
  intent: OtaIntent;
  sender: string;
  receivedAmount: string;
  inboundTxHash: string;
  sweepTxHash: string | undefined;
}
