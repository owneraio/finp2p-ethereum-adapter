import {
  Asset,
  AssetCreationStatus,
  Destination,
  ExecutionContext,
  Signature,
  Source,
  ReceiptOperation, Balance, OperationStatus, PlanApprovalStatus, DepositOperation, DepositAsset
} from "./model";


export interface HealthService {
  liveness(): Promise<void>

  readiness(): Promise<void>
}

export interface CommonService {

  getReceipt(id: string): Promise<ReceiptOperation>

  operationStatus(cid: string): Promise<OperationStatus>
}

export interface TokenService {

  createAsset(assetId: string, tokenId: string | undefined): Promise<AssetCreationStatus>;

  getBalance(assetId: string, finId: string): Promise<string>;

  balance(assetId: string, finId: string): Promise<Balance>;

  issue(asset: Asset, issuerFinId: string, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation>;

  transfer(nonce: string, source: Source, destination: Destination, asset: Asset,
           quantity: string, signature: Signature, exCtx: ExecutionContext): Promise<ReceiptOperation>;

  redeem(nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
         signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation>

}

export interface EscrowService {

  hold(nonce: string, source: Source, destination: Destination | undefined, asset: Asset,
       quantity: string, signature: Signature, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation>

  release(destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation>

  rollback(asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation>

}

export interface PaymentService {
  deposit(owner: Source, destination: Destination, asset: DepositAsset, amount: string | undefined,
          details: any | undefined,
          nonce: string | undefined, signature: Signature | undefined): Promise<DepositOperation>

  payout(source: Source, destination: Destination | undefined, asset: Asset, quantity: string,
         description: string | undefined, nonce: string | undefined,
         signature: Signature | undefined): Promise<ReceiptOperation>
}

export interface PlanApprovalService {
  approvePlan(planId: string): Promise<PlanApprovalStatus>
}
