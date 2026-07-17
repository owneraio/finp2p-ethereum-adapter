import {
  PlanApprovalService, PlanApprovalStatus, PlanProposal, rejectedPlan, logger
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { PlanApprovalOption } from "./option";
import { introspectPlan, IntrospectedPlan } from "./plan-introspection";

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
    if (result.type === "rejected" || this.options.length === 0) {
      return result;
    }

    const plan = await this.introspect(planId);
    if (!plan) {
      // Couldn't introspect (no FinP2P client, fetch error, or missing plan).
      // A gating option (e.g. whitelisting) must run to clear the plan, so fail
      // closed rather than approving unchecked; non-gating options (gas
      // prefunding) are safe to skip.
      const gating = this.options.filter(o => o.gating).map(o => o.name);
      if (gating.length > 0) {
        logger.warning(`Plan ${planId}: cannot introspect; rejecting because gating option(s) [${gating.join(", ")}] could not run`);
        return rejectedPlan(1, `Plan introspection unavailable; cannot evaluate approval option(s): ${gating.join(", ")}`);
      }
      logger.warning(`Plan ${planId}: cannot introspect; skipping non-gating approval options`);
      return result;
    }

    for (const option of this.options) {
      let veto;
      try {
        veto = await option.apply(plan);
      } catch (e) {
        // an option must never escape as an HTTP error: a gating option that
        // blew up could not clear the plan — fail closed; a non-gating one is
        // best-effort by contract — skip it
        if (option.gating) {
          logger.warning(`Plan ${planId}: gating approval option '${option.name}' failed, rejecting: ${e}`);
          return rejectedPlan(1, `Approval option '${option.name}' failed for plan ${planId}: ${e}`);
        }
        logger.warning(`Plan ${planId}: approval option '${option.name}' failed, skipping: ${e}`);
        continue;
      }
      if (veto && veto.type === "rejected") {
        logger.info(`Plan ${planId} rejected by approval option '${option.name}'`);
        return veto;
      }
    }
    return result;
  }

  private async introspect(planId: string): Promise<IntrospectedPlan | undefined> {
    if (!this.finP2PClient) return undefined;
    try {
      const { data } = await this.finP2PClient.getExecutionPlan(planId) as unknown as { data: any };
      if (!data?.plan) return undefined;
      return introspectPlan(planId, this.orgId, data.plan);
    } catch (e) {
      logger.warning(`Plan ${planId}: execution plan fetch for introspection failed: ${e}`);
      return undefined;
    }
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
