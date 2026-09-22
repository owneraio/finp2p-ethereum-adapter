import {
  Asset, Destination, ExecutionContext, OperationType,
  ReceiptOperation, Source, failedReceiptOperation,
} from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { TokenOperationResult } from '@owneraio/finp2p-ethereum-adapter-contract';

export function resultToReceipt(
  result: TokenOperationResult, ast: Asset, operationType: OperationType, quantity: string,
  source: Source | undefined,
  destination: Destination | undefined,
  exCtx: ExecutionContext | undefined, operationId: string | undefined,
): ReceiptOperation {
  if (result.status === 'failure') {
    return failedReceiptOperation(1, result.reason);
  }
  return {
    operation: "receipt",
    type: "success",
    receipt: {
      id: result.transactionId,
      asset: ast,
      source,
      destination,
      operationType,
      proof: undefined,
      quantity,
      timestamp: result.timestamp,
      tradeDetails: { executionContext: exCtx },
      transactionDetails: { operationId, transactionId: result.transactionId }
    }
  };
}
