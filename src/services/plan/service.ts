import { v4 as uuid } from 'uuid';
import {
  logger,
  PlanApprovalService,
  approvedPlan,
  PlanApprovalStatus, pendingPlan, ExecutionPlan
} from "@owneraio/finp2p-nodejs-skeleton-adapter";

import { executionPlanApprovalStatus, FinP2PClient } from "@owneraio/finp2p-client";
import { ValidationError } from "@owneraio/finp2p-nodejs-skeleton-adapter/dist/lib/services/errors";
import { executionFromAPI } from "./mapper";

export class PlanApprovalServiceImpl implements PlanApprovalService {

  finP2P: FinP2PClient | undefined;

  constructor(finP2PClient: FinP2PClient | undefined) {
    this.finP2P = finP2PClient;
  }

  public async approvePlan(planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    if (this.finP2P) {
      const { data } = await this.finP2P.getExecutionPlan(planId);
      if (!data) {
        throw new ValidationError(`No plan ${planId} found`);
      }
      const plan = executionFromAPI(data.plan);
      const cid = uuid();
      this.approve(cid, plan);

      return pendingPlan(cid, { responseStrategy: "callback" });
    }
    return approvedPlan();
  }

  private async approve(cid: string, plan: ExecutionPlan) {
    if (!this.finP2P) {
      throw new Error("FinP2P client not initialized");
    }
    //   TODO: implement real approval logic
    logger.info(`Approving execution plan: ${JSON.stringify(plan)}`);

    await this.finP2P.sendCallback(cid, executionPlanApprovalStatus(cid, { status: "approved" }));
  }

}
