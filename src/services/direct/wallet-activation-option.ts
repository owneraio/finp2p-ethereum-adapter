import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "../plan-approval";
import { AccountMappingService } from "./account-mapping";
import { CustodyProvider } from "./custody-provider";
import { DEFAULT_ACTIVATION_AMOUNT, isHederaNetwork, WalletActivator } from "./wallet-activation";

/**
 * Plan-approval option that activates recipient wallets on Hedera-style
 * networks, where an account exists only after its first native funding. Gas
 * prefunding already touches every sender (activating it as a side effect);
 * this covers the complement — the destinations, which receive tokens without
 * ever signing.
 *
 * The network is auto-detected (chain id / JSON-RPC relay probe) and cached,
 * so on plain EVM networks the option is a no-op. One touch per local
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

  private requiresActivation: boolean | undefined;

  constructor(
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
    private readonly activationAmount: string = DEFAULT_ACTIVATION_AMOUNT,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.custodyProvider.gasStation;
    if (!gasStation) return;
    if (!(await this.detectActivationNetwork(plan.planId))) return;

    const activator = new WalletActivator(gasStation.wallet, this.activationAmount);

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue; // executes on another ledger — not our wallets
      // only instructions that deliver tokens to a destination on this ledger; a
      // hold's business destination only receives at release, which names it again
      if (instruction.type !== "issue" && instruction.type !== "transfer" &&
          instruction.type !== "release" && instruction.type !== "revertHoldInstruction") continue;
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

  private async detectActivationNetwork(planId: string): Promise<boolean> {
    if (this.requiresActivation !== undefined) return this.requiresActivation;
    try {
      this.requiresActivation = await isHederaNetwork(this.custodyProvider.rpcProvider);
      logger.info(`Wallet activation: network ${this.requiresActivation ? "requires" : "does not require"} recipient activation`);
      return this.requiresActivation;
    } catch (e) {
      // leave undetected so the next plan retries; skip activation this plan
      logger.warning(`Wallet activation: network detection failed for plan ${planId}, skipping: ${e}`);
      return false;
    }
  }
}
