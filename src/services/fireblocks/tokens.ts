import { Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier, Balance, Destination, ExecutionContext, FinIdAccount, Logger, ReceiptOperation, Signature, Source, TokenService, failedReceiptOperation } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Contract, ContractTransactionResponse, BrowserProvider, Signer, parseUnits } from "ethers";
import { FireblocksAppConfig } from '../../config'
import { ContractsManager, finIdToAddress } from '@owneraio/finp2p-contracts'

async function getAssetFromDb(ast: Asset): Promise<workflows.Asset> {
  const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType })
  if (asset === undefined) throw new Error(`Asset(type=(${ast.assetType},id=${ast.assetId}) is not registered in DB`)
  return asset
}

export class TokenServiceImpl implements TokenService {

  constructor(readonly logger: Logger, readonly appConfig: FireblocksAppConfig) {}

  private async providerForMyAddress(address: string): Promise<BrowserProvider> {
    const provider = await this.appConfig.createProviderForExternalAddress(address)
    if (provider === undefined) throw new Error(`VaultID for address ${address} cannot be resolved`)

    return new BrowserProvider(provider)
  }

  async createAsset(idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined, assetMetadata: any, assetName: string | undefined, issuerId: string | undefined, assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    const { provider, signer, fireblocksSdk } = this.appConfig
    const { chainId, name } = await provider.getNetwork()

    const cm = new ContractsManager(provider, signer, this.logger)
    const decimals = 18
    console.log(assetMetadata)
    const erc20 = await cm.deployERC20Detached(assetName ?? "OWNERACOIN", assetIdentifier?.value ?? "OWENRA", decimals, await (await provider.getSigner()).getAddress())
    const savedAsset = await workflows.saveAsset({ contract_address: erc20, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType })

    const responseRegister = await fireblocksSdk.registerNewAsset('ETH_TEST5', erc20, "OWNERA")
    console.debug(responseRegister)

    const responseVault = await fireblocksSdk.createVaultAsset("0", responseRegister.legacyId)
    console.debug(responseVault)

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
    const asset = await workflows.getAssetById(assetId)
    if (asset === undefined) throw new Error(`Asset(id=${assetId}) is not registered in DB`)

    const balance = await this.appConfig.balance(finIdToAddress(finId), asset.contract_address)
    if (balance === undefined) throw new Error('Balance cannot be determined')

    return balance
  }

  async balance(assetId: string, finId: string): Promise<Balance> {
    return {
      current: await this.getBalance(assetId, finId),
      available: await this.getBalance(assetId, finId),
      held: "0"
    }
  }

  async issue(idempotencyKey: string, ast: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)
    const signer = await this.appConfig.signer
    const address = finIdToAddress(to.finId)
    const amount = parseUnits(quantity, asset.decimals)

    const tx = await ((): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function mint(address to, uint256 amount)"], signer)
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

    const sourceAddress = finIdToAddress(source.finId)
    const provider = await this.providerForMyAddress(sourceAddress)
    const amount = parseUnits(quantity, asset.decimals)

    const tx = await (async (): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], await provider.getSigner())
          return c.transfer(finIdToAddress(destination.finId), amount)
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
