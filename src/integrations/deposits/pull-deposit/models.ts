/**
 * In-flight pull-deposit: a deposit waiting for an Approval(_, operator) event
 * from the depositor's external wallet so the operator can transferFrom on their behalf.
 * Held in memory by the ApprovalWatcher; cleared once the transferFrom succeeds.
 */
export interface PullDeposit {
  correlationId: string;
  finId: string;
  assetId: string;
  contractAddress: string;
  /** ERC20 decimals — used to translate between the caller's human-readable amount
   * (the deposit API convention, e.g. "0.1") and on-chain base units (100000). */
  decimals: number;
  destinationAddress: string;
  /** Human-readable amount as accepted from the caller (e.g. "0.1"); optional. */
  expectedAmount?: string;
  createdAt: number;
}

/** Result handed to the plugin once the operator's transferFrom has settled. */
export interface PullResult {
  deposit: PullDeposit;
  owner: string;
  txHash: string;
  amount: string;
}
