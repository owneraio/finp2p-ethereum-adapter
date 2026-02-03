import { Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier, Balance, Destination, ExecutionContext, FinIdAccount, Logger, ReceiptOperation, Signature, Source, TokenService, failedReceiptOperation } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Contract, ContractTransactionResponse, BrowserProvider, Signer, parseUnits, formatUnits } from "ethers";
import { FireblocksAppConfig } from '../../config'
import { ContractsManager, finIdToAddress } from '@owneraio/finp2p-contracts'

async function getAssetFromDb(ast: Asset): Promise<workflows.Asset> {
  const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType })
  if (asset === undefined) throw new Error(`Asset(type=(${ast.assetType},id=${ast.assetId}) is not registered in DB`)
  return asset
}

const increaseByBuffer = (input: bigint): bigint => (input * 120n) / 100n

export class TokenServiceImpl implements TokenService {

  private async fundVaultIdIfNeeded(vaultId: string) {
    if (this.appConfig.fundVaultIdGas !== undefined) {
      await this.appConfig.fundVaultIdGas(vaultId)
    }
  }

  constructor(readonly logger: Logger, readonly appConfig: FireblocksAppConfig) {}

  async createAsset(idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined, assetMetadata: any, assetName: string | undefined, issuerId: string | undefined, assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    const { provider, signer } = this.appConfig.assetIssuer
    const fireblocksSdk = this.appConfig.fireblocksSdk
    const { chainId, name } = await provider.getNetwork()

    const cm = new ContractsManager(provider, signer, this.logger)
    const decimals = 18
    console.log(assetMetadata)
    const erc20 = await cm.deploySimplifiedERC20({
      name: assetName ?? "OWNERACOIN",
      symbol: assetIdentifier?.value ?? "OWENRA",
      decimals,
      gasFunder: async (gasLimit) => {
        await this.fundVaultIdIfNeeded(this.appConfig.assetIssuer.vaultId)
      }
    })
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
    const { signer } = await this.appConfig.assetIssuer
    const address = finIdToAddress(to.finId)
    const amount = parseUnits(quantity, asset.decimals)

    const tx = await (async (): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function mint(address to, uint256 amount)"], signer)
          await this.fundVaultIdIfNeeded(this.appConfig.assetIssuer.vaultId)
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
    const provider = await this.appConfig.createProviderForExternalAddress(sourceAddress)
    if (provider === undefined) throw new Error('Source address cannot be converted to vault id')
    const amount = parseUnits(quantity, asset.decimals)

    const tx = await (async (): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], provider.signer)
          await this.fundVaultIdIfNeeded(provider.vaultId)
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

  async redeem(idempotencyKey: string, nonce: string, source: FinIdAccount, ast: Asset, quantity: string, operationId: string | undefined, signature: Signature, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)

    const sourceAddress = finIdToAddress(source.finId)
    const { signer, provider } = await this.appConfig.assetIssuer
    const amount = parseUnits(quantity, asset.decimals)

    const tx = await (async (): Promise<ContractTransactionResponse> => {
      switch (asset.token_standard) {
        case 'ERC20':
          const c = new Contract(asset.contract_address, ["function burn(address from, uint256 amount)"], signer)
          await this.fundVaultIdIfNeeded(this.appConfig.assetIssuer.vaultId)
          return c.burn(sourceAddress, amount)
      }
    })()

    const receipt = await tx.wait()
    if (receipt === null) return failedReceiptOperation(1, "receipt is null")
    const block = await receipt.getBlock()
    return {
      operation: 'receipt',
      type: 'success',
      receipt: {
        id: receipt.hash,
        asset: ast,
        operationType: 'redeem',
        source: {
          account: source,
          finId: source.finId
        },
        proof: undefined,
        destination: undefined,
        quantity,
        timestamp: block.timestamp,
        tradeDetails: {
          executionContext: exCtx
        },
        transactionDetails: {
          operationId,
          transactionId: receipt.hash
        }
      }
    }
  }
}
