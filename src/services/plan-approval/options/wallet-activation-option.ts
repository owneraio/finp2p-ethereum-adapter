import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "..";
import { AccountMappingService } from "../../direct/account-mapping";
import { CustodyProvider } from "../../direct/custody-provider";
import { DEFAULT_ACTIVATION_AMOUNT, WalletActivator } from "../../direct/wallet-activation";

/**
 * Plan-approval option that activates recipient wallets on Hedera-style
 * networks, where an account exists only after its first native funding — the
 * complement to gas prefunding, which already touches every sender.
 *
 * Wired in only when the network needs it (detected once at startup), so
 * apply() does not re-probe. Non-gating and best-effort; touches run
 * sequentially and ensureActivated is idempotent.
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
      if (!instruction.local) continue;
      // a hold's destination only receives at release, which names it again
      if (instruction.type !== "issue" && instruction.type !== "transfer" &&
          instruction.type !== "release") continue;
      if (!instruction.destinationFinId) continue;

      let address: string | undefined;
      try {
        address = await this.accountMapping.resolveAccount(instruction.destinationFinId);
      } catch (e) {
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
