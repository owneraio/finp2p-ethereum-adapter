import { Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier, Balance, Destination, ExecutionContext, FinIdAccount, Logger, ReceiptOperation, Signature, Source, TokenService, failedReceiptOperation } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Contract, ContractTransactionResponse, Provider, Signer } from "ethers";

export class TokenServiceImpl implements TokenService {

  constructor(readonly provider: Provider, readonly signer: Signer, readonly logger: Logger) {}

  async createAsset(idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined, assetMetadata: any, assetName: string | undefined, issuerId: string | undefined, assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    throw new Error('Method not implemented.');
  }
  async getBalance(assetId: string, finId: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
  async balance(assetId: string, finId: string): Promise<Balance> {
    throw new Error('Method not implemented.');
  }
  async issue(idempotencyKey: string, asset: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    throw new Error('Method not implemented.');
  }

  async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, ast: Asset, quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType })
    if (asset === undefined) throw new Error('Asset is not registered in DB')

    const tx = await ((): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], this.signer)
          return c.transfer("eth address", 1)
      }
    })()

    const receipt = await tx.wait()
    if (receipt === null) return failedReceiptOperation(1, "receipt is null")

    const block = await receipt.getBlock()
    return {
      operation: "receipt",
      type: "success",
      receipt: {
        id: receipt.hash,
        asset: ast,
        source,
        destination,
        operationType: "transfer",
        proof: undefined,
        quantity,
        timestamp: block.timestamp,
        tradeDetails: {
          executionContext: exCtx
        },
        transactionDetails: {
          operationId: undefined,
          transactionId: receipt.hash
        }
      }
    }
  }

  async redeem(idempotencyKey: string, nonce: string, source: FinIdAccount, asset: Asset, quantity: string, operationId: string | undefined, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    throw new Error('Method not implemented.');
  }
}
