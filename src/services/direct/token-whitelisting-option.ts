import { logger, rejectedPlan } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { AssetRecord, Logger as TokenLogger } from "@owneraio/finp2p-ethereum-adapter-contract";
import { PlanApprovalOption, IntrospectedPlan, IntrospectedInstruction } from "../plan-approval";
import { AccountMappingService, AssetStore } from "./account-mapping";
import { tokenStandardRegistry } from "./token-standards/registry";
import { InvestorWhitelisting, supportsWhitelisting, WhitelistParty } from "./token-standards/whitelisting";

const tokenLogger: TokenLogger = {
  info: (m, ...a) => logger.info(m, ...a),
  warn: (m, ...a) => logger.warning(m, ...a),
  error: (m, ...a) => logger.error(m, ...a),
  debug: (m, ...a) => logger.debug(m, ...a),
};

type AssetWork = {
  assetId: string;
  asset: AssetRecord;
  /** undefined when the registered standard has no whitelisting capability */
  whitelisting?: InvestorWhitelisting;
  parties: Map<string, WhitelistParty>;
};

/**
 * Plan-approval option that runs token-standard-specific investor
 * whitelisting for every asset of the plan this adapter is responsible for.
 *
 * Responsibility test: the instruction executes on this ledger AND the asset
 * is registered in this adapter's asset store. For each such asset the
 * business parties named on its instructions — the source and destination
 * finIds — are resolved to addresses and handed to the standard's
 * ensureWhitelisted, sequentially. How the standard actually moves tokens
 * (escrow accounts, hold/release routing, etc.) is the standard's own concern;
 * the adapter passes the investors involved and lets the standard decide what
 * "whitelisted" requires. ensureWhitelisted is idempotent, so covering every
 * party is safe. Standards without the whitelisting capability (plain ERC20)
 * are skipped.
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
    const foreignAssets = new Set<string>();

    for (const instruction of plan.instructions) {
      if (!instruction.local || !instruction.assetId) continue;
      if (instruction.type === "await") continue;
      if (foreignAssets.has(instruction.assetId)) continue;

      let entry = work.get(instruction.assetId);
      if (!entry) {
        const dbAsset = await this.assetStore.getAsset(instruction.assetId);
        if (dbAsset === undefined) {
          foreignAssets.add(instruction.assetId);
          logger.debug(`Plan ${plan.planId}: asset ${instruction.assetId} is not kept in this adapter — skipping whitelisting`);
          continue;
        }
        const standardName = dbAsset.token_standard;
        if (!tokenStandardRegistry.has(standardName)) {
          logger.warning(`Plan ${plan.planId}: token standard '${standardName}' of asset ${instruction.assetId} is not registered (available: ${tokenStandardRegistry.availableStandards.join(", ")}) — rejecting`);
          return rejectedPlan(1, `Plan ${plan.planId}: token standard '${standardName}' of asset ${instruction.assetId} is not registered`);
        }
        const standard = tokenStandardRegistry.resolve(standardName);
        const whitelisting = supportsWhitelisting(standard) ? standard : undefined;
        if (!whitelisting) {
          logger.info(`Plan ${plan.planId}: asset ${instruction.assetId} standard '${standardName}' has no whitelisting capability — skipping`);
        }
        entry = {
          assetId: instruction.assetId,
          asset: {
            contractAddress: dbAsset.contract_address,
            decimals: dbAsset.decimals,
            tokenStandard: standardName
          },
          whitelisting,
          parties: new Map()
        };
        work.set(instruction.assetId, entry);
      }
      if (!entry.whitelisting) continue; // e.g. plain ERC20 — nothing to resolve

      const veto = await this.addParty(entry, instruction, "source", plan.planId)
        ?? await this.addParty(entry, instruction, "destination", plan.planId);
      if (veto) return veto;
    }

    for (const { assetId, asset, whitelisting, parties } of work.values()) {
      if (!whitelisting) continue;
      const partyList = Array.from(parties.values());
      if (partyList.length === 0) continue;

      const result = await whitelisting.ensureWhitelisted(asset, partyList, tokenLogger);
      if (result.status === "failure") {
        logger.warning(`Plan ${plan.planId}: whitelisting for asset ${assetId} failed: ${result.reason}`);
        return rejectedPlan(1, `Whitelisting failed for asset ${assetId}: ${result.reason}`);
      }
      logger.info(`Plan ${plan.planId}: whitelisting ensured for ${partyList.length} part(y/ies) of asset ${assetId}`);
    }
  }

  private async addParty(
    entry: AssetWork, instruction: IntrospectedInstruction, role: "source" | "destination", planId: string
  ): Promise<ReturnType<typeof rejectedPlan> | undefined> {
    const finId = role === "source" ? instruction.sourceFinId : instruction.destinationFinId;
    // execution accepts an explicit ledger address only for a destination; a
    // source always resolves through the account mapping
    const explicitAddress = role === "destination" ? instruction.destinationAddress : undefined;
    if (!finId && !explicitAddress) return undefined;

    const key = `${finId ?? explicitAddress}|${role}`;
    if (entry.parties.has(key)) return undefined;

    const address = (finId ? await this.accountMapping.resolveAccount(finId) : undefined) ?? explicitAddress;
    if (!address) {
      // execution would fail on the unresolvable account anyway — fail early
      logger.warning(`Plan ${planId}: cannot resolve address for ${role} ${finId} of asset ${entry.assetId} — rejecting`);
      return rejectedPlan(1, `Plan ${planId}: cannot resolve address for ${role} ${finId} of asset ${entry.assetId}`);
    }
    entry.parties.set(key, { finId, address, role });
    return undefined;
  }
}
