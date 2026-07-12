import {
  PlanApprovalService,
  PlanApprovalStatus,
  PlanProposal,
  approvedPlan,
  rejectedPlan,
  logger
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { ExecutionPlanStatus, FinP2POrchestratorContract } from "@owneraio/finp2p-contracts";
import { RawExecutionPlan, translateExecutionPlan } from "./plan-translator";

/**
 * Plan approval for the v2 plan-based operator: approving a plan mirrors it
 * on-chain via `createPlan`, which verifies every investor EIP-712 signature
 * up front. A plan that cannot be mirrored (missing/invalid signatures,
 * untranslatable instructions, failed on-chain validation) is rejected.
 *
 * Business validation (plugins etc.) stays with the wrapped skeleton
 * implementation, which runs first.
 */
export class PlanBasedApprovalService implements PlanApprovalService {

  constructor(
    private readonly orgId: string,
    private readonly orchestrator: FinP2POrchestratorContract,
    private readonly finP2PClient: FinP2PClient | undefined,
    private readonly inner: PlanApprovalService
  ) {}

  async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    const innerResult = await this.inner.approvePlan(idempotencyKey, planId);
    if (innerResult.type === "rejected") {
      return innerResult;
    }
    if (!this.finP2PClient) {
      logger.warning(`No FinP2P client configured; approving plan ${planId} without on-chain mirroring`);
      return innerResult;
    }
    if (await this.orchestrator.hasPlan(planId)) {
      // create-or-approve (Canton plan-setup parity): the creating org's
      // approval is implicit in createPlan; a later approval of an existing
      // mirror is recorded per-org for auditability
      logger.info(`Plan ${planId} already mirrored on-chain; recording approval for ${this.orgId}`);
      await this.orchestrator.recordPlanApproval(planId, this.orgId);
      return approvedPlan();
    }
    try {
      const { data: execution } = await this.finP2PClient.getExecutionPlan(planId) as unknown as { data: any };
      if (!execution?.plan) {
        return rejectedPlan(1, `No plan ${planId} found`);
      }
      const { instructions, signatures } = translateExecutionPlan(execution.plan as RawExecutionPlan, this.orgId);
      logger.info(`Mirroring plan ${planId} on-chain: ${instructions.length} instructions, ${signatures.length} investor signatures`);
      await this.orchestrator.createPlan(planId, instructions, signatures);
      return approvedPlan();
    } catch (e) {
      logger.error(`Failed to mirror plan ${planId} on-chain: ${e}`);
      return rejectedPlan(1, `${e instanceof Error ? e.message : e}`);
    }
  }

  async proposeCancelPlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    try {
      if (await this.orchestrator.hasPlan(planId)) {
        const plan = await this.orchestrator.getPlan(planId);
        // freeze the on-chain cursor before approving the cancellation
        if (plan.status === ExecutionPlanStatus.Pending) {
          await this.orchestrator.rejectPlan(planId, "Plan canceled");
          await this.orchestrator.revertPlan(planId);
        }
      }
    } catch (e) {
      logger.error(`Failed to reject/revert plan ${planId} on-chain: ${e}`);
      return rejectedPlan(1, `${e instanceof Error ? e.message : e}`);
    }
    return this.inner.proposeCancelPlan(idempotencyKey, planId);
  }

  async proposeResetPlan(idempotencyKey: string, planId: string, proposedSequence: number): Promise<PlanApprovalStatus> {
    // the on-chain cursor only moves forward; a reset to an earlier sequence
    // cannot be mirrored and must be rejected rather than silently diverge
    try {
      if (await this.orchestrator.hasPlan(planId)) {
        const plan = await this.orchestrator.getPlan(planId);
        if (proposedSequence < plan.currentSequence) {
          return rejectedPlan(1, `Plan ${planId} is mirrored on-chain at sequence ${plan.currentSequence}; cannot reset back to ${proposedSequence}`);
        }
      }
    } catch (e) {
      return rejectedPlan(1, `${e instanceof Error ? e.message : e}`);
    }
    return this.inner.proposeResetPlan(idempotencyKey, planId, proposedSequence);
  }

  async proposeInstructionApproval(idempotencyKey: string, planId: string, instructionSequence: number): Promise<PlanApprovalStatus> {
    return this.inner.proposeInstructionApproval(idempotencyKey, planId, instructionSequence);
  }

  async proposalStatus(planId: string, proposal: PlanProposal, status: "approved" | "rejected"): Promise<void> {
    return this.inner.proposalStatus(planId, proposal, status);
  }
}
