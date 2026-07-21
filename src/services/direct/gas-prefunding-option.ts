import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "../plan-approval";
import { CustodyProvider } from "./custody-provider";
import { AccountMappingService } from "./account-mapping";

/**
 * Plan-approval option that moves gas funding out of the instruction execution
 * hot path: on approval, the source investor's wallet of each local
 * transfer/hold/redeem is topped up.
 *
 * Only investor-signed instructions are prefunded here. The long-lived
 * operational wallets — the mint signer (issue) and the escrow wallet
 * (release/revertHold) — are funded out of band, not per plan.
 *
 * Side-effect only — never vetoes approval. Best-effort: a per-instruction
 * resolution or top-up failure is logged and skipped, not propagated. Top-ups
 * run sequentially: the gas station funds from a single wallet, so overlapping
 * ones would race its nonce.
 */
export class GasPrefundingOption implements PlanApprovalOption {

  readonly name = "gas-prefunding";
  // side effect, not a gate: if the plan can't be introspected, skip funding
  // (approval is unaffected) rather than rejecting the plan
  readonly gating = false;

  constructor(
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.custodyProvider.gasStation;
    if (!gasStation) return;

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue; // executes on another ledger — not our wallets
      // Only investor-signed instructions are prefunded; issue (mint signer) and
      // release/revertHold (escrow) sign from operational wallets funded out of band.
      if (instruction.type !== "transfer" && instruction.type !== "hold" && instruction.type !== "redeem") continue;
      if (!instruction.sourceFinId) continue;

      let address: string | undefined;
      try {
        address = await this.accountMapping.resolveAccount(instruction.sourceFinId);
      } catch (e) {
        // best-effort: a transient mapping failure must not abort an already-approved plan
        logger.warning(`Gas prefunding: resolving source finId ${instruction.sourceFinId} of plan ${plan.planId} instruction ${instruction.sequence} failed, skipping: ${e}`);
        continue;
      }
      if (!address) continue;

      try {
        await gasStation.ensureGas(address, 1);
      } catch (e) {
        logger.warning(`Gas prefunding: top-up of ${address} for plan ${plan.planId} instruction ${instruction.sequence} failed: ${e}`);
      }
    }
  }
}
