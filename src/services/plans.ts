import { v4 as uuid } from "uuid";
import { logger } from "../helpers/logger";
import { CommonService } from "./common";
import { failedPlanApproval } from "./mapping";
import { InstructionExecutor } from "../../finp2p-contracts/src/contracts/model";


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
        executionContext, instructionType, assetId, assetType,
        source, destination, amount, executor, proofSigner
      } = instruction;
      await this.finP2PContract.addInstructionToExecution(executionContext, instructionType, assetId, assetType, source, destination,
        amount, executor, proofSigner);
    }

    for (const instruction of instructions) {
      const { executionContext, executor, signature: sig } = instruction;
      if (executor == InstructionExecutor.THIS_CONTRACT && sig) {
        const { domain, nonce, buyer, seller, asset, settlement, loan, signature } = sig;
        await this.finP2PContract.provideInvestorSignature(executionContext, domain, nonce, buyer, seller, asset, settlement, loan, signature);
      }
    }

    return {
      isCompleted: true, cid: uuid(), approval: {
        status: "approved"
      }
    } as Components.Schemas.ExecutionPlanApprovalOperation;
  }

}
