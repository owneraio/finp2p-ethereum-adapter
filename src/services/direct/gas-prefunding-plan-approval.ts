import {
  PlanApprovalService, PlanApprovalStatus, PlanProposal, logger
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { CustodyProvider } from "./custody-provider";
import { AccountMappingService } from "./account-mapping";

// Minimal structural types of the raw FinAPI execution plan payload — only
// what gas prefunding needs (instruction type + source account + executing orgs).
type RawAccount = { finp2pAccount?: { account?: { finId?: string } } };
type RawOperation = { type?: string; source?: RawAccount };
type RawInstruction = { sequence?: number; organizations?: string[]; executionPlanOperation?: RawOperation };

/**
 * PlanApprovalService decorator that moves gas funding out of the instruction
 * execution hot path: when a plan is approved, every wallet that will sign one
 * of this organization's instructions is topped up once, up front. Instruction
 * execution then never blocks on a funding transaction confirming.
 *
 * Wallet-per-instruction mapping mirrors DirectTokenService's signer choice:
 * issue → issuer wallet; transfer/hold → the source investor's wallet;
 * release/revertHold → the escrow wallet; redeem → the escrow wallet (redeem
 * of escrowed funds) and the source investor (standalone self-burn).
 *
 * Prefunding is best-effort: a funding failure logs a warning instead of
 * rejecting the plan — the affected instruction will surface the error at
 * execution time.
 */
export class GasPrefundingPlanApprovalService implements PlanApprovalService {

  constructor(
    private readonly orgId: string,
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
    private readonly finP2PClient: FinP2PClient | undefined,
    private readonly inner: PlanApprovalService,
  ) {}

  async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    const result = await this.inner.approvePlan(idempotencyKey, planId);
    if (result.type !== "rejected") {
      await this.prefundGasForPlan(planId);
    }
    return result;
  }

  async proposeCancelPlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    return this.inner.proposeCancelPlan(idempotencyKey, planId);
  }

  async proposeResetPlan(idempotencyKey: string, planId: string, proposedSequence: number): Promise<PlanApprovalStatus> {
    return this.inner.proposeResetPlan(idempotencyKey, planId, proposedSequence);
  }

  async proposeInstructionApproval(idempotencyKey: string, planId: string, instructionSequence: number): Promise<PlanApprovalStatus> {
    return this.inner.proposeInstructionApproval(idempotencyKey, planId, instructionSequence);
  }

  async proposalStatus(planId: string, proposal: PlanProposal, status: "approved" | "rejected"): Promise<void> {
    return this.inner.proposalStatus(planId, proposal, status);
  }

  private async prefundGasForPlan(planId: string): Promise<void> {
    const gasStation = this.custodyProvider.gasStation;
    if (!gasStation || !this.finP2PClient) return;
    try {
      const { data } = await this.finP2PClient.getExecutionPlan(planId) as unknown as { data: any };
      const instructions: RawInstruction[] = data?.plan?.instructions ?? [];

      const addresses = new Set<string>();
      for (const instruction of instructions) {
        const organizations = instruction.organizations ?? [];
        if (organizations.length > 0 && !organizations.includes(this.orgId)) {
          continue; // executes on another ledger — not our wallets
        }
        const operation = instruction.executionPlanOperation;
        switch (operation?.type) {
          case "issue":
            addresses.add(await this.custodyProvider.issuer.signer.getAddress());
            break;
          case "transfer":
          case "hold":
            await this.addSourceWallet(addresses, operation, planId, instruction.sequence);
            break;
          case "redeem":
            // redeem of escrowed funds burns from the escrow wallet; a
            // standalone redeem self-burns from the investor — fund both
            addresses.add(await this.custodyProvider.escrow.signer.getAddress());
            await this.addSourceWallet(addresses, operation, planId, instruction.sequence);
            break;
          case "release":
          case "revertHoldInstruction":
            addresses.add(await this.custodyProvider.escrow.signer.getAddress());
            break;
        }
      }

      // sequential on purpose: the gas station funds from a single wallet, so
      // parallel top-ups would race its nonce
      for (const address of addresses) {
        await gasStation.ensureGas(address);
      }
      if (addresses.size > 0) {
        logger.info(`Pre-funded gas for ${addresses.size} wallet(s) of plan ${planId}`);
      }
    } catch (e) {
      logger.warning(`Gas prefunding for plan ${planId} failed (instructions will fund lazily or fail at execution): ${e}`);
    }
  }

  private async addSourceWallet(addresses: Set<string>, operation: RawOperation, planId: string, sequence?: number): Promise<void> {
    const finId = operation.source?.finp2pAccount?.account?.finId;
    if (!finId) return;
    const address = await this.accountMapping.resolveAccount(finId);
    if (address) {
      addresses.add(address);
    } else {
      logger.warning(`Gas prefunding: cannot resolve source finId ${finId} of plan ${planId} instruction ${sequence}`);
    }
  }
}
