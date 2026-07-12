import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  ExecutionVenue,
  FinP2PPlanContract,
  LedgerProof,
  PlanInstructionType
} from "@owneraio/finp2p-contracts";

type RawReceiptProofMessage = {
  id: string;
  operationType: string;
  source: { accountType: string; finId: string };
  destination: { accountType: string; finId: string };
  asset: { assetId: string; assetType: string };
  quantity: string;
  tradeDetails: { executionContext: { executionPlanId: string; instructionSequenceNumber: string } };
  transactionDetails: { operationId: string; transactionId: string };
};

/**
 * Advances the on-chain cursor of a plan up to (but excluding) a target
 * sequence before a local instruction executes:
 *  - other-ledger instructions are proven with the EIP-712 receipt proof
 *    attached to the plan's instruction-completion events (the orchestrator
 *    only dispatches local instruction N after remote N-1 completed, so the
 *    proof is available exactly when it's needed);
 *  - local `await` instructions (no token operation) are executed as no-ops.
 * Any other pending local instruction belongs to a regular adapter call and
 * stops the sync.
 */
export class ProofSyncService {

  constructor(
    private readonly planContract: FinP2PPlanContract,
    private readonly finP2PClient: FinP2PClient | undefined
  ) {}

  async ensureCursorAt(planId: string, targetSequence: number): Promise<void> {
    let plan = await this.planContract.getPlan(planId);
    while (plan.currentSequence < targetSequence) {
      const sequence = plan.currentSequence;
      const instruction = await this.planContract.getInstruction(planId, sequence);

      if (instruction.venue === ExecutionVenue.OnLedger) {
        if (instruction.instructionType !== PlanInstructionType.Await) {
          // a regular local instruction the orchestrator hasn't dispatched yet —
          // nothing to sync; the caller's own execution will fail cursor checks
          // and report the ordering problem
          logger.warning(`Plan ${planId}: instruction ${sequence} is local and pending; cannot advance to ${targetSequence}`);
          return;
        }
        logger.info(`Plan ${planId}: executing await instruction ${sequence}`);
        await this.planContract.executeInstruction(planId, sequence);
      } else {
        const { proof, signature } = await this.fetchRemoteProof(planId, sequence);
        logger.info(`Plan ${planId}: completing off-ledger instruction ${sequence} on-chain`);
        await this.planContract.completeOffLedgerInstruction(planId, sequence, proof, signature);
      }

      plan = await this.planContract.getPlan(planId);
      if (plan.currentSequence <= sequence) {
        throw new Error(`Plan ${planId}: cursor did not advance past instruction ${sequence}`);
      }
    }
  }

  /**
   * Pull the signature proof of a completed remote instruction from the plan's
   * instruction-completion events. The signed EIP-712 Receipt message rides in
   * the proof's signature template.
   */
  private async fetchRemoteProof(planId: string, sequence: number): Promise<{ proof: LedgerProof, signature: string }> {
    if (!this.finP2PClient) {
      throw new Error(`No FinP2P client configured; cannot fetch completion proof for plan ${planId} instruction ${sequence}`);
    }
    const { data: execution } = await this.finP2PClient.getExecutionPlan(planId) as unknown as { data: any };
    if (!execution) {
      throw new Error(`Execution plan ${planId} not found`);
    }
    const event = (execution.instructionsCompletionEvents ?? [])
      .find((e: { instructionSequenceNumber: number }) => e.instructionSequenceNumber === sequence);
    if (!event || event.output?.type !== "receipt") {
      throw new Error(`No completion receipt for plan ${planId} instruction ${sequence} yet`);
    }
    const proofPolicy = event.output.proof;
    if (!proofPolicy || proofPolicy.type !== "signatureProofPolicy") {
      throw new Error(`Completion receipt of plan ${planId} instruction ${sequence} carries no signature proof`);
    }
    const { signature, template } = proofPolicy.signature;
    if (template?.type !== "EIP712" || template.primaryType !== "Receipt") {
      throw new Error(`Signature proof of plan ${planId} instruction ${sequence} is not an EIP712 Receipt proof`);
    }
    const message = template.message as RawReceiptProofMessage;
    return {
      proof: {
        id: message.id,
        operationType: message.operationType,
        sourceAccountType: message.source?.accountType ?? "",
        sourceFinId: message.source?.finId ?? "",
        destinationAccountType: message.destination?.accountType ?? "",
        destinationFinId: message.destination?.finId ?? "",
        assetId: message.asset?.assetId ?? "",
        assetType: message.asset?.assetType ?? "",
        executionPlanId: message.tradeDetails?.executionContext?.executionPlanId ?? "",
        instructionSequenceNumber: message.tradeDetails?.executionContext?.instructionSequenceNumber ?? "",
        operationId: message.transactionDetails?.operationId ?? "",
        transactionId: message.transactionDetails?.transactionId ?? "",
        quantity: message.quantity
      },
      signature
    };
  }
}
