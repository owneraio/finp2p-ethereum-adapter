import Execution = FinAPIComponents.Schemas.Execution;
import { FinAPIClient } from "./finapi/finapi.client";


export class ExecutionPlanGetter {
  private finApiClient: FinAPIClient;

  constructor(finApiClient: FinAPIClient) {
    this.finApiClient = finApiClient;
  }

  async getExecutionPlan(id: string): Promise<Execution> {
    return this.finApiClient.getExecutionPlan(id);
  }
}