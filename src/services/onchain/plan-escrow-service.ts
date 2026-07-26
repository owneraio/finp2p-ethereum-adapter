import {
  Asset, Destination, EscrowService, ExecutionContext, ReceiptOperation, Signature, Source,
  failedReceiptOperation
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  FinP2POrchestratorContract,
  PlanInstructionType
} from "@owneraio/finp2p-ethereum-orchestrator";
import { ExecDetailsStore } from "./exec-details-store";
import { PlanExecutor, quantityMismatch } from "./plan-executor";
import { ProofSyncService } from "./proof-sync";

export class PlanEscrowService implements EscrowService {

  private readonly executor: PlanExecutor;

  constructor(
    orchestrator: FinP2POrchestratorContract,
    proofSync: ProofSyncService,
    execDetailsStore: ExecDetailsStore | undefined
  ) {
    this.executor = new PlanExecutor(orchestrator, proofSync, execDetailsStore);
  }

  async hold(idempotencyKey: string, nonce: string, source: Source, destination: Destination | undefined, asset: Asset,
             quantity: string, signature: Signature, operationId: string, exCtx: ExecutionContext): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return failedReceiptOperation(1, `Hold of ${asset.assetId} requires an execution plan mirrored on-chain`);
    }
    return this.executor.execute(exCtx, asset, [PlanInstructionType.Hold], (instruction) =>
      instruction.source !== source.finId
        ? `source ${instruction.source} differs from requested ${source.finId}`
        : instruction.destination !== "" && instruction.destination !== destination?.finId
          ? `destination ${instruction.destination} differs from requested ${destination?.finId}`
          : quantityMismatch(instruction, quantity));
  }

  async release(idempotencyKey: string, source: Source, destination: Destination, asset: Asset, quantity: string,
                operationId: string, exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return failedReceiptOperation(1, `Release of ${asset.assetId} requires an execution plan mirrored on-chain`);
    }
    // redemption of escrowed funds (ReleaseAndRedeem) only goes through redeem()
    return this.executor.execute(exCtx!, asset, [PlanInstructionType.Release], (instruction) =>
      instruction.source !== source.finId
        ? `source ${instruction.source} differs from requested ${source.finId}`
        : instruction.destination !== destination.finId
          ? `destination ${instruction.destination} differs from requested ${destination.finId}`
          : quantityMismatch(instruction, quantity));
  }

  async rollback(idempotencyKey: string, source: Source, asset: Asset, quantity: string, operationId: string,
                 exCtx: ExecutionContext | undefined): Promise<ReceiptOperation> {
    if (!(await this.executor.isPlanBased(exCtx))) {
      return failedReceiptOperation(1, `Rollback of ${asset.assetId} requires an execution plan mirrored on-chain`);
    }
    return this.executor.execute(exCtx!, asset, [PlanInstructionType.RevertHold], (instruction) =>
      instruction.source !== "" && instruction.source !== source.finId
        ? `source ${instruction.source} differs from requested ${source.finId}`
        : quantityMismatch(instruction, quantity));
  }
}
