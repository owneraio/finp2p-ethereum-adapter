import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "..";
import { AccountResolver } from "../../accounts/account-resolver";
import { GasStation } from "../../gas-station";
import { DEFAULT_ACTIVATION_AMOUNT, WalletActivator } from "../../gas-station/wallet-activation";

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
    private readonly gasStation: GasStation | undefined,
    private readonly accountMapping: AccountResolver,
    private readonly activationAmount: string = DEFAULT_ACTIVATION_AMOUNT,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.gasStation;
    if (!gasStation) return;

    const activator = new WalletActivator(gasStation.wallet, this.activationAmount);

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue;
      // a hold's destination only receives at release, which names it again
      if (instruction.type !== "issue" && instruction.type !== "transfer" &&
          instruction.type !== "release") continue;
      if (!instruction.destinationFinId) continue;

      const finId = instruction.destinationFinId;
      let address: string | undefined;
      try {
        address = await this.accountMapping.resolveAccount(finId);
      } catch (e) {
        logger.warning(`Wallet activation: resolving destination ${finId} of plan ${plan.planId} instruction ${instruction.sequence} failed, skipping: ${e}`);
        continue;
      }
      if (!address) {
        logger.info(`Wallet activation: destination ${finId} of plan ${plan.planId} instruction ${instruction.sequence} has no mapped address, skipping`);
        continue;
      }

      try {
        const txHash = await activator.ensureActivated(address);
        if (txHash) {
          logger.info(`Wallet activation: investor ${finId} (${address}) activated with ${this.activationAmount} by tx ${txHash} (plan ${plan.planId}, instruction ${instruction.sequence} ${instruction.type})`);
        }
      } catch (e) {
        logger.warning(`Wallet activation: activating investor ${finId} (${address}) for plan ${plan.planId} instruction ${instruction.sequence} failed: ${e}`);
      }
    }
  }
}
