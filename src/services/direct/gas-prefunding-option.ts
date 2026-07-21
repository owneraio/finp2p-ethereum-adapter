import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "../plan-approval";
import { CustodyProvider } from "./custody-provider";
import { AccountMappingService } from "./account-mapping";

/**
 * Plan-approval option that moves gas funding out of the instruction execution
 * hot path: on approval, each local instruction's signer is topped up.
 *
 * The signer per instruction: issue → the env mint signer
 * (ASSET_ISSUER_PRIVATE_KEY — the token standards mint with it, not the custody
 * issuer wallet); transfer/hold/redeem → the source investor's wallet. The
 * escrow wallet (release/revertHold) is funded out of band, not here.
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
    // Address of the env issuer that signs every standard's mint; undefined
    // when no persistent issuer key is configured (then issuance can't run and
    // there is nothing to prefund).
    private readonly mintSignerAddress?: string,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.custodyProvider.gasStation;
    if (!gasStation) return;

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue; // executes on another ledger — not our wallets

      // The wallet that signs (and pays gas for) this instruction. issue → the
      // env mint signer; transfer/hold/redeem → the source investor. release and
      // revertHold sign from the escrow wallet, which is funded out of band.
      let address: string | undefined;
      if (instruction.type === "issue") {
        address = this.mintSignerAddress;
      } else if (instruction.type === "transfer" || instruction.type === "hold" || instruction.type === "redeem") {
        if (!instruction.sourceFinId) continue;
        try {
          address = await this.accountMapping.resolveAccount(instruction.sourceFinId);
        } catch (e) {
          // best-effort: a transient mapping failure must not abort an already-approved plan
          logger.warning(`Gas prefunding: resolving source finId ${instruction.sourceFinId} of plan ${plan.planId} instruction ${instruction.sequence} failed, skipping: ${e}`);
          continue;
        }
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
