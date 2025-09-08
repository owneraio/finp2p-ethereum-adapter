import { logger } from "../../helpers/logger";
import { PlanApprovalService } from "../interfaces";
import { approvedPlan, PlanApprovalStatus } from "../model";

export class PlanApprovalServiceImpl implements PlanApprovalService {

  public async approvePlan(planId: string): Promise<PlanApprovalStatus> {
    logger.info(`Got execution plan to approve: ${planId}`);
    return approvedPlan();
  }

}
