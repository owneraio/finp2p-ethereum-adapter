import { logger, PlanApprovalService, approvedPlan, PlanApprovalStatus } from "@owneraio/finp2p-nodejs-skeleton-adapter";

export class PlanApprovalServiceImpl implements PlanApprovalService {

  public async approvePlan(planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    return approvedPlan();
  }

}
