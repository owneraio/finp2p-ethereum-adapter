import { Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier, Balance, Destination, ExecutionContext, FinIdAccount, Logger, ReceiptOperation, Signature, Source, TokenService, failedReceiptOperation } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Contract, ContractTransactionResponse, BrowserProvider, Signer, parseUnits } from "ethers";
import { FireblocksSDK } from 'fireblocks-sdk'
import { ContractsManager } from '@owneraio/finp2p-contracts'

async function getAssetFromDb(ast: Asset): Promise<workflows.Asset> {
  const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType })
  if (asset === undefined) throw new Error(`Asset(type=(${ast.assetType},id=${ast.assetId}) is not registered in DB`)
  return asset
}

export class TokenServiceImpl implements TokenService {

  constructor(readonly fireblocksSdk: FireblocksSDK, readonly provider: BrowserProvider, readonly signer: Signer, readonly logger: Logger) {}

  async createAsset(idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined, assetMetadata: any, assetName: string | undefined, issuerId: string | undefined, assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    const { chainId, name } = await this.provider.getNetwork()

    const cm = new ContractsManager(this.provider, this.signer, this.logger)
    const decimals = 18
    const erc20 = await cm.deployERC20Detached(assetName ?? "OWNERACOIN", "OWENRA", decimals, await (await this.provider.getSigner()).getAddress())
    const savedAsset = await workflows.saveAsset({ contract_address: erc20, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType })

    const responseRegister = await this.fireblocksSdk.registerNewAsset('ETH_TEST5', erc20, "OWNERA")
    console.debug(responseRegister)

    const responseVault = await this.fireblocksSdk.createVaultAsset("0", responseRegister.legacyId)
    console.debug(responseVault)

    if (assetDenomination !== undefined) {
      const responsePrice = await this.fireblocksSdk.setAssetPrice(responseRegister.legacyId, assetDenomination.code, 1.24)
      console.debug(responsePrice)
    }

    return {
      operation: "createAsset",
      type: "success",
      result: {
        tokenId: erc20,
        reference: undefined
      }
    }
  }

  async getBalance(assetId: string, finId: string): Promise<string> {
    throw new Error('Method not implemented.');
  }
  async balance(assetId: string, finId: string): Promise<Balance> {
    throw new Error('Method not implemented.');
  }

  async issue(idempotencyKey: string, ast: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)
    const signer = await this.provider.getSigner()
    const address = await signer.getAddress()
    const amount = parseUnits(quantity, asset.decimals)

    const tx = await ((): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function mint(address to, uint256 amount)"], this.signer)
          return c.mint(address, amount)
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
