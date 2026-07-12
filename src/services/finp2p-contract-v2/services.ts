import {
  Asset, AssetBind, AssetCreationStatus, AssetDenomination, AssetCreationResult, Balance,
  Destination, EscrowService, ExecutionContext, ReceiptOperation, Signature, Source, TokenService,
  failedReceiptOperation, logger
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  EthereumTransactionError,
  FinP2PPlanContract,
  PlanInstruction,
  PlanInstructionType
} from "@owneraio/finp2p-contracts";
import { EscrowServiceImpl, TokenServiceImpl } from "../finp2p-contract";
import { ExecDetailsStore } from "../finp2p-contract/common";
import { mapReceiptOperation } from "../finp2p-contract/mapping";
import { ProofSyncService } from "./proof-sync";

/**
 * Shared plan-execution routine of the v2 services: sync the cursor (proofs of
 * remote instructions, no-op awaits), validate the incoming request against
 * the stored on-chain instruction, then execute it — no signatures involved,
 * they were verified at plan creation.
 *
 * Requests without an execution context — or for plans that were never
 * mirrored on-chain — fall through to the v1 services against the legacy
 * operator contract, so standalone operations keep working unchanged.
 */
class PlanExecutor {

  constructor(
    readonly planContract: FinP2PPlanContract,
    readonly proofSync: ProofSyncService,
    readonly execDetailsStore: ExecDetailsStore | undefined
  ) {}

  async isPlanBased(exCtx: ExecutionContext | undefined): Promise<boolean> {
    if (!exCtx || !exCtx.planId || exCtx.planId.trim().length === 0) return false;
    return await this.planContract.hasPlan(exCtx.planId);
  }

  async execute(
    exCtx: ExecutionContext,
    asset: Asset,
    expectedTypes: PlanInstructionType[],
    validate: (instruction: PlanInstruction) => string | undefined
  ): Promise<ReceiptOperation> {
    const { planId, sequence } = exCtx;
    try {
      await this.proofSync.ensureCursorAt(planId, sequence);

      const instruction = await this.planContract.getInstruction(planId, sequence);
      if (!expectedTypes.includes(instruction.instructionType)) {
        return failedReceiptOperation(1,
          `Plan ${planId} instruction ${sequence} is of type ${PlanInstructionType[instruction.instructionType]}, not one of [${expectedTypes.map(t => PlanInstructionType[t]).join(", ")}]`);
      }
      if (instruction.assetId !== asset.assetId) {
        return failedReceiptOperation(1,
          `Plan ${planId} instruction ${sequence} is for asset ${instruction.assetId}, not ${asset.assetId}`);
      }
      const mismatch = validate(instruction);
      if (mismatch) {
        return failedReceiptOperation(1, `Plan ${planId} instruction ${sequence}: ${mismatch}`);
      }

      const txReceipt = await this.planContract.executeInstruction(planId, sequence);
      this.execDetailsStore?.addExecutionContext(txReceipt.hash, planId, sequence);
      return mapReceiptOperation(await this.planContract.getReceiptFromTransactionReceipt(txReceipt), asset, exCtx);
    } catch (e) {
      logger.error(`Error executing plan instruction ${planId}/${sequence}: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      }
      return failedReceiptOperation(1, `${e}`);
    }
  }
}

const quantityMismatch = (instruction: PlanInstruction, quantity: string): string | undefined =>
  instruction.amount !== quantity ? `amount ${instruction.amount} differs from requested ${quantity}` : undefined;

export class PlanTokenService implements TokenService {

  private readonly executor: PlanExecutor;

  constructor(
    planContract: FinP2PPlanContract,
    proofSync: ProofSyncService,
    execDetailsStore: ExecDetailsStore | undefined,
    private readonly fallback: TokenServiceImpl
  ) {
    this.executor = new PlanExecutor(planContract, proofSync, execDetailsStore);
  }

  async createAsset(idempotencyKey: string, assetId: string, assetBind: AssetBind | undefined,
                    assetMetadata: any | undefined, assetName: string | undefined, issuerId: string | undefined,
                    assetDenomination: AssetDenomination | undefined): Promise<AssetCreationStatus> {
    return this.fallback.createAsset(idempotencyKey, assetId, assetBind, assetMetadata, assetName, issuerId, assetDenomination);
  }

  async issue(idempotencyKey: string, asset: Asset, destinationFinId: string, quantity: string,
              exCtx: ExecutionContext): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return this.fallback.issue(idempotencyKey, asset, destinationFinId, quantity, exCtx);
    }
    return this.executor.execute(exCtx, asset, [PlanInstructionType.Issue], (instruction) =>
      instruction.destination !== destinationFinId
        ? `destination ${instruction.destination} differs from requested ${destinationFinId}`
        : quantityMismatch(instruction, quantity));
  }

  async transfer(idempotencyKey: string, nonce: string, source: Source, destination: Destination, asset: Asset,
                 quantity: string, signature: Signature, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return this.fallback.transfer(idempotencyKey, nonce, source, destination, asset, quantity, signature, exCtx);
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
      return this.fallback.redeem(idempotencyKey, nonce, sourceFinId, asset, quantity, operationId, signature, exCtx);
    }
    return this.executor.execute(exCtx, asset,
      [PlanInstructionType.Redeem, PlanInstructionType.ReleaseAndRedeem], (instruction) =>
        instruction.source !== sourceFinId
          ? `source ${instruction.source} differs from requested ${sourceFinId}`
          : quantityMismatch(instruction, quantity));
  }

  async getBalance(asset: Asset, finId: string): Promise<string> {
    return this.fallback.getBalance(asset, finId);
  }

  async balance(asset: Asset, finId: string): Promise<Balance> {
    return this.fallback.balance(asset, finId);
  }
}

export class PlanEscrowService implements EscrowService {

  private readonly executor: PlanExecutor;

  constructor(
    planContract: FinP2PPlanContract,
    proofSync: ProofSyncService,
    execDetailsStore: ExecDetailsStore | undefined,
    private readonly fallback: EscrowServiceImpl
  ) {
    this.executor = new PlanExecutor(planContract, proofSync, execDetailsStore);
  }

  async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, asset: Asset,
             quantity: string, signature: Signature, operationId: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return this.fallback.hold(idempotencyKey, nonce, source, destination, asset, quantity, signature, operationId, exCtx);
    }
    return this.executor.execute(exCtx, asset, [PlanInstructionType.Hold], (instruction) =>
      instruction.source !== source.finId
        ? `source ${instruction.source} differs from requested ${source.finId}`
        : quantityMismatch(instruction, quantity));
  }

  async release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string,
                operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return this.fallback.release(idempotencyKey, source, destination, asset, quantity, operationId, exCtx);
    }
    return this.executor.execute(exCtx!, asset,
      [PlanInstructionType.Release, PlanInstructionType.ReleaseAndRedeem], (instruction) =>
        instruction.instructionType === PlanInstructionType.Release && instruction.destination !== destination.finId
          ? `destination ${instruction.destination} differs from requested ${destination.finId}`
          : quantityMismatch(instruction, quantity));
  }

  async rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string,
                 exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return this.fallback.rollback(idempotencyKey, source, asset, quantity, operationId, exCtx);
    }
    return this.executor.execute(exCtx!, asset, [PlanInstructionType.RevertHold], () => undefined);
  }
}
