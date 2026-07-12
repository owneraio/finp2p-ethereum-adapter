import { ContractFactory, Provider, Signer, TransactionReceipt } from "ethers";
import ORCHESTRATOR from "../artifacts/contracts/finp2p/FINP2POrchestrator.sol/FINP2POrchestrator.json";
import { FINP2POrchestrator } from "../typechain-types";
import { FINP2POrchestratorInterface } from "../typechain-types/contracts/finp2p/FINP2POrchestrator";
import { PayableOverrides } from "../typechain-types/common";
import { ContractsManager, GasTier } from "./manager";
import {
  Logger, ReceiptOperation, failedReceiptOperation, pendingReceiptOperation, successfulReceiptOperation
} from "./adapter-types";
import {
  ApprovalState, LedgerProof, OrchestrationPlanInfo, PlanInstruction, PlanInvestmentSignature
} from "./plan-model";
import { parseTransactionReceipt } from "./utils";

const ETH_COMPLETED_TRANSACTION_STATUS = 1;

/**
 * Client for the v2 plan-based operator (FINP2POrchestrator).
 *
 * A FinP2P execution plan is mirrored on-chain with `createPlan` (which also
 * verifies all investor signatures), then advanced strictly in sequence with
 * `executeInstruction` (on-ledger instructions, no signatures) and
 * `completeOffLedgerInstruction` (off-ledger instructions, verified EIP-712
 * receipt proof).
 */
export class FinP2POrchestratorContract extends ContractsManager {

  contractInterface: FINP2POrchestratorInterface;

  orchestrator: FINP2POrchestrator;

  orchestratorAddress: string;

  constructor(provider: Provider, signer: Signer, orchestratorAddress: string, logger: Logger,
              confirmationTimeoutMs?: number, gasTier?: GasTier) {
    super(provider, signer, logger, confirmationTimeoutMs, gasTier);
    const factory = new ContractFactory<any[], FINP2POrchestrator>(
      ORCHESTRATOR.abi, ORCHESTRATOR.bytecode, this.signer
    );
    const contract = factory.attach(orchestratorAddress);
    this.contractInterface = contract.interface as FINP2POrchestratorInterface;
    this.orchestrator = contract as FINP2POrchestrator;
    this.orchestratorAddress = orchestratorAddress;
  }

  async getVersion() {
    return this.mapErrors(async () => this.orchestrator.getVersion());
  }

  async getEscrowAddress() {
    return this.mapErrors(async () => this.orchestrator.getEscrowAddress());
  }

  async getVerifierAddress() {
    return this.mapErrors(async () => this.orchestrator.getVerifierAddress());
  }

  // ---- Credentials / assets (same semantics as v1) ----

  async addCredential(finId: string, address: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.addCredential(finId, address, txParams);
    });
  }

  async removeCredential(finId: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.removeCredential(finId, txParams);
    });
  }

  async getCredentialAddress(finId: string) {
    return this.orchestrator.getCredentialAddress(finId);
  }

  async associateAsset(assetId: string, tokenAddress: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.associateAsset(assetId, tokenAddress, txParams);
    });
  }

  async getAssetAddress(assetId: string) {
    return this.orchestrator.getAssetAddress(assetId);
  }

  // ---- Proof signer registry ----

  async addProofSigner(orgId: string, signerAddress: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.addProofSigner(orgId, signerAddress, txParams);
    });
  }

  async addProofSignerFinId(orgId: string, finId: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.addProofSignerFinId(orgId, finId, txParams);
    });
  }

  async removeProofSigner(orgId: string, signerAddress: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.removeProofSigner(orgId, signerAddress, txParams);
    });
  }

  async isProofSigner(orgId: string, signerAddress: string): Promise<boolean> {
    return this.orchestrator.isProofSigner(orgId, signerAddress);
  }

  // ---- Plan lifecycle ----

  async createPlan(planId: string, instructions: PlanInstruction[], signatures: PlanInvestmentSignature[]) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.createPlan(planId, instructions, signatures, txParams);
    });
  }

  async executeInstruction(planId: string, sequence: number) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.executeInstruction(planId, sequence, txParams);
    });
  }

  async completeOffLedgerInstruction(planId: string, sequence: number, proof: LedgerProof, signature: string) {
    const sig = signature.startsWith("0x") ? signature : `0x${signature}`;
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.completeOffLedgerInstruction(planId, sequence, proof, sig, txParams);
    });
  }

  async rejectPlan(planId: string, reason: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.rejectPlan(planId, reason, txParams);
    });
  }

  async recordPlanApproval(planId: string, orgId: string, state: ApprovalState = ApprovalState.Approved) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.recordPlanApproval(planId, orgId, state, txParams);
    });
  }

  async getPlanApproval(planId: string, orgId: string): Promise<ApprovalState> {
    return Number(await this.orchestrator.getPlanApproval(planId, orgId));
  }

  async revertPlan(planId: string) {
    return this.safeExecuteTransaction(this.orchestrator, async (contract, txParams: PayableOverrides) => {
      return contract.revertPlan(planId, txParams);
    });
  }

  async hasPlan(planId: string): Promise<boolean> {
    return this.orchestrator.hasPlan(planId);
  }

  async getPlan(planId: string): Promise<OrchestrationPlanInfo> {
    const plan = await this.orchestrator.getPlan(planId);
    return {
      status: Number(plan.status),
      instructionCount: Number(plan.instructionCount),
      currentSequence: Number(plan.currentSequence)
    };
  }

  async getInstruction(planId: string, sequence: number): Promise<PlanInstruction> {
    const i = await this.orchestrator.getInstruction(planId, sequence);
    return {
      sequence: Number(i.sequence),
      instructionType: Number(i.instructionType),
      venue: Number(i.venue),
      organizationId: i.organizationId,
      assetId: i.assetId,
      assetType: Number(i.assetType),
      source: i.source,
      destination: i.destination,
      amount: i.amount,
      operationId: i.operationId,
      signatureIndex: Number(i.signatureIndex),
      state: Number(i.state)
    };
  }

  // ---- Receipts (same parsing as v1: domain events share shapes) ----

  async getOperationStatus(txHash: string): Promise<ReceiptOperation> {
    const txReceipt = await this.provider.getTransactionReceipt(txHash);
    if (txReceipt === null) {
      return pendingReceiptOperation(txHash, undefined);
    }
    if (txReceipt.status !== ETH_COMPLETED_TRANSACTION_STATUS) {
      return failedReceiptOperation(1, `Transaction failed with status: ${txReceipt.status}`);
    }
    const block = await this.provider.getBlock(txReceipt.blockNumber);
    const timestamp = block?.timestamp || 0;
    const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
    if (receipt === null) {
      this.logger.warning("Failed to parse receipt");
      return pendingReceiptOperation(txHash, undefined);
    }
    return successfulReceiptOperation(receipt);
  }

  async getReceiptFromTransactionReceipt(txReceipt: TransactionReceipt): Promise<ReceiptOperation> {
    const block = await this.provider.getBlock(txReceipt.blockNumber);
    const timestamp = block?.timestamp || 0;
    const receipt = parseTransactionReceipt(txReceipt, this.contractInterface, timestamp);
    if (receipt === null) {
      throw new Error("Failed to parse receipt");
    }
    return successfulReceiptOperation(receipt);
  }

  async getReceipt(hash: string): Promise<ReceiptOperation> {
    const txReceipt = await this.provider.getTransactionReceipt(hash);
    if (txReceipt === null) {
      throw new Error("Transaction not found");
    }
    return this.getReceiptFromTransactionReceipt(txReceipt);
  }
}
