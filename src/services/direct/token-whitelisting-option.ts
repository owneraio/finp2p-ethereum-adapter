import { logger, rejectedPlan } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { AssetRecord, Logger as TokenLogger } from "@owneraio/finp2p-ethereum-ownera";
import { PlanApprovalOption, IntrospectedPlan } from "../plan-approval";
import { AccountMappingService, AssetStore } from "./account-mapping";
import { tokenStandardRegistry } from "./token-standards/registry";
import { supportsWhitelisting, WhitelistParty } from "./token-standards/whitelisting";

const tokenLogger: TokenLogger = {
  info: (m, ...a) => logger.info(m, ...a),
  warn: (m, ...a) => logger.warning(m, ...a),
  error: (m, ...a) => logger.error(m, ...a),
  debug: (m, ...a) => logger.debug(m, ...a),
};

type AssetWork = {
  assetId: string;
  asset: AssetRecord;
  parties: Map<string, WhitelistParty>; // keyed finId|role
};

/**
 * Plan-approval option that runs token-standard-specific investor
 * whitelisting for every asset of the plan this adapter is responsible for —
 * both legs when both assets are kept here, or just the one that is.
 *
 * Responsibility test: the instruction executes on this ledger AND the asset
 * is registered in this adapter's asset store. For each such asset the
 * instruction parties (source/destination) are resolved to addresses and
 * handed to the standard's ensureWhitelisted — sequentially, since standards
 * sign with pooled agent keys. Standards without the whitelisting capability
 * (e.g. plain ERC20) are skipped.
 *
 * Gating: a party that cannot be whitelisted (or resolved) means the plan
 * will fail at execution — reject at approval instead.
 */
export class TokenWhitelistingOption implements PlanApprovalOption {

  readonly name = "token-whitelisting";
  readonly gating = true;

  constructor(
    private readonly assetStore: AssetStore,
    private readonly accountMapping: AccountMappingService,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<ReturnType<typeof rejectedPlan> | void> {
    const work = new Map<string, AssetWork>();

    for (const instruction of plan.instructions) {
      if (!instruction.local || !instruction.assetId) continue;
      if (instruction.type === "await") continue;

      let entry = work.get(instruction.assetId);
      if (!entry) {
        const dbAsset = await this.assetStore.getAsset(instruction.assetId);
        if (dbAsset === undefined) continue; // not kept in this adapter
        entry = {
          assetId: instruction.assetId,
          asset: {
            contractAddress: dbAsset.contract_address,
            decimals: dbAsset.decimals,
            tokenStandard: dbAsset.token_standard
          },
          parties: new Map()
        };
        work.set(instruction.assetId, entry);
      }

      const veto = await this.addParty(entry, instruction.sourceFinId, "source", plan.planId)
        ?? await this.addParty(entry, instruction.destinationFinId, "destination", plan.planId);
      if (veto) return veto;
    }

    for (const { assetId, asset, parties } of work.values()) {
      const standard = tokenStandardRegistry.has(asset.tokenStandard)
        ? tokenStandardRegistry.resolve(asset.tokenStandard)
        : undefined;
      if (!standard) {
        return rejectedPlan(1, `Plan ${plan.planId}: token standard '${asset.tokenStandard}' of asset ${assetId} is not registered`);
      }
      if (!supportsWhitelisting(standard)) continue;

      const partyList = Array.from(parties.values());
      if (partyList.length === 0) continue;

      const result = await standard.ensureWhitelisted(asset, partyList, tokenLogger);
      if (result.status === "failure") {
        logger.warning(`Plan ${plan.planId}: whitelisting for asset ${assetId} failed: ${result.reason}`);
        return rejectedPlan(1, `Whitelisting failed for asset ${assetId}: ${result.reason}`);
      }
      logger.info(`Plan ${plan.planId}: whitelisting ensured for ${partyList.length} part(y/ies) of asset ${assetId}`);
    }
  }

  private async addParty(
    entry: AssetWork, finId: string | undefined, role: WhitelistParty["role"], planId: string
  ): Promise<ReturnType<typeof rejectedPlan> | undefined> {
    if (!finId) return undefined;
    const key = `${finId}|${role}`;
    if (entry.parties.has(key)) return undefined;
    const address = await this.accountMapping.resolveAccount(finId);
    if (!address) {
      // execution would fail on the unresolvable account anyway — fail early
      return rejectedPlan(1, `Plan ${planId}: cannot resolve address for ${role} ${finId} of asset ${entry.assetId}`);
    }
    entry.parties.set(key, { finId, address, role });
    return undefined;
  }
}
