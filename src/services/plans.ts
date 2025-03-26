import { v4 as uuid } from "uuid";
import { logger } from "../helpers/logger";
import { CommonService } from "./common";
import { failedPlanApproval, finApiAssetFromAPI } from "./mapping";
import { InstructionExecutor, InstructionType } from "../../finp2p-contracts/src/contracts/model";
import process from "process";

export class PlanService extends CommonService {


  public async approvePlan(request: Paths.ApproveExecutionPlan.RequestBody): Promise<Paths.ApproveExecutionPlan.Responses.$200> {
    const { executionPlan: { id: planId } } = request;
    logger.info(`Got execution plan to approve: ${planId}`);

    if (!this.executionGetter) {
      logger.error("Execution getter is not set");
      return failedPlanApproval(1, "Execution getter is not set");
    }
    const { plan } = await this.executionGetter.getExecutionPlan(planId);

    await this.finP2PContract.createExecutionPlan(planId);

    for (let instruction of plan.instructions) {
      const { sequence, executionPlanOperation: op, organizations } = instruction;
      const exCtx = { planId, sequence };
      const executor = organizations.includes(process.env.MY_ORGANIZATION || "") ?
        InstructionExecutor.THIS_CONTRACT :
        InstructionExecutor.OTHER_CONTRACT;
      const proofSigner = "";
      switch (op.type) {
        case "issue": {
          const { asset, destination: { finId: destination }, amount, signature } = op;
          const { assetId, assetType } = finApiAssetFromAPI(asset);
          await this.finP2PContract.addInstructionToExecution(exCtx, InstructionType.ISSUE, assetId, assetType, "", destination, amount, executor, proofSigner);
          break;
        }
        case "transfer": {
          const { asset, source: { finId: source }, destination: { finId: destination }, amount, signature } = op;
          const { assetId, assetType } = finApiAssetFromAPI(asset);
          await this.finP2PContract.addInstructionToExecution(exCtx, InstructionType.ISSUE, assetId, assetType, source, destination, amount, executor, proofSigner);
          break;
        }
        case "redemption": {
          const { asset, source: { finId: source }, destination: { finId: destination }, amount, signature } = op;
          const { assetId, assetType } = finApiAssetFromAPI(asset);
          await this.finP2PContract.addInstructionToExecution(exCtx, InstructionType.ISSUE, assetId, assetType, source, destination, amount, executor, proofSigner);
          break;
        }
        case "hold": {
          const { asset, source: { finId: source }, destination: { finId: destination }, amount, signature } = op;
          const { assetId, assetType } = finApiAssetFromAPI(asset);
          await this.finP2PContract.addInstructionToExecution(exCtx, InstructionType.ISSUE, assetId, assetType, source, destination, amount, executor, proofSigner);
          break;
        }
        case "release": {
          const { asset, source: { finId: source }, destination: { finId: destination }, amount } = op;
          const { assetId, assetType } = finApiAssetFromAPI(asset);
          await this.finP2PContract.addInstructionToExecution(exCtx, InstructionType.ISSUE, assetId, assetType, source, destination, amount, executor, proofSigner);
          break;
        }
        case "revert-hold": {
          const { asset, destination: { finId: destination } } = op;
          const { assetId, assetType } = finApiAssetFromAPI(asset);
          await this.finP2PContract.addInstructionToExecution(exCtx, InstructionType.ISSUE, assetId, assetType, "", destination, "", executor, proofSigner);
          break;
        }
        case "await": {

        }
      }
    }


    return {
      isCompleted: true, cid: uuid(), approval: {
        status: "approved"
      }
    } as Components.Schemas.ExecutionPlanApprovalOperation;
  }

}
