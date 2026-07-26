import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination, Balance,
  CommonService, Destination, ExecutionContext, HealthService, OperationStatus,
  ReceiptOperation, Signature, Source, TokenService,
  failedAssetCreation, failedReceiptOperation, successfulAssetCreation, logger
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { formatUnits } from "ethers";
import {
  ERC20_STANDARD_ID,
  EthereumTransactionError,
  FinP2POrchestratorContract,
  PlanInstructionType,
  isEthereumAddress
} from "@owneraio/finp2p-ethereum-orchestrator";
import { ERC20WithOperator__factory, Erc20WithOperatorContract } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { ExecDetailsStore } from "./exec-details-store";
import { mapReceiptOperation } from "./mapping";
import { PlanExecutor, quantityMismatch } from "./plan-executor";
import { ProofSyncService } from "./proof-sync";

const DefaultDecimals = 2;

export class PlanTokenService implements TokenService, CommonService, HealthService {

  private readonly executor: PlanExecutor;

  constructor(
    orchestrator: FinP2POrchestratorContract,
    proofSync: ProofSyncService,
    execDetailsStore: ExecDetailsStore | undefined,
    // bytes32 asset-standard id used when mirroring associations (defaults to
    // the package-level ERC20 standard id)
    private readonly defaultAssetStandard?: string
  ) {
    this.executor = new PlanExecutor(orchestrator, proofSync, execDetailsStore);
  }

  private get orchestrator(): FinP2POrchestratorContract {
    return this.executor.orchestrator;
  }

  async readiness() {
    await this.orchestrator.provider.getNetwork();
  }

  async liveness() {
    await this.orchestrator.provider.getBlockNumber();
  }

  async getReceipt(id: string): Promise<ReceiptOperation> {
    return mapReceiptOperation(await this.orchestrator.getReceipt(id), undefined, this.executor.execDetailsStore?.getExecutionContext(id));
  }

  async operationStatus(cid: string): Promise<OperationStatus> {
    const op = await this.orchestrator.getOperationStatus(cid);
    if (op.operation === 'receipt') return mapReceiptOperation(op, undefined, this.executor.execDetailsStore?.getExecutionContext(cid));
    return op as any;
  }

