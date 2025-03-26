import { v4 as uuid } from "uuid";
import { logger } from "../helpers/logger";
import { CommonService } from "./common";
import { failedPlanApproval } from "./mapping";


export class PlanService extends CommonService {


  public async approvePlan(request: Paths.ApproveExecutionPlan.RequestBody): Promise<Paths.ApproveExecutionPlan.Responses.$200> {
    const { executionPlan: { id: planId } } = request;
    logger.info(`Got execution plan to approve: ${planId}`);

    if (!this.executionGetter) {
      logger.error("Execution getter is not set");
      return failedPlanApproval(1, "Execution getter is not set");
    }

    await this.finP2PContract.createExecutionPlan(planId);
    const instructions = await this.executionGetter.getExecutionPlanInstructions(planId);
    for (const instruction of instructions) {
      const {
        exCtx, instructionType, assetId, assetType,
        source, destination, amount, instructionExecutor, proofSigner
      } = instruction;
      await this.finP2PContract.addInstructionToExecution(exCtx, instructionType, assetId, assetType, source, destination, amount, instructionExecutor, proofSigner);
    }

    for (const instruction of instructions) {
      if (instruction.signature !== '') {
        await this.finP2PContract.provideInvestorSignature()
      }
    }

    return {
      isCompleted: true, cid: uuid(), approval: {
        status: "approved"
      }
    } as Components.Schemas.ExecutionPlanApprovalOperation;
  }

}
