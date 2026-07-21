import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "../plan-approval";
import { AccountMappingService } from "./account-mapping";
import { CustodyProvider } from "./custody-provider";
import { DEFAULT_ACTIVATION_AMOUNT, WalletActivator } from "./wallet-activation";

/**
 * Plan-approval option that activates recipient wallets on Hedera-style
 * networks, where an account exists only after its first native funding. Gas
 * prefunding already touches every sender (activating it as a side effect);
 * this covers the complement — the destinations, which receive tokens without
 * ever signing.
 *
 * Only wired into the approval pipeline when the network needs it (detected
 * once at startup), so apply() does not re-probe. One touch per local
 * receiving instruction's destination, resolved through account mapping.
 *
 * Non-gating and best-effort, like gas prefunding: a failed touch is logged,
 * never a veto. Activation runs sequentially from the gas-station funding
 * wallet, so overlapping touches don't race its nonce; ensureActivated is
 * idempotent, so re-touching a repeated destination is a cheap no-op.
 */
export class WalletActivationOption implements PlanApprovalOption {

  readonly name = "wallet-activation";
  readonly gating = false;

  constructor(
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
    private readonly activationAmount: string = DEFAULT_ACTIVATION_AMOUNT,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.custodyProvider.gasStation;
    if (!gasStation) return;

    const activator = new WalletActivator(gasStation.wallet, this.activationAmount);

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue; // executes on another ledger — not our wallets
      // only instructions that deliver tokens to a destination on this ledger; a
      // hold's business destination only receives at release, which names it again
      if (instruction.type !== "issue" && instruction.type !== "transfer" &&
          instruction.type !== "release") continue;
      if (!instruction.destinationFinId) continue;

      let address: string | undefined;
      try {
        address = await this.accountMapping.resolveAccount(instruction.destinationFinId);
      } catch (e) {
        // best-effort: a transient mapping failure must not abort an already-approved plan
        logger.warning(`Wallet activation: resolving destination ${instruction.destinationFinId} of plan ${plan.planId} instruction ${instruction.sequence} failed, skipping: ${e}`);
        continue;
      }
      if (!address) continue;

      try {
        if (await activator.ensureActivated(address)) {
          logger.info(`Wallet activation: sent ${this.activationAmount} to ${address} (plan ${plan.planId})`);
        }
      } catch (e) {
        logger.warning(`Wallet activation: touch of ${address} for plan ${plan.planId} instruction ${instruction.sequence} failed: ${e}`);
      }
    }
  }
}
