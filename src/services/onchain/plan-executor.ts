import {
  Asset, ExecutionContext, ReceiptOperation,
  failedReceiptOperation, logger
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  EthereumTransactionError,
  FinP2POrchestratorContract,
  PlanInstruction,
  PlanInstructionType
} from "@owneraio/finp2p-ethereum-orchestrator";
import { ExecDetailsStore } from "./exec-details-store";
import { mapReceiptOperation } from "./mapping";
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
export class PlanExecutor {

  constructor(
    readonly orchestrator: FinP2POrchestratorContract,
    readonly proofSync: ProofSyncService,
    readonly execDetailsStore: ExecDetailsStore | undefined
  ) {}

  async isPlanBased(exCtx: ExecutionContext | undefined): Promise<boolean> {
    if (!exCtx || !exCtx.planId || exCtx.planId.trim().length === 0) return false;
    return await this.orchestrator.hasPlan(exCtx.planId);
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

      const instruction = await this.orchestrator.getInstruction(planId, sequence);
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

      const txReceipt = await this.orchestrator.executeInstruction(planId, sequence);
      this.execDetailsStore?.addExecutionContext(txReceipt.hash, planId, sequence);
      return mapReceiptOperation(await this.orchestrator.getReceiptFromTransactionReceipt(txReceipt), asset, exCtx);
    } catch (e) {
      logger.error(`Error executing plan instruction ${planId}/${sequence}: ${e}`);
      if (e instanceof EthereumTransactionError) {
        return failedReceiptOperation(1, e.message);
      }
      return failedReceiptOperation(1, `${e}`);
    }
  }
}

export const quantityMismatch = (instruction: PlanInstruction, quantity: string): string | undefined =>
  instruction.amount !== quantity ? `amount ${instruction.amount} differs from requested ${quantity}` : undefined;
