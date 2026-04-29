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
  destinationAddress: string;
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
