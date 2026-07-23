import { ExecutionContext } from "@owneraio/finp2p-ethereum-orchestrator";

export interface ExecDetailsStore {
  addExecutionContext(txHash: string, executionPlanId: string, instructionSequenceNumber: number): void;

  getExecutionContext(txHash: string): ExecutionContext;
}

export class InMemoryExecDetailsStore implements ExecDetailsStore {
  executionContexts: Record<string, ExecutionContext> = {};

  public addExecutionContext(txHash: string, planId: string, sequence: number) {
    this.executionContexts[txHash] = { planId, sequence };
  }

  public getExecutionContext(txHash: string) {
    return this.executionContexts[txHash];
  }
}
