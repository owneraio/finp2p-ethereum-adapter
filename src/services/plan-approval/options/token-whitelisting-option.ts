import { logger, rejectedPlan } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { AssetRecord, InvestorWhitelisting, Logger as TokenLogger, WhitelistParty, supportsWhitelisting } from "@owneraio/finp2p-ethereum-adapter-contract";
import { PlanApprovalOption, IntrospectedPlan } from "..";
import { AccountResolver, AssetStore } from "../../accounts/account-resolver";
import { tokenStandardRegistry } from "../../../integrations/token-standards/registry";

const tokenLogger: TokenLogger = {
  info: (m, ...a) => logger.info(m, ...a),
  warn: (m, ...a) => logger.warning(m, ...a),
  error: (m, ...a) => logger.error(m, ...a),
  debug: (m, ...a) => logger.debug(m, ...a),
};

/**
 * Plan-approval option that runs token-standard-specific investor whitelisting.
 *
 * Validate-only gating: for each instruction that executes on this ledger
 * against an asset kept in this adapter, the investors it names — the source
 * and destination finIds — are resolved to addresses and checked via the
 * standard's isWhitelisted. A party that is not whitelisted vetoes the plan;
 * whitelisting itself (whitelist/dewhitelist) is an onboarding concern
 * outside plan approval. A finId-less endpoint (escrow, external account) is
 * not an investor and is not checked. Standards without the whitelisting
 * capability (plain ERC20) are skipped.
 */
export class TokenWhitelistingOption implements PlanApprovalOption {

  readonly name = "token-whitelisting";
  readonly gating = true;

  constructor(
    private readonly assetStore: AssetStore,
    private readonly accountMapping: AccountResolver,
  ) {}

  private async validateParty(
    standard: InvestorWhitelisting, asset: AssetRecord, party: WhitelistParty,
    planId: string, assetId: string | undefined,
  ): Promise<ReturnType<typeof rejectedPlan> | undefined> {
    if (await standard.isWhitelisted(asset, party, tokenLogger)) {
      return undefined;
    }
    logger.warning(`Plan ${planId}: ${party.role} ${party.finId} (${party.address}) is not whitelisted for asset ${assetId} — rejecting`);
    return rejectedPlan(1, `${party.role} ${party.finId} is not whitelisted for asset ${assetId}`);
  }

  async apply(plan: IntrospectedPlan): Promise<ReturnType<typeof rejectedPlan> | void> {
    for (const instruction of plan.instructions) {
      if (!instruction.local || !instruction.assetId || instruction.type === "await") continue;

      const dbAsset = await this.assetStore.getAsset(instruction.assetId);
      if (!dbAsset) continue; // asset is not kept in this adapter

      if (!tokenStandardRegistry.has(dbAsset.token_standard)) {
        logger.warning(`Plan ${plan.planId}: token standard '${dbAsset.token_standard}' of asset ${instruction.assetId} is not registered — rejecting`);
        return rejectedPlan(1, `Plan ${plan.planId}: token standard '${dbAsset.token_standard}' of asset ${instruction.assetId} is not registered`);
      }
      const standard = tokenStandardRegistry.resolve(dbAsset.token_standard);
      if (!supportsWhitelisting(standard)) continue;

      const asset: AssetRecord = {
        contractAddress: dbAsset.contract_address,
        decimals: dbAsset.decimals,
        tokenStandard: dbAsset.token_standard,
      };

      if (instruction.sourceFinId) {
        const address = await this.accountMapping.resolveAccount(instruction.sourceFinId);
        if (!address) {
          return rejectedPlan(1, `Plan ${plan.planId}: cannot resolve address for source ${instruction.sourceFinId} of asset ${instruction.assetId}`);
        }
        const veto = await this.validateParty(standard, asset, { finId: instruction.sourceFinId, address, role: "source" }, plan.planId, instruction.assetId);
        if (veto) return veto;
      }

      if (instruction.destinationFinId) {
        const address = await this.accountMapping.resolveAccount(instruction.destinationFinId);
        if (!address) {
          return rejectedPlan(1, `Plan ${plan.planId}: cannot resolve address for destination ${instruction.destinationFinId} of asset ${instruction.assetId}`);
        }
        const veto = await this.validateParty(standard, asset, { finId: instruction.destinationFinId, address, role: "destination" }, plan.planId, instruction.assetId);
        if (veto) return veto;
      }
    }
  }
}
