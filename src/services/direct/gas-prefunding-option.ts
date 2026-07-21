import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "../plan-approval";
import { CustodyProvider } from "./custody-provider";
import { AccountMappingService } from "./account-mapping";

/**
 * Plan-approval option that prefunds gas on approval: the source investor's
 * wallet of each local transfer/hold/redeem is topped up. The mint signer
 * (issue) and escrow wallet (release/revertHold) are funded out of band.
 *
 * Non-gating and best-effort; top-ups run sequentially so they don't race the
 * gas station's nonce.
 */
export class GasPrefundingOption implements PlanApprovalOption {

  readonly name = "gas-prefunding";
  readonly gating = false;

  constructor(
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.custodyProvider.gasStation;
    if (!gasStation) return;

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue;
      if (instruction.type !== "transfer" && instruction.type !== "hold" && instruction.type !== "redeem") continue;
      if (!instruction.sourceFinId) continue;

      let address: string | undefined;
      try {
        address = await this.accountMapping.resolveAccount(instruction.sourceFinId);
      } catch (e) {
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