  async createAsset(idempotencyKey: string, assetId: string, assetBind: AssetBind | undefined,
                    assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                    assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    try {
      const standardId = this.defaultAssetStandard ?? ERC20_STANDARD_ID;
      let tokenAddress: string;
      if (assetBind?.tokenIdentifier?.tokenId && isEthereumAddress(assetBind.tokenIdentifier.tokenId)) {
        tokenAddress = assetBind.tokenIdentifier.tokenId;
        logger.debug(`Associating existing token ${tokenAddress} to asset ${assetId}`);
      } else {
        const standardAddress = await this.orchestrator.getRegisteredAssetStandard(standardId);
        const token = await new ERC20WithOperator__factory(this.orchestrator.signer)
          .deploy(assetId, assetId, DefaultDecimals, standardAddress);
        await token.waitForDeployment();
        tokenAddress = await token.getAddress();
        logger.debug(`Deployed new token ${tokenAddress} for asset ${assetId}`);
      }

      await this.registerAsset(assetId, tokenAddress, standardId);

      const { chainId, name } = await this.orchestrator.provider.getNetwork();
      const network = `name: ${name}, chainId: ${chainId}`;
      return successfulAssetCreation({
        ledgerIdentifier: { assetIdentifierType: 'CAIP-19', network, tokenId: tokenAddress, standard: standardId },
        reference: {
          type: "ledgerReference",
          network,
          address: tokenAddress,
          tokenStandard: standardId,
          additionalContractDetails: {
            finP2POperatorContractAddress: this.orchestrator.orchestratorAddress,
            allowanceRequired: false
          }
        }
      });
    } catch (e) {
      logger.error(`Error creating asset: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedAssetCreation(1, e.message);
      }
      return failedAssetCreation(1, `${e}`);
    }
  }

  private async registerAsset(assetId: string, tokenAddress: string, standardId: string): Promise<void> {
    try {
      await this.orchestrator.associateAsset(assetId, tokenAddress, standardId);
    } catch (e) {
      if (!`${e}`.includes("Asset already exists")) throw e; // idempotent retry
    }
    // ERC20WithOperator roles: the registered AssetStandard executes the
    // orchestrator's mint/burn/transfer, the escrow pulls deposits. Grants
    // only work when the adapter's account is the token admin (the deploy
    // path); bound external tokens may refuse.
    const escrowAddress = await this.orchestrator.getEscrowAddress();
    const standardAddress = await this.orchestrator.getRegisteredAssetStandard(standardId);
    const erc20 = ERC20WithOperator__factory.connect(tokenAddress, this.orchestrator.signer);
    try {
      await (await erc20.grantOperatorTo(standardAddress)).wait();
      await (await erc20.grantMinterTo(standardAddress)).wait();
      await (await erc20.grantOperatorTo(escrowAddress)).wait();
    } catch (e) {
      logger.warning(`Could not grant token roles on ${tokenAddress} to the asset standard/escrow (bound token?): ${e}`);
    }
  }

  async issue(idempotencyKey: string, asset: Asset, destinationFinId: string, quantity: string,
              exCtx: ExecutionContext): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return failedReceiptOperation(1, `Issue of ${asset.assetId} requires an execution plan mirrored on-chain`);
    }
    return this.executor.execute(exCtx, asset, [PlanInstructionType.Issue], (instruction) =>
      instruction.destination !== destinationFinId
        ? `destination ${instruction.destination} differs from requested ${destinationFinId}`
        : quantityMismatch(instruction, quantity));
  }

  async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
                 quantity: string, signature: Signature, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return failedReceiptOperation(1, `Transfer of ${asset.assetId} requires an execution plan mirrored on-chain`);
    }
    // the incoming signature is intentionally unused: it was verified on-chain at plan creation
    return this.executor.execute(exCtx, asset, [PlanInstructionType.Transfer], (instruction) =>
      instruction.source !== source.finId
        ? `source ${instruction.source} differs from requested ${source.finId}`
        : instruction.destination !== destination.finId
          ? `destination ${instruction.destination} differs from requested ${destination.finId}`
          : quantityMismatch(instruction, quantity));
  }

  async redeem(idempotencyKey: string, nonce: string, sourceFinId: string, asset: Asset, quantity: string,
               operationId: string | undefined, signature: Signature, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return failedReceiptOperation(1, `Redeem of ${asset.assetId} requires an execution plan mirrored on-chain`);
    }
    return this.executor.execute(exCtx, asset,
      [PlanInstructionType.Redeem, PlanInstructionType.ReleaseAndRedeem], (instruction) =>
        instruction.source !== sourceFinId
          ? `source ${instruction.source} differs from requested ${sourceFinId}`
          : quantityMismatch(instruction, quantity));
  }

  async getBalance(asset: Asset, finId: string): Promise<string> {
    const { balance, decimals } = await this.readBalance(asset, finId);
    return formatUnits(balance, decimals);
  }

  async balance(asset: Asset, finId: string): Promise<Balance> {
    const { balance, decimals } = await this.readBalance(asset, finId);
    const current = formatUnits(balance, decimals);
    return { current, available: current, held: "0" };
  }

  private async readBalance(asset: Asset, finId: string): Promise<{ balance: bigint, decimals: bigint }> {
    const tokenAddress = await this.orchestrator.getAssetAddress(asset.assetId);
    const holder = await this.orchestrator.getCredentialAddress(finId);
    const erc20 = new Erc20WithOperatorContract(this.orchestrator.signer, tokenAddress);
    return { balance: await erc20.balanceOf(holder), decimals: await erc20.decimals() };
  }
}
