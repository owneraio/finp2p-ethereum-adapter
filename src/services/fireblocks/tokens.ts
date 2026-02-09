import { Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetIdentifier, Balance, Destination, ExecutionContext, FinIdAccount, Logger, ReceiptOperation, Signature, Source, TokenService, failedReceiptOperation, EscrowService } from '@owneraio/finp2p-adapter-models';
import { workflows } from '@owneraio/finp2p-nodejs-skeleton-adapter';
import { Contract, ContractTransactionResponse, BrowserProvider, Signer, parseUnits, formatUnits } from "ethers";
import { FireblocksAppConfig } from '../../config'
import { ContractsManager, finIdToAddress } from '@owneraio/finp2p-contracts'

async function getAssetFromDb(ast: Asset): Promise<workflows.Asset> {
  const asset = await workflows.getAsset({ id: ast.assetId, type: ast.assetType })
  if (asset === undefined) throw new Error(`Asset(type=(${ast.assetType},id=${ast.assetId}) is not registered in DB`)
  return asset
}

export class TokenServiceImpl implements TokenService, EscrowService {

  private async fundVaultIdIfNeeded(vaultId: string) {
    if (this.appConfig.fundVaultIdGas !== undefined) {
      await this.appConfig.fundVaultIdGas(vaultId)
    }
  }

  constructor(readonly logger: Logger, readonly appConfig: FireblocksAppConfig) {}

  async createAsset(idempotencyKey: string, asset: Asset, assetBind: AssetBind | undefined, assetMetadata: any, assetName: string | undefined, issuerId: string | undefined, assetDenomination: AssetDenomination | undefined, assetIdentifier: AssetIdentifier | undefined): Promise<AssetCreationStatus> {
    const fireblocksSdk = this.appConfig.fireblocksSdk
    if (assetBind === undefined || assetBind.tokenIdentifier === undefined) {
      const { provider, signer } = this.appConfig.assetIssuer
      const { chainId, name } = await provider.getNetwork()

      const cm = new ContractsManager(provider, signer, this.logger)
      const decimals = 6
      console.log(assetMetadata)
      await this.fundVaultIdIfNeeded(this.appConfig.assetIssuer.vaultId)
      const erc20 = await cm.deployERC20Detached(
        assetName ?? "OWNERACOIN",
        assetIdentifier?.value ?? "OWENRA",
        decimals,
        await signer.getAddress()
      )
      const savedAsset = await workflows.saveAsset({ contract_address: erc20, decimals, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType })

      const responseRegister = await fireblocksSdk.registerNewAsset('ETH_TEST5', erc20, assetIdentifier?.value ?? "OWNERA")
      console.debug(responseRegister)

      const responseVault = await fireblocksSdk.createVaultAsset("0", responseRegister.legacyId)
      console.debug(responseVault)

      return {
        operation: "createAsset",
        type: "success",
        result: {
          tokenId: savedAsset.contract_address,
          reference: undefined
        }
      }
    } else {
      const savedAsset = await workflows.saveAsset({ contract_address: assetBind.tokenIdentifier.tokenId, decimals: 6, token_standard: 'ERC20', id: asset.assetId, type: asset.assetType })
      try {
        const responseRegister = await fireblocksSdk.registerNewAsset('ETH_TEST5', assetBind.tokenIdentifier.tokenId)
        console.debug(responseRegister)


        const responseVault = await fireblocksSdk.createVaultAsset("0", responseRegister.legacyId)
        console.debug(responseVault)
      } catch (e) {
        console.error(e)
      }

      return {
        operation: "createAsset",
        type: "success",
        result: {
          tokenId: savedAsset.contract_address,
          reference: undefined
        }
      }
    }
  }

  async getBalance(ast: Asset, finId: string): Promise<string> {
    const asset = await getAssetFromDb(ast)

    const address = finIdToAddress(finId)
    const c = new Contract(asset.contract_address, ["function balanceOf(address account) view returns (uint256)"], this.appConfig.assetIssuer.provider)
    const d = await c.balanceOf(address)

    return formatUnits(d, asset.decimals)
  }

  async balance(ast: Asset, finId: string): Promise<Balance> {
    const b = await this.getBalance(ast, finId)

    return {
      current: b,
      available: b,
      held: "0"
    }
  }

  async issue(idempotencyKey: string, ast: Asset, to: FinIdAccount, quantity: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)
    const { signer } = await this.appConfig.assetIssuer
    const address = finIdToAddress(to.finId)
    const amount = parseUnits(quantity, asset.decimals)

    const c = new Contract(asset.contract_address, ["function mint(address to, uint256 amount)"], signer)
    await this.fundVaultIdIfNeeded(this.appConfig.assetIssuer.vaultId)
    const tx = await c.mint(address, amount)
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

    const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], provider.signer)
    await this.fundVaultIdIfNeeded(provider.vaultId)
    const tx = await c.transfer(finIdToAddress(destination.finId), amount)
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

    // assume that the asset is already held in escrow
    const escrowAddress = await this.appConfig.assetEscrow.signer.getAddress()
    const { signer, provider } = await this.appConfig.assetIssuer
    const amount = parseUnits(quantity, asset.decimals)

    const c = new Contract(asset.contract_address, ["function burn(address from, uint256 amount)"], signer)
    await this.fundVaultIdIfNeeded(this.appConfig.assetIssuer.vaultId)
    const tx = await c.burn(escrowAddress, amount)
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

  async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, ast: Asset, quantity: string, signature: Signature, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)

    const sourceAddress = finIdToAddress(source.finId)
    const provider = await this.appConfig.createProviderForExternalAddress(sourceAddress)
    if (provider === undefined) throw new Error('Source address cannot be converted to vault id')
    const amount = parseUnits(quantity, asset.decimals)

    const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], provider.signer)
    await this.fundVaultIdIfNeeded(provider.vaultId)
    const tx = await c.transfer(await this.appConfig.assetEscrow.signer.getAddress(), amount)
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
        operationType: "hold",
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

  async release(idempotencyKey: string, source: Source, destination: Destination, ast: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)

    const destinationAddress = finIdToAddress(destination.finId)
    const amount = parseUnits(quantity, asset.decimals)

    const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], this.appConfig.assetEscrow.signer)
    await this.fundVaultIdIfNeeded(this.appConfig.assetEscrow.vaultId)
    const tx = await c.transfer(destinationAddress, amount)
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
        operationType: "release",
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

  async rollback(idempotencyKey: string, source: Source, ast: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    const asset = await getAssetFromDb(ast)

    const sourceAddress = finIdToAddress(source.finId)
    const amount = parseUnits(quantity, asset.decimals)

    const c = new Contract(asset.contract_address, ["function transfer(address to, uint256 amount) returns (bool)"], this.appConfig.assetEscrow.signer)
    await this.fundVaultIdIfNeeded(this.appConfig.assetEscrow.vaultId)
    const tx = await c.transfer(sourceAddress, amount)
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
        destination: undefined,
        operationType: "release",
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
}
