import { Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier, Balance, Destination, ExecutionContext, FinIdAccount, Logger, ReceiptOperation, Signature, Source, TokenService, failedReceiptOperation } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Contract, ContractTransactionResponse, Provider, Signer } from "ethers";
import { FireblocksSDK } from 'fireblocks-sdk'

async function getAssetFromDb(ast: Asset): Promise<workflows.Asset> {
  const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType })
  if (asset === undefined) throw new Error(`Asset(type=(${ast.assetType},id=${ast.assetId}) is not registered in DB`)
  return asset
}

export class TokenServiceImpl implements TokenService {

  constructor(readonly fireblocksSdk: FireblocksSDK, readonly provider: Provider, readonly signer: Signer, readonly logger: Logger) {}

  async createAsset(idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined, assetMetadata: any, assetName: string | undefined, issuerId: string | undefined, assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    const { chainId, name } = await this.provider.getNetwork()
    this.fireblocksSdk.registerNewAsset(
      (await this.provider.getNetwork()).chainId.toString(),
      "0x1234",
      assetIdentifier?.value ?? "123"
    )
    throw new Error('Method not implemented.');
  }

  async getBalance(assetId: string, finId: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
  async balance(assetId: string, finId: string): Promise<Balance> {
    throw new Error('Method not implemented.');
  }

  async issue(idempotencyKey: string, ast: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)

    const tx = await ((): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function mint(address to, uint256 amount)"], this.signer)
          return c.mint("0x17567624640Cd7b78Bfde6699861E2154012386c", 1)
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
        source: { account: to, finId: to.finId },
        destination: { account: to, finId: to.finId },
        operationType: "issue",
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

  async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, ast: Asset, quantity: string, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)

    const tx = await ((): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], this.signer)
          return c.transfer("0x17567624640Cd7b78Bfde6699861E2154012386c", 1)
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
