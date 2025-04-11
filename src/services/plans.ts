import { v4 as uuid } from "uuid";
import { logger } from "../helpers/logger";
import { CommonService } from "./common";
import { failedPlanApproval, failedTransaction } from "./mapping";
import { EthereumTransactionError, InstructionExecutor } from "../../finp2p-contracts/src/contracts/model";


export class PlanService extends CommonService {

  public async approvePlan(request: Paths.ApproveExecutionPlan.RequestBody): Promise<Paths.ApproveExecutionPlan.Responses.$200> {
    const { executionPlan: { id: planId } } = request;
    logger.info(`Got execution plan to approve: ${planId}`);

    if (!this.executionGetter) {
      logger.error("Execution getter is not set");
      return failedPlanApproval(1, "Execution getter is not set");
    }
    const { instructions } = await this.executionGetter.getExecutionPlanForApproval(planId);

    try {
      let txHash = await this.finP2PContract.createExecutionPlan(planId);
      await this.finP2PContract.waitForCompletion(txHash);
      for (const instruction of instructions) {
        const {
          executionContext, instructionType, assetId, assetType,
          source, destination, amount, executor, proofSigner
        } = instruction;
        txHash = await this.finP2PContract.addInstructionToExecution(executionContext, instructionType, assetId, assetType, source, destination,
          amount, executor, proofSigner);
        await this.finP2PContract.waitForCompletion(txHash);
      }

      for (const instruction of instructions) {
        const { executionContext, executor, signature: sig } = instruction;
        if (executor == InstructionExecutor.THIS_CONTRACT && sig) {
          const { domain, nonce, buyer, seller, asset, settlement, loan, signature } = sig;
          txHash = await this.finP2PContract.provideInvestorSignature(executionContext, domain, nonce, buyer, seller, asset, settlement, loan, signature);
          await this.finP2PContract.waitForCompletion(txHash);
        }
      }
    } catch (e) {
      if (e instanceof EthereumTransactionError) {
        return failedPlanApproval(1, e.message);

      } else {
        return failedPlanApproval(1, `${e}`);
      }
    }

    return {
      isCompleted: true, cid: uuid(), approval: {
        status: "approved"
      }
    } as Components.Schemas.ExecutionPlanApprovalOperation;
  }

}
