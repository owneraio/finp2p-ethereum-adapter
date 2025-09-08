import {
  Asset,
  AssetCreationResult,
  Destination,
  ExecutionContext,
  Signature,
  Source,
  ReceiptResult, Balance
} from "./model";


export interface HealthService {
  liveness(): Promise<void>;
  readiness(): Promise<void>;
}

export interface TokenService {

  createAsset(assetId: string, tokenId: string | undefined): Promise<AssetCreationResult>;

  getBalance(assetId: string, finId: string): Promise<string>;

  balance(assetId: string, finId: string): Promise<Balance>;

  issue(asset: Asset, issuerFinId: string, quantity: string, executionContext: ExecutionContext): Promise<ReceiptResult>;

  transfer(nonce: string, source: Source, destination: Destination, reqAsset: Asset,
           quantity: string, signature: Signature, executionContext: ExecutionContext): Promise<ReceiptResult>;

  redeem(source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string,
                       executionContext: ExecutionContext
  ): Promise<ReceiptResult>
}

export interface EscrowService {

  hold(nonce: string, source: Source, destination: Destination, asset: Asset,
       quantity: string, signature: Signature, operationId: string, executionContext: ExecutionContext
  ): Promise<ReceiptResult>

  release(destination: Destination, asset: Asset, quantity: string, operationId: string,
          executionContext: ExecutionContext
  ): Promise<ReceiptResult>

  rollback(asset: Asset, quantity: string, operationId: string,
          executionContext: ExecutionContext
  ): Promise<ReceiptResult>

}
