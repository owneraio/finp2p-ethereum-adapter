import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan, IntrospectedInstruction } from "../plan-approval";
import { AccountMappingService } from "./account-mapping";
import { CustodyProvider } from "./custody-provider";
import { DEFAULT_ACTIVATION_AMOUNT, isHederaNetwork, WalletActivator } from "./wallet-activation";

// instruction types whose destination receives tokens on this ledger; hold's
// business destination only receives at release, which names it again
const RECEIVING_TYPES = new Set(["issue", "transfer", "release", "revertHoldInstruction"]);

/**
 * Plan-approval option that activates recipient wallets on Hedera-style
 * networks, where an account exists only after its first native funding.
 * Gas prefunding already touches every sender (activating it as a side
 * effect); this option covers the complement — the destinations, which
 * receive tokens without ever signing.
 *
 * The network is auto-detected (chain id / JSON-RPC relay probe) and the
 * result cached, so on plain EVM networks the option is a no-op. Activation
 * runs sequentially from the gas-station funding wallet, one touch per
 * distinct destination address of the plan.
 *
 * Non-gating and best-effort, like gas prefunding: a failed touch is logged,
 * never a veto.
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
    const seen = new Set<string>();
    let activated = 0;

    for (const instruction of plan.instructions) {
      if (!instruction.local || !RECEIVING_TYPES.has(instruction.type ?? "")) continue;

      const address = await this.resolveDestination(instruction, plan.planId);
      if (!address || seen.has(address)) continue;
      seen.add(address);

      // sequential on purpose: activation sends from the single funding
      // wallet, so parallel touches would race its nonce
      try {
        if (await activator.ensureActivated(address)) {
          activated++;
          logger.info(`Wallet activation: sent ${this.activationAmount} to ${address} (plan ${plan.planId})`);
        } else {
          logger.debug(`Wallet activation: ${address} is already active (plan ${plan.planId})`);
        }
      } catch (e) {
        logger.warning(`Wallet activation: touch of ${address} for plan ${plan.planId} failed: ${e}`);
      }
    }
    if (seen.size > 0) {
      logger.info(`Wallet activation: ${seen.size} destination wallet(s) checked, ${activated} activated for plan ${plan.planId}`);
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

  /**
   * Same address resolution as execution: account mapping, with the explicit
   * ledger address accepted only where execution accepts one (transfer and
   * release destinations). Best-effort — unresolvable is a skip, not a veto.
   */
  private async resolveDestination(instruction: IntrospectedInstruction, planId: string): Promise<string | undefined> {
    const { destinationFinId: finId, type } = instruction;
    const explicitAddress = type === "transfer" || type === "release" ? instruction.destinationAddress : undefined;
    if (!finId && !explicitAddress) return undefined;
    try {
      const address = (finId ? await this.accountMapping.resolveAccount(finId) : undefined) ?? explicitAddress;
      if (!address) {
        logger.warning(`Wallet activation: cannot resolve destination ${finId} of plan ${planId} instruction ${instruction.sequence}`);
      }
      return address;
    } catch (e) {
      logger.warning(`Wallet activation: resolving destination ${finId} of plan ${planId} instruction ${instruction.sequence} failed, skipping: ${e}`);
      return undefined;
    }
  }
}
