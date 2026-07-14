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

    // the same wallet may sign several instructions of one plan — count them so
    // the top-up covers the whole plan rather than a single tx
    const walletTxCounts = new Map<string, number>();
    const bump = (address: string) => walletTxCounts.set(address, (walletTxCounts.get(address) ?? 0) + 1);

    // Fixed issuer/escrow addresses are resolved lazily and only for the
    // instruction types that need them, and cached per apply(). Fireblocks
    // local-submit mode uses a JsonRpcProvider placeholder (no getAddress) for
    // unconfigured issuer/escrow vaults, so a wallet whose address can't be
    // resolved is skipped best-effort rather than aborting approval.
    const fixedAddressCache = new Map<"issuer" | "escrow", string | undefined>();
    const bumpFixedWallet = async (which: "issuer" | "escrow"): Promise<void> => {
      if (!fixedAddressCache.has(which)) {
        fixedAddressCache.set(which, await this.tryResolveFixedAddress(which, plan.planId));
      }
      const address = fixedAddressCache.get(which);
      if (address) bump(address);
    };

    for (const instruction of plan.instructions) {
      if (!instruction.local) continue; // executes on another ledger — not our wallets
      switch (instruction.type) {
        case "issue":
          await bumpFixedWallet("issuer");
          break;
        case "transfer":
        case "hold":
          await this.bumpInvestorWallet(bump, instruction.sourceFinId, plan.planId, instruction.sequence);
          break;
        case "redeem":
          // redeem of escrowed funds burns from the escrow wallet; a standalone
          // redeem self-burns from the investor — fund both
          await bumpFixedWallet("escrow");
          await this.bumpInvestorWallet(bump, instruction.sourceFinId, plan.planId, instruction.sequence);
          break;
        case "release":
        case "revertHoldInstruction":
          await bumpFixedWallet("escrow");
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
    try {
      const address = await this.accountMapping.resolveAccount(finId);
      if (address) {
        bump(address);
      } else {
        logger.warning(`Gas prefunding: cannot resolve source finId ${finId} of plan ${planId} instruction ${sequence}`);
      }
    } catch (e) {
      // best-effort: a transient mapping failure (e.g. DB error) must not abort
      // an already-approved plan — skip this wallet, it funds lazily at execution
      logger.warning(`Gas prefunding: resolving source finId ${finId} of plan ${planId} instruction ${sequence} failed, skipping: ${e}`);
    }
  }

  /**
   * Resolve a fixed (issuer/escrow) wallet address, tolerating unavailable
   * wallets. In Fireblocks local-submit mode an unconfigured vault is a
   * JsonRpcProvider placeholder with no getAddress(); such a wallet is skipped
   * rather than throwing out of approval.
   */
  private async tryResolveFixedAddress(which: "issuer" | "escrow", planId: string): Promise<string | undefined> {
    try {
      const signer = this.custodyProvider[which]?.signer as { getAddress?: () => Promise<string> } | undefined;
      if (!signer || typeof signer.getAddress !== "function") {
        logger.warning(`Gas prefunding: ${which} wallet has no resolvable address (placeholder?), skipping for plan ${planId}`);
        return undefined;
      }
      return await signer.getAddress();
    } catch (e) {
      logger.warning(`Gas prefunding: resolving ${which} wallet address for plan ${planId} failed, skipping: ${e}`);
      return undefined;
    }
  }
}
