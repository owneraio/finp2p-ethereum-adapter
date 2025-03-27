import { FinAPIClient } from "./finapi/finapi.client";
import { ExecutionPlan, Instruction, Proof } from "./model";
import { instructionCompletionProofFromAPI, instructionFromAPI } from "./mapping";
import { OssClient } from "./oss.client";
import { AssetType, InstructionExecutor } from "../../finp2p-contracts/src/contracts/model";
import { logger } from "../helpers/logger";


export class ExecutionPlanGetter {
  private finApiClient: FinAPIClient;
  private ossClient: OssClient;

  constructor(finApiClient: FinAPIClient, ossClient: OssClient) {
    this.finApiClient = finApiClient;
    this.ossClient = ossClient;
  }

  async getExecutionPlanForApproval(id: string): Promise<ExecutionPlan> {
    const {
      executionPlanStatus: status,
      plan: { instructions: apiInstructions }
    } = await this.finApiClient.getExecutionPlan(id);
    if (status !== "proposed") {
      logger.error(`Execution plan status is not in proposed state: ${status}`);
      throw new Error(`Execution plan status is not in proposed state: ${status}`);
    }
    let instructions: Instruction[] = [];
    for (let instruction of apiInstructions) {
      let instr = instructionFromAPI(id, instruction);
      if (instr.executor == InstructionExecutor.OTHER_CONTRACT) {
        instr.proofSigner = await this.getProofSigner(instr);
      }
      instructions.push(instr);
    }
    return {
      id, status, instructions
    };
  }

  async getPreviousInstructionProof(id: string, currentSequence: number) {
    const { output } = await this.getPreviousInstructionCompletionEvent(id, currentSequence);
    if (!output) {
      throw new Error("No output found in previous instruction completion event");
    }
    if (output.type == "error") {
      throw new Error(`Error in previous instruction completion event: ${output.code} - ${output.message}`);
    }
    const { proof } = output;
    if (!proof) {
      throw new Error("No proof found in receipt");
    }
    switch (proof.type) {
      case "noProofPolicy":
        throw new Error("No proof policy found");
      case "signatureProofPolicy":
        const { signature } = proof;
        return instructionCompletionProofFromAPI(signature);
    }
  }

  private async getProofSigner(instruction: Instruction): Promise<string> {
    const { assetId, assetType, organizationId } = instruction;
    const proof = await this.getLedgerProof(assetId, assetType, organizationId);
    switch (proof.type) {
      case "NoProofPolicy":
        throw new Error("No proof policy found");
      case "SignatureProofPolicy":
        return proof.verifyingKey;
    }
  }

  private async getLedgerProof(assetId: string, assetType: AssetType, organizationId: string): Promise<Proof> {
    switch (assetType) {
      case AssetType.FinP2P: {
        const { policies: { proof } } = await this.ossClient.getAsset(assetId);
        return proof;
      }
      case AssetType.Cryptocurrency:
      case AssetType.Fiat: {
        const { policies: { proof } } = await this.ossClient.getPaymentAsset(organizationId, assetId);
        return proof;
      }
    }
  }

  private async getPreviousInstructionCompletionEvent(planId: string, currentSequence: number) {
    const {
      executionPlanStatus: status,
      instructionsCompletionEvents,
      plan: { instructions }
    } = await this.finApiClient.getExecutionPlan(planId);
    if (status !== "approved") {
      logger.error(`Execution plan status is not in approved state: ${status}`);
      throw new Error(`Execution plan status is not in approved state: ${status}`);
    }
    if (currentSequence == 1) {
      throw new Error(`No previous instruction found for sequence ${currentSequence}`);
    }
    let prevSequence: number | undefined;
    for (let seq = currentSequence - 1; seq > 0; seq--) {
      const { type } = instructions[seq - 1].executionPlanOperation;
      if (type != "await") {
        prevSequence = seq - 1;
        break;
      }
    }
    if (!prevSequence) {
      throw new Error(`No previous instruction found for sequence ${currentSequence}`);
    }
    for (const event of instructionsCompletionEvents) {
      if (event.instructionSequenceNumber == prevSequence) {
        return event;
      }
    }
    throw new Error("No previous instruction found");
  }
}