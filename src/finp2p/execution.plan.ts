import { FinAPIClient } from "./finapi/finapi.client";
import { Instruction } from "./model";
import { instructionFromAPI } from "./mapping";


export class ExecutionPlanGetter {
  private finApiClient: FinAPIClient;

  constructor(finApiClient: FinAPIClient) {
    this.finApiClient = finApiClient;
  }

  async getExecutionPlanInstructions(id: string): Promise<Instruction[]> {
    const { plan: { instructions } } = await this.finApiClient.getExecutionPlan(id);
    let result: Instruction[] = [];
    for (let instruction of instructions) {
      result.push(instructionFromAPI(id, instruction))
    }
    return result;
  }
}