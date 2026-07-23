import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "..";
import { GasStation } from "../../gas-station";
import { AccountResolver } from "../../accounts/account-resolver";

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
    private readonly gasStation: GasStation | undefined,
    private readonly accountMapping: AccountResolver,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.gasStation;
    if (!gasStation) return;

    // gas station funds to amount × txCount (a threshold, not additive), so count
    // per signer and top up once with the total — per-instruction calls under-fund
    const txCounts = new Map<string, number>();
    for (const instruction of plan.instructions) {
      if (!instruction.local) continue;
      if (instruction.type !== "transfer" && instruction.type !== "hold" && instruction.type !== "redeem") continue;
      if (!instruction.sourceFinId) continue;
      try {
        const address = await this.accountMapping.resolveAccount(instruction.sourceFinId);
        if (address) txCounts.set(address, (txCounts.get(address) ?? 0) + 1);
      } catch (e) {
        logger.warning(`Gas prefunding: resolving source finId ${instruction.sourceFinId} of plan ${plan.planId} instruction ${instruction.sequence} failed, skipping: ${e}`);
      }
    }

    for (const [address, txCount] of txCounts) {
      try {
        await gasStation.ensureGas(address, txCount);
      } catch (e) {
        logger.warning(`Gas prefunding: top-up of ${address} for plan ${plan.planId} failed: ${e}`);
      }
    }
  }
}
