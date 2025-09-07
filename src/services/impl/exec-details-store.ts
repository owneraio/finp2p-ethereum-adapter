import { ExecutionContext } from "../../../finp2p-contracts/src/contracts/model";
import { ExecDetailsStore } from "./common";



export class InMemoryExecDetailsStore implements ExecDetailsStore {
  executionContexts: Record<string, ExecutionContext> = {};

  public addExecutionContext(txHash: string, executionPlanId: string, instructionSequenceNumber: number) {
    this.executionContexts[txHash] = { executionPlanId, instructionSequenceNumber };
  }

  public getExecutionContext(txHash: string) {
    return this.executionContexts[txHash];
  }
}
