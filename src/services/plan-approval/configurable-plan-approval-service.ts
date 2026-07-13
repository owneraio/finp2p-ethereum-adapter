import {
  PlanApprovalService, PlanApprovalStatus, PlanProposal, logger
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { PlanApprovalOption } from "./option";
import { introspectPlan } from "./plan-introspection";

/**
 * The adapter's plan approval service: always on, delegating the authoritative
 * approve/reject decision to a base PlanApprovalService (the skeleton's
 * validation + plugin logic), then introspecting the approved plan ONCE and
 * running a configured list of PlanApprovalOptions over it.
 *
 * Options are the extension point — gas prefunding today, token-based
 * whitelisting and others later — replacing a stack of per-concern decorators
 * (which would each re-fetch the plan). An option that returns a rejected
 * status vetoes the approval; side-effect options return void.
 */
export class ConfigurablePlanApprovalService implements PlanApprovalService {

  constructor(
    private readonly orgId: string,
    private readonly finP2PClient: FinP2PClient | undefined,
    private readonly base: PlanApprovalService,
    private readonly options: PlanApprovalOption[],
  ) {}

  async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    const result = await this.base.approvePlan(idempotencyKey, planId);
    if (result.type === "rejected" || this.options.length === 0 || !this.finP2PClient) {
      return result;
    }

    let plan;
    try {
      const { data } = await this.finP2PClient.getExecutionPlan(planId) as unknown as { data: any };
      if (!data?.plan) return result;
      plan = introspectPlan(planId, this.orgId, data.plan);
    } catch (e) {
      // introspection failure must not block an already-approved plan; options
      // that depend on it (e.g. gas prefunding) degrade to their own fallbacks
      logger.warning(`Plan ${planId}: introspection for approval options failed, skipping them: ${e}`);
      return result;
    }

    for (const option of this.options) {
      const veto = await option.apply(plan);
      if (veto && veto.type === "rejected") {
        logger.info(`Plan ${planId} rejected by approval option '${option.name}'`);
        return veto;
      }
    }
    return result;
  }

  async proposeCancelPlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    return this.base.proposeCancelPlan(idempotencyKey, planId);
  }

  async proposeResetPlan(idempotencyKey: string, planId: string, proposedSequence: number): Promise<PlanApprovalStatus> {
    return this.base.proposeResetPlan(idempotencyKey, planId, proposedSequence);
  }

  async proposeInstructionApproval(idempotencyKey: string, planId: string, instructionSequence: number): Promise<PlanApprovalStatus> {
    return this.base.proposeInstructionApproval(idempotencyKey, planId, instructionSequence);
  }

  async proposalStatus(planId: string, proposal: PlanProposal, status: "approved" | "rejected"): Promise<void> {
    return this.base.proposalStatus(planId, proposal, status);
  }
}
