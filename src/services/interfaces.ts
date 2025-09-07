import {
  SrvAsset,
  AssetCreationResult,
  Destination,
  ExecutionContext,
  Signature,
  Source,
  TransactionResult
} from "./model";


export interface TokenService {

  createAsset(assetId: string, tokenId: string | undefined): Promise<AssetCreationResult>;

  getBalance(assetId: string, finId: string): Promise<string>;

  issue(asset: SrvAsset, issuerFinId: string, quantity: string, executionContext: ExecutionContext): Promise<TransactionResult>;

  transfer(nonce: string, source: Source, destination: Destination, reqAsset: SrvAsset,
           quantity: string, signature: Signature, executionContext: ExecutionContext): Promise<TransactionResult>;
}
