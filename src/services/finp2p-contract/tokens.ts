import {
  Asset, AssetCreationStatus, EIP712Template, Balance, TokenService,
  failedAssetCreation, successfulAssetCreation,
  failedReceiptOperation, successfulReceiptOperation, pendingReceiptOperation,
  AssetBind, AssetDenomination, AssetCreationResult, Destination, ExecutionContext,
  ReceiptOperation, Source, Signature, logger, ProofProvider, PluginManager,
  storage,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { ValidationError } from "@owneraio/finp2p-contracts";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  term, isEthereumAddress
} from "@owneraio/finp2p-contracts";

import { CommonServiceImpl, ExecDetailsStore } from "./common";
import { mapReceiptOperation } from "./mapping";
import { emptyOperationParams, extractBusinessDetails } from "./helpers";
import { validateRequest } from "./validator";

type AssetStore = InstanceType<typeof storage.PgAssetStore>;

const DefaultDecimals = 2;

/**
 * 0.28.2+ FINP2POperator extracts the ERC20 contract address from the trailing
 * ":0x<40-hex>" of each assetId. EIP712-signed flows carry the CAIP-style id
 * natively (e.g. "name: sepolia, chainId: .../ERC20:0x..."). Unsigned paths
 * (`issue`, balance reads) receive a plain resourceId from the API; the adapter
 * resolves the tokenAddress from its local AssetStore (populated during
 * `createAsset`) and appends the CAIP suffix.
 */
const toContractAssetId = async (asset: Asset, assetStore: AssetStore | undefined): Promise<string> => {
  // Already CAIP-encoded with a token-address suffix — pass through.
  if (/:0x[a-fA-F0-9]{40}$/.test(asset.assetId)) return asset.assetId;
  // Prefer an explicit ledgerIdentifier.tokenId iff it's a real EVM address.
  const tokenFromLi = asset.ledgerIdentifier?.tokenId;
  if (tokenFromLi && isEthereumAddress(tokenFromLi)) {
    return `${asset.assetId}/${asset.ledgerIdentifier?.standard ?? 'ERC20'}:${tokenFromLi}`;
  }
  // Fall back to the adapter's local asset store.
  if (assetStore) {
    const record = await assetStore.getAsset(asset.assetId);
    if (record?.contract_address) {
      return `${asset.assetId}/${record.token_standard ?? 'ERC20'}:${record.contract_address}`;
    }
  }
  return asset.assetId;
};

export class TokenServiceImpl extends CommonServiceImpl implements TokenService {


  private readonly assetStore: AssetStore | undefined;

  constructor(finP2PContract: FinP2PContract, finP2PClient: FinP2PClient | undefined,
              execDetailsStore: ExecDetailsStore | undefined,
              proofProvider: ProofProvider | undefined,
              pluginManager: PluginManager | undefined,
              assetStore: AssetStore | undefined = undefined) {
    super(finP2PContract, finP2PClient, execDetailsStore, proofProvider, pluginManager);
    this.assetStore = assetStore;
  }

  public async createAsset(idempotencyKey: string, assetId: string,
                           assetBind: AssetBind | undefined, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    let tokenAddress: string;
    let allowanceRequired: boolean;
    const operatorAddress = this.finP2PContract.finP2PContractAddress;
    if (assetBind?.tokenIdentifier?.tokenId && isEthereumAddress(assetBind.tokenIdentifier.tokenId)) {
      tokenAddress = assetBind.tokenIdentifier.tokenId;
      allowanceRequired = true; // TODO: parse from metadata
      logger.info(`createAsset(${assetId}): binding to existing ERC20 at ${tokenAddress}`);
    } else {
      logger.info(`createAsset(${assetId}): deploying new ERC20 (decimals=${DefaultDecimals}, operator=${operatorAddress})`);
      try {
        tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, DefaultDecimals, operatorAddress);
      } catch (e) {
        logger.error(`createAsset(${assetId}): deployERC20 failed: ${e}`);
        if (e instanceof EthereumTransactionError) return failedAssetCreation(1, e.message);
        return failedAssetCreation(1, `${e}`);
      }
      allowanceRequired = false;
      logger.info(`createAsset(${assetId}): deployed ERC20 at ${tokenAddress}`);
    }
    // 0.28.3: the on-chain contract parses tokenAddress inline from CAIP-style
    // assetIds (primary). For legacy signers that still emit plain resourceIds
    // (e.g. adapter-tests 0.28.x), the contract also supports a fallback lookup
    // populated by associateAsset. Register both so either signer shape works.
    if (this.assetStore) {
      await this.assetStore.saveAsset({
        id: assetId,
        token_standard: 'ERC20',
        contract_address: tokenAddress,
        decimals: DefaultDecimals,
      });
    }
    try {
      await this.finP2PContract.associateAsset(assetId, tokenAddress);
    } catch (e) {
      logger.warning(`createAsset(${assetId}): associateAsset fallback registration failed (may already exist): ${e}`);
    }

    // TODO: parse assetMetadata to determine token standard and other details

    const { chainId, name } = await this.finP2PContract.provider.getNetwork();
    const network = `name: ${name}, chainId: ${chainId}`; // public or private network?
    const finP2POperatorContractAddress = this.finP2PContract.finP2PContractAddress;
    const result: AssetCreationResult = {
      ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network, tokenId: tokenAddress, standard: 'ERC20' },
      reference: {
        type: "ledgerReference",
        network,
        address: tokenAddress,
        tokenStandard: "ERC20",
        additionalContractDetails: {
          finP2POperatorContractAddress,
          allowanceRequired
        }
      }
    };
    return successfulAssetCreation(result);
  }

  public async issue(idempotencyKey: string, asset: Asset, destinationFinId: string, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    const issuerFinId = destinationFinId;
    try {
      await this.ensureCredential(issuerFinId);
      const contractAssetId = await toContractAssetId(asset, this.assetStore);
      const transactionReceipt = await this.finP2PContract.issue(issuerFinId, term(contractAssetId, assetTypeFromString(asset.assetType), quantity), emptyOperationParams())
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset)
    } catch (e) {
      logger.error(`Error on asset issuance: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, ast: Asset,
                        quantity: string, signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    const { signature: sgn, template } = signature;
    if (template.type != "EIP712") {
      throw new ValidationError(`Unsupported signature template type: ${template.type}`);
    }
    const eip712Template = template as EIP712Template;
    const details = extractBusinessDetails(ast, source, destination, undefined, eip712Template, exCtx);
    validateRequest(source, destination, quantity, details);
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = details;

    try {
      await this.ensureCredential(sellerFinId);
      await this.ensureCredential(buyerFinId);
      const transactionReceipt  = await this.finP2PContract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, sgn);
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
    }
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), ast)
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async redeem(idempotencyKey: string, nonce: string, sourceFinId: string, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    if (!operationId) {
      logger.error("No operationId provided");
      return failedReceiptOperation(1, "operationId is required");
    }

    try {
      await this.ensureCredential(sourceFinId);
      const transactionReceipt = await this.finP2PContract.releaseAndRedeem(operationId, sourceFinId, quantity, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset)
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }

  public async getBalance(asset: Asset, finId: string): Promise<string> {
    await this.ensureCredential(finId);
    return await this.finP2PContract.balance(await toContractAssetId(asset, this.assetStore), finId);
  }

  public async balance(asset: Asset, finId: string): Promise<Balance> {
    await this.ensureCredential(finId);
    const balance = await this.finP2PContract.balance(await toContractAssetId(asset, this.assetStore), finId);
    return {
      current: balance,
      available: balance,
      held: "0"
    };
  }

}

