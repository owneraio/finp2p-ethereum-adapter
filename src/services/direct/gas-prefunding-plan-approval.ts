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

const sourceFinIdOf = (operation: RawOperation): string | undefined =>
  operation.source?.finp2pAccount?.account?.finId;

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

      // the same wallet may sign several instructions of one plan — count
      // them, so the top-up covers the whole plan rather than a single tx
      const walletTxCounts = new Map<string, number>();
      const bump = (address: string) => walletTxCounts.set(address, (walletTxCounts.get(address) ?? 0) + 1);

      for (const instruction of instructions) {
        const organizations = instruction.organizations ?? [];
        if (organizations.length > 0 && !organizations.includes(this.orgId)) {
          continue; // executes on another ledger — not our wallets
        }
        const operation = instruction.executionPlanOperation;
        switch (operation?.type) {
          case "issue":
            bump(await this.custodyProvider.issuer.signer.getAddress());
            break;
          case "transfer":
          case "hold":
            await this.bumpInvestorWallet(bump, sourceFinIdOf(operation), planId, instruction.sequence);
            break;
          case "redeem":
            // redeem of escrowed funds burns from the escrow wallet; a
            // standalone redeem self-burns from the investor — fund both
            bump(await this.custodyProvider.escrow.signer.getAddress());
            await this.bumpInvestorWallet(bump, sourceFinIdOf(operation), planId, instruction.sequence);
            break;
          case "release":
          case "revertHoldInstruction":
            bump(await this.custodyProvider.escrow.signer.getAddress());
            break;
        }
      }

      // sequential on purpose: the gas station funds from a single wallet, so
      // parallel top-ups would race its nonce. Best-effort per wallet — one
      // failure must not skip the others; each is caught so the rest still
      // get topped up, and any gap is covered by the execution-time check.
      let funded = 0;
      for (const [address, txCount] of walletTxCounts) {
        try {
          await gasStation.ensureGas(address, txCount);
          funded++;
        } catch (e) {
          logger.warning(`Gas prefunding: top-up of ${address} for plan ${planId} failed (execution will retry): ${e}`);
        }
      }
      if (funded > 0) {
        logger.info(`Pre-funded gas for ${funded}/${walletTxCounts.size} wallet(s) of plan ${planId}`);
      }
    } catch (e) {
      logger.warning(`Gas prefunding for plan ${planId} skipped (execution-time funding still applies): ${e}`);
    }
  }

  private async bumpInvestorWallet(bump: (address: string) => void, finId: string | undefined, planId: string, sequence?: number): Promise<void> {
    if (!finId) return;
    const address = await this.accountMapping.resolveAccount(finId);
    if (address) {
      bump(address);
    } else {
      logger.warning(`Gas prefunding: cannot resolve source finId ${finId} of plan ${planId} instruction ${sequence}`);
    }
  }
}
