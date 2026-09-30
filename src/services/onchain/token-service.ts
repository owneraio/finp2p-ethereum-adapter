import {
  Asset, AssetCreationStatus, EIP712Template, Balance, TokenService, EscrowService,
  CommonService, HealthService, OperationStatus,
  failedAssetCreation, successfulAssetCreation,
  failedReceiptOperation, successfulReceiptOperation,
  AssetBind, AssetDenomination, AssetCreationResult, Destination, ExecutionContext,
  Receipt, ReceiptOperation, Source, Signature, SwapLeg, SwapOperation,
  successfulSwapOperation, failedSwapOperation,
  logger, ProofProvider, PluginManager,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { Contract, keccak256, parseUnits, toUtf8Bytes } from "ethers";
import { Logger as SpiLogger, SwapIntent, SwapVenue, TokenWallet, mirrored } from "@owneraio/finp2p-ethereum-adapter-contract";
import {
  FinP2PContract,
  assetTypeFromString,
  EthereumTransactionError,
  ValidationError,
  term, isEthereumAddress
} from "@owneraio/finp2p-ethereum-orchestrator";
import { FinP2PClient } from "@owneraio/finp2p-client";

import { ExecDetailsStore } from "./exec-details-store";
import { mapReceiptOperation } from "./mapping";
import { emptyOperationParams, extractBusinessDetails, validateRequest } from "./helpers";
import { validateSwapWallets } from "../accounts";

const DefaultDecimals = 2;

/** LedgerBindingNotSupportedErr — the ledger does not support the requested network/standard. */
const LEDGER_BINDING_NOT_SUPPORTED = 7311;

const spiLogger: SpiLogger = {
  debug: (message, ...args) => logger.debug(message, ...args),
  info: (message, ...args) => logger.info(message, ...args),
  warn: (message, ...args) => logger.warning(message, ...args),
  error: (message, ...args) => logger.error(message, ...args),
};

const swapMovementReceipt = (id: string, transactionId: string, operationId: string, leg: SwapLeg,
                             exCtx: ExecutionContext | undefined, timestamp: number): Receipt => ({
  id,
  asset: leg.asset,
  source: leg.source,
  destination: leg.destination,
  quantity: leg.quantity,
  operationType: "swap",
  proof: undefined,
  timestamp,
  tradeDetails: { executionContext: exCtx },
  transactionDetails: { transactionId, operationId },
});

/**
 * On-chain (FINP2POperator contract) token, escrow and common operations —
 * every instruction executes as a transaction against the operator contract,
 * which verifies investor EIP-712 intents on-chain.
 */
export class OnChainTokenService implements TokenService, EscrowService, CommonService, HealthService {

  private readonly registeredCredentials = new Set<string>();

  constructor(
    readonly finP2PContract: FinP2PContract,
    readonly finP2PClient: FinP2PClient | undefined,
    readonly execDetailsStore: ExecDetailsStore | undefined,
    readonly proofProvider: ProofProvider | undefined,
    readonly pluginManager: PluginManager | undefined,
    readonly defaultAssetStandard: string | undefined = undefined,
    readonly swapVenue: SwapVenue | undefined = undefined,
  ) {}

  private operatorWallet(): TokenWallet {
    return { provider: this.finP2PContract.provider, signer: this.finP2PContract.signer };
  }

  private async ensureCredential(finId: string): Promise<void> {
    if (this.registeredCredentials.has(finId)) return;
    await this.finP2PContract.getCredentialAddress(finId);
    this.registeredCredentials.add(finId);
  }

  public async readiness() {
    await this.finP2PContract.provider.getNetwork();
  }

  public async liveness() {
    await this.finP2PContract.provider.getBlockNumber();
  }

  public async getReceipt(id: string): Promise<ReceiptOperation> {
    return mapReceiptOperation(await this.finP2PContract.getReceipt(id), undefined, this.execDetailsStore?.getExecutionContext(id));
  }

  public async operationStatus(cid: string): Promise<OperationStatus> {
    const op = await this.finP2PContract.getOperationStatus(cid);
    if (op.operation === 'receipt') return mapReceiptOperation(op, undefined, this.execDetailsStore?.getExecutionContext(cid));
    return op as any;
  }

  public async createAsset(idempotencyKey: string, assetId: string,
                           assetBind: AssetBind, assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                           assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    const { chainId, name } = await this.finP2PContract.provider.getNetwork();
    const requestedStandard = assetBind.standard;
    const responseStandard = requestedStandard ?? this.defaultAssetStandard;
    if (!responseStandard) {
      return failedAssetCreation(LEDGER_BINDING_NOT_SUPPORTED, 'No asset standard supplied and DEFAULT_ASSET_STANDARD env not set');
    }

    let tokenAddress: string;
    let allowanceRequired: boolean
    if (assetBind.tokenId && isEthereumAddress(assetBind.tokenId)) {
      tokenAddress = assetBind.tokenId;
      allowanceRequired = true; // TODO: parse from metadata
      logger.debug(`Associating existing token ${tokenAddress} to asset ${assetId}`);
    } else {
      const supportedNetwork = `eip155:${chainId}`;
      if (assetBind.network && assetBind.network !== supportedNetwork) {
        return failedAssetCreation(LEDGER_BINDING_NOT_SUPPORTED,
          `unsupported ledger network '${assetBind.network}', only ${supportedNetwork} is supported`);
      }
      tokenAddress = await this.finP2PContract.deployERC20(assetId, assetId, DefaultDecimals, this.finP2PContract.finP2PContractAddress);
      allowanceRequired = false;
      logger.debug(`Deployed new token ${tokenAddress} for asset ${assetId}`);
    }
    // The basic FINP2POperator's associateAsset takes 2 args; the WithRegistry
    // variant takes 3 (extra bytes32 assetStandard). Only thread the standard
    // through when the deployed variant needs it.
    const assetStandardId = this.finP2PContract.variant === 'with-registry'
      ? (requestedStandard ? keccak256(toUtf8Bytes(requestedStandard)) : this.defaultAssetStandard!)
      : undefined;

    try {
      const txHash = await this.finP2PContract.associateAsset(assetId, tokenAddress, assetStandardId);
    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedAssetCreation(1, e.message);
      } else {
        return failedAssetCreation(1, `${e}`);
      }
    }

    const network = `name: ${name}, chainId: ${chainId}`;
    const finP2POperatorContractAddress = this.finP2PContract.finP2PContractAddress;
    const result: AssetCreationResult = {
      ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network, tokenId: tokenAddress, standard: responseStandard },
      reference: {
        type: "ledgerReference",
        network,
        address: tokenAddress,
        tokenStandard: responseStandard,
        additionalContractDetails: {
          finP2POperatorContractAddress,
          allowanceRequired
        }
      }
    };
    return successfulAssetCreation(result);
  }

  public async issue(idempotencyKey: string, asset: Asset, destination: Destination, quantity: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    const issuerFinId = destination.finId;
    try {
      await this.ensureCredential(issuerFinId);
      const transactionReceipt = await this.finP2PContract.issue(issuerFinId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity), emptyOperationParams())
      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
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
      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), ast, exCtx)
    } catch (e) {
      logger.error(`Error on asset transfer: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }
  }

  public async redeem(idempotencyKey: string, nonce: string, source: Source, asset: Asset, quantity: string, operationId: string | undefined,
    signature: Signature, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    try {
      await this.ensureCredential(source.finId);
      const transactionReceipt = operationId
        ? await this.finP2PContract.releaseAndRedeem(operationId, source.finId, quantity, emptyOperationParams())
        : await this.finP2PContract.redeem(source.finId, term(asset.assetId, assetTypeFromString(asset.assetType), quantity), emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
    } catch (e) {
      logger.error(`Error redeeming asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }

  private async toSwapIntent(operationId: string, assetLeg: SwapLeg, settlementLeg: SwapLeg, deadline: number): Promise<SwapIntent> {
    const [token, counterToken, party, counterParty] = await Promise.all([
      this.finP2PContract.getAssetAddress(assetLeg.asset.assetId),
      this.finP2PContract.getAssetAddress(settlementLeg.asset.assetId),
      this.finP2PContract.getCredentialAddress(assetLeg.source.finId),
      this.finP2PContract.getCredentialAddress(settlementLeg.source.finId),
    ]);
    const [amount, counterAmount] = await Promise.all([
      this.toTokenUnits(token, assetLeg.quantity),
      this.toTokenUnits(counterToken, settlementLeg.quantity),
    ]);
    return {
      operationId,
      give: { token, party, amount },
      take: { token: counterToken, party: counterParty, amount: counterAmount },
      deadline: deadline || undefined,
    };
  }

  private async toTokenUnits(token: string, quantity: string): Promise<bigint> {
    const erc20 = new Contract(token, ["function decimals() view returns (uint8)"], this.finP2PContract.provider);
    return parseUnits(quantity, await erc20.decimals());
  }

  private async swapViaVenue(swapVenue: SwapVenue, operationId: string, assetLeg: SwapLeg,
                             settlementLeg: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    const intent = await this.toSwapIntent(operationId, assetLeg, settlementLeg, deadline);
    const submission = await swapVenue.swap(this.operatorWallet(), intent, spiLogger);
    if (submission.status === "failure") {
      return failedSwapOperation(1, submission.reason);
    }
    const { transactionId, timestamp } = submission;
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionId, exCtx.planId, exCtx.sequence);
    }
    return successfulSwapOperation(
      swapMovementReceipt(`${transactionId}:${assetLeg.asset.assetId}`, transactionId, operationId, assetLeg, exCtx, timestamp),
    );
  }

  public async swap(idempotencyKey: string, nonce: string, operationId: string, assetLeg: SwapLeg,
                    settlementLeg: SwapLeg, numberOfReceipts: number, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    if (numberOfReceipts === 2) {
      return this.swapBothLegs(operationId, assetLeg, settlementLeg, deadline, exCtx);
    }
    if (numberOfReceipts !== 1) {
      return failedSwapOperation(1, `numberOfReceipts must be 1 or 2, got ${numberOfReceipts}`);
    }
    try {
      if (!this.swapVenue) {
        return failedSwapOperation(1, "Swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set");
      }
      if (!operationId) {
        return failedSwapOperation(1, "operationId is required");
      }
      if (!assetLeg.signature) {
        return failedSwapOperation(1, "asset leg signature is required");
      }
      if (deadline && deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwapOperation(1, `swap deadline ${deadline} has already passed`);
      }
      if (assetLeg.destination.finId !== settlementLeg.source.finId) {
        return failedSwapOperation(1, `asset destination finId '${assetLeg.destination.finId}' does not match settlement source finId '${settlementLeg.source.finId}'`);
      }
      if (settlementLeg.destination.finId !== assetLeg.source.finId) {
        return failedSwapOperation(1, `settlement destination finId '${settlementLeg.destination.finId}' does not match asset source finId '${assetLeg.source.finId}'`);
      }

      const { chainId } = await this.finP2PContract.provider.getNetwork();
      const { approvalWallet, destinationWallet } = validateSwapWallets(assetLeg, settlementLeg, chainId);

      const ourWallet = await this.finP2PContract.getCredentialAddress(assetLeg.source.finId);
      if (approvalWallet && approvalWallet.toLowerCase() !== ourWallet.toLowerCase()) {
        return failedSwapOperation(1, `asset source wallet ${approvalWallet} does not match the registered credential ${ourWallet} holding the allowance`);
      }
      if (destinationWallet && destinationWallet.toLowerCase() !== ourWallet.toLowerCase()) {
        return failedSwapOperation(1, `settlement destination wallet ${destinationWallet} does not match the registered credential ${ourWallet} the swap settles to`);
      }

      return await this.swapViaVenue(this.swapVenue, operationId, assetLeg, settlementLeg, deadline, exCtx);
    } catch (e) {
      logger.error(`Error on swap: ${e}`);
      if (e instanceof EthereumTransactionError || e instanceof ValidationError) {
        return failedSwapOperation(1, e.message);
      }
      return failedSwapOperation(1, `${e}`);
    }
  }

  private async swapBothLegsViaVenue(swapVenue: SwapVenue, operationId: string, asset: SwapLeg,
                                     settlement: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    const intent = await this.toSwapIntent(operationId, asset, settlement, deadline);
    const [assetSubmission, settlementSubmission] = await Promise.all([
      swapVenue.swap(this.operatorWallet(), intent, spiLogger),
      swapVenue.swap(this.operatorWallet(), mirrored(intent), spiLogger),
    ]);
    if (assetSubmission.status === "failure") {
      return failedSwapOperation(1, assetSubmission.reason);
    }
    if (settlementSubmission.status === "failure") {
      return failedSwapOperation(1, settlementSubmission.reason);
    }
    const { transactionId, timestamp } = assetSubmission;
    if (exCtx) {
      this.execDetailsStore?.addExecutionContext(transactionId, exCtx.planId, exCtx.sequence);
    }
    const settlementExCtx = exCtx && {
      ...exCtx,
      counterpartyAssetId: exCtx.counterpartySettlementId,
      counterpartySettlementId: exCtx.counterpartyAssetId,
    };
    return successfulSwapOperation(
      swapMovementReceipt(`${transactionId}:${asset.asset.assetId}`, transactionId, operationId, asset, exCtx, timestamp),
      swapMovementReceipt(`${transactionId}:${settlement.asset.assetId}`, transactionId, operationId, settlement, settlementExCtx, timestamp),
    );
  }

  private async swapBothLegs(operationId: string, asset: SwapLeg,
                             settlement: SwapLeg, deadline: number, exCtx: ExecutionContext | undefined): Promise<SwapOperation> {
    try {
      if (!this.swapVenue) {
        return failedSwapOperation(1, "Swap is not supported: FINP2P_ETHEREUM_ALLOWANCE_SWAP_ADDRESS is not set");
      }
      if (!operationId) {
        return failedSwapOperation(1, "operationId is required");
      }
      if (!asset.signature) {
        return failedSwapOperation(1, "asset leg signature is required");
      }
      if (!settlement.signature) {
        return failedSwapOperation(1, "settlement leg signature is required");
      }
      if (deadline && deadline <= Math.floor(Date.now() / 1000)) {
        return failedSwapOperation(1, `swap deadline ${deadline} has already passed`);
      }
      if (asset.destination.finId !== settlement.source.finId) {
        return failedSwapOperation(1, `asset destination finId '${asset.destination.finId}' does not match settlement source finId '${settlement.source.finId}'`);
      }
      if (settlement.destination.finId !== asset.source.finId) {
        return failedSwapOperation(1, `settlement destination finId '${settlement.destination.finId}' does not match asset source finId '${asset.source.finId}'`);
      }
      const { chainId } = await this.finP2PContract.provider.getNetwork();
      validateSwapWallets(asset, settlement, chainId);

      return await this.swapBothLegsViaVenue(this.swapVenue, operationId, asset, settlement, deadline, exCtx);
    } catch (e) {
      logger.error(`Error on swap (both legs): ${e}`);
      if (e instanceof EthereumTransactionError || e instanceof ValidationError) {
        return failedSwapOperation(1, e.message);
      }
      return failedSwapOperation(1, `${e}`);
    }
  }

  public async getBalance(asset: Asset, finId: string): Promise<string> {
    await this.ensureCredential(finId);
    return await this.finP2PContract.balance(asset.assetId, finId);
  }

  public async balance(asset: Asset, finId: string): Promise<Balance> {
    await this.ensureCredential(finId);
    const balance = await this.finP2PContract.balance(asset.assetId, finId);
    return {
      current: balance,
      available: balance,
      held: "0"
    };
  }

  public async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, ast: Asset,
    quantity: string, sgn: Signature, operationId: string, exCtx: ExecutionContext
  ): Promise<ReceiptOperation> {
    const { signature, template } = sgn;
    if (template.type != "EIP712") {
      throw new ValidationError(`Unsupported signature template type: ${template.type}`);
    }
    const eip712Template = template as EIP712Template;
    const details = extractBusinessDetails(ast, source, destination, operationId, eip712Template, exCtx);
    validateRequest(source, destination, quantity, details);
    const { buyerFinId, sellerFinId, asset, settlement, loan, params } = details;

    try {
      await this.ensureCredential(sellerFinId);
      await this.ensureCredential(buyerFinId);
      const transactionReceipt = await this.finP2PContract.hold(nonce, sellerFinId, buyerFinId, asset, settlement, loan, params, signature);

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), ast, exCtx)
    } catch (e) {
      logger.error(`Error asset hold: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }


  }

  public async release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    try {
      await this.ensureCredential(source.finId);
      await this.ensureCredential(destination.finId);
      const transactionReceipt = await this.finP2PContract.releaseTo(operationId, source.finId, destination.finId, quantity, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
    } catch (e) {
      logger.error(`Error releasing asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }

  public async rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string, exCtx: ExecutionContext | undefined
  ): Promise<ReceiptOperation> {
    try {
      await this.ensureCredential(source.finId);
      const transactionReceipt = await this.finP2PContract.releaseBack(operationId, emptyOperationParams());

      if (exCtx) {
        this.execDetailsStore?.addExecutionContext(transactionReceipt.hash, exCtx.planId, exCtx.sequence);
      }

      return mapReceiptOperation(await this.finP2PContract.getReceiptFromTransactionReceipt(transactionReceipt), asset, exCtx)
    } catch (e) {
      logger.error(`Error rolling-back asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);

      } else {
        return failedReceiptOperation(1, `${e}`);
      }
    }

  }
}
