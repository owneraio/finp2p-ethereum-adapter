import { v4 as uuid } from "uuid";
import { logger } from "../../helpers/logger";

export class PlanService {

  public async approvePlan(request: Paths.ApproveExecutionPlan.RequestBody): Promise<Paths.ApproveExecutionPlan.Responses.$200> {
    logger.info(`Got execution plan to approve: ${request.executionPlan.id}`);

    return {
      isCompleted: true, cid: uuid(), approval: {
        status: "approved"
      }
    } as Components.Schemas.ExecutionPlanApprovalOperation;
  }

}
