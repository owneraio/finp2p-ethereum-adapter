import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { PlanApprovalOption, IntrospectedPlan } from "../plan-approval";
import { CustodyProvider } from "./custody-provider";
import { AccountMappingService } from "./account-mapping";

/**
 * Plan-approval option that moves gas funding out of the instruction execution
 * hot path: on approval, every wallet that will sign one of this org's
 * instructions is topped up once, scaled to how many instructions it signs.
 *
 * Wallet-per-instruction mapping mirrors DirectTokenService's signer choice:
 * issue → issuer wallet; transfer/hold → the source investor's wallet;
 * release/revertHold → the escrow wallet; redeem → the escrow wallet (redeem
 * of escrowed funds) and the source investor (standalone self-burn).
 *
 * Side-effect only — never vetoes approval. Best-effort: per-wallet funding
 * failures are logged, not propagated.
 */
export class GasPrefundingOption implements PlanApprovalOption {

  readonly name = "gas-prefunding";

  constructor(
    private readonly custodyProvider: CustodyProvider,
    private readonly accountMapping: AccountMappingService,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<void> {
    const gasStation = this.custodyProvider.gasStation;
    if (!gasStation) return;

    // the same wallet may sign several instructions of one plan — count them so
    // the top-up covers the whole plan rather than a single tx
    const walletTxCounts = new Map<string, number>();
    const bump = (address: string) => walletTxCounts.set(address, (walletTxCounts.get(address) ?? 0) + 1);

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue; // executes on another ledger — not our wallets
      switch (instruction.type) {
        case "issue":
          bump(await this.custodyProvider.issuer.signer.getAddress());
          break;
        case "transfer":
        case "hold":
          await this.bumpInvestorWallet(bump, instruction.sourceFinId, plan.planId, instruction.sequence);
          break;
        case "redeem":
          // redeem of escrowed funds burns from the escrow wallet; a standalone
          // redeem self-burns from the investor — fund both
          bump(await this.custodyProvider.escrow.signer.getAddress());
          await this.bumpInvestorWallet(bump, instruction.sourceFinId, plan.planId, instruction.sequence);
          break;
        case "release":
        case "revertHoldInstruction":
          bump(await this.custodyProvider.escrow.signer.getAddress());
          break;
      }
    }

    // sequential on purpose: the gas station funds from a single wallet, so
    // parallel top-ups would race its nonce. Best-effort per wallet — one
    // failure must not skip the others.
    let funded = 0;
    for (const [address, txCount] of walletTxCounts) {
      try {
        await gasStation.ensureGas(address, txCount);
        funded++;
      } catch (e) {
        logger.warning(`Gas prefunding: top-up of ${address} for plan ${plan.planId} failed: ${e}`);
      }
    }
    if (funded > 0) {
      logger.info(`Pre-funded gas for ${funded}/${walletTxCounts.size} wallet(s) of plan ${plan.planId}`);
    }
  }

  private async bumpInvestorWallet(
    bump: (address: string) => void, finId: string | undefined, planId: string, sequence?: number
  ): Promise<void> {
    if (!finId) return;
    const address = await this.accountMapping.resolveAccount(finId);
    if (address) {
      bump(address);
    } else {
      logger.warning(`Gas prefunding: cannot resolve source finId ${finId} of plan ${planId} instruction ${sequence}`);
    }
  }
}
