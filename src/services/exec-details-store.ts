import { ExecDetailsStore } from "./common";
import { ExecutionContext } from "@owneraio/finp2p-nodejs-skeleton-adapter";

export class InMemoryExecDetailsStore implements ExecDetailsStore {
  executionContexts: Record<string, ExecutionContext> = {};

  public addExecutionContext(txHash: string, planId: string, sequence: number) {
    this.executionContexts[txHash] = { planId, sequence };
  }

  public getExecutionContext(txHash: string) {
    return this.executionContexts[txHash];
  }
}
