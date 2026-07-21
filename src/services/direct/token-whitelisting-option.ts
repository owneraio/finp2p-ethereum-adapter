import { logger, rejectedPlan } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { AssetRecord, Logger as TokenLogger } from "@owneraio/finp2p-ethereum-adapter-contract";
import { PlanApprovalOption, IntrospectedPlan, IntrospectedInstruction } from "../plan-approval";
import { AccountMappingService, AssetStore } from "./account-mapping";
import { CustodyProvider } from "./custody-provider";
import { tokenStandardRegistry } from "../../integrations/token-standards/registry";
import { InvestorWhitelisting, supportsWhitelisting, WhitelistParty, WhitelistPartyRole } from "@owneraio/finp2p-ethereum-adapter-contract";

const tokenLogger: TokenLogger = {
  info: (m, ...a) => logger.info(m, ...a),
  warn: (m, ...a) => logger.warning(m, ...a),
  error: (m, ...a) => logger.error(m, ...a),
  debug: (m, ...a) => logger.debug(m, ...a),
};

// which parties each instruction type actually moves tokens between — holds
// transfer source → escrow, releases escrow → destination; a hold's business
// destination is not a transfer endpoint until the release names it
const INSTRUCTION_ENDPOINTS: Record<string, WhitelistPartyRole[]> = {
  issue: ["destination"],
  transfer: ["source", "destination"],
  hold: ["source", "escrow"],
  release: ["escrow", "destination"],
  revertHoldInstruction: ["escrow", "destination"],
  redeem: ["source", "escrow"],
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
 * whitelisting for every asset of the plan this adapter is responsible for —
 * both legs when both assets are kept here, or just the one that is.
 *
 * Responsibility test: the instruction executes on this ledger AND the asset
 * is registered in this adapter's asset store. The asset's standard is
 * resolved first; only standards with the whitelisting capability have their
 * parties collected, so plain ERC20 plans are never vetoed over an account
 * that whitelisting alone would need. Parties are the actual transfer
 * endpoints of each instruction type (including the escrow custody wallet for
 * hold/release paths), resolved with execution's exact rules: account mapping
 * everywhere, with the instruction's explicit ledger address as fallback only
 * where execution accepts one — transfer/release destinations. Resolved
 * parties are handed to ensureWhitelisted sequentially, since standards sign
 * with pooled agent keys.
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
    private readonly custodyProvider: CustodyProvider,
  ) {}

  async apply(plan: IntrospectedPlan): Promise<ReturnType<typeof rejectedPlan> | void> {
    const work = new Map<string, AssetWork>();
    const foreignAssets = new Set<string>();
    let escrowAddress: string | undefined;
    let escrowResolved = false;

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

      for (const role of INSTRUCTION_ENDPOINTS[instruction.type ?? ""] ?? []) {
        if (role === "escrow") {
          if (!escrowResolved) {
            escrowAddress = await this.tryResolveEscrowAddress(plan.planId);
            escrowResolved = true;
          }
          if (!escrowAddress) {
            // hold/release execution needs this wallet — approving without
            // whitelisting the actual endpoint would just defer the failure
            logger.warning(`Plan ${plan.planId}: escrow wallet address is unavailable but asset ${entry.assetId} needs its escrow endpoint whitelisted — rejecting`);
            return rejectedPlan(1, `Plan ${plan.planId}: escrow wallet address is unavailable; cannot whitelist the escrow endpoint of asset ${entry.assetId}`);
          }
          entry.parties.set(`escrow|${escrowAddress}`, { address: escrowAddress, role: "escrow" });
          continue;
        }
        const veto = await this.addParty(entry, instruction, role, plan.planId);
        if (veto) return veto;
      }
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
    // execution accepts an explicit ledger address only for transfer/release
    // destinations; sources always require a mapped custody wallet
    const explicitAddress = role === "destination" && (instruction.type === "transfer" || instruction.type === "release")
      ? instruction.destinationAddress
      : undefined;
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

  /**
   * The escrow custody wallet is a transfer endpoint of hold/release paths and
   * may need whitelisting itself. An unresolvable address (e.g. an
   * unconfigured Fireblocks placeholder vault with no getAddress()) makes the
   * caller veto: hold/release execution needs that wallet anyway.
   */
  private async tryResolveEscrowAddress(planId: string): Promise<string | undefined> {
    try {
      const signer = this.custodyProvider.escrow?.signer as { getAddress?: () => Promise<string> } | undefined;
      if (!signer || typeof signer.getAddress !== "function") {
        logger.warning(`Token whitelisting: escrow wallet has no resolvable address (placeholder?) for plan ${planId}`);
        return undefined;
      }
      return await signer.getAddress();
    } catch (e) {
      logger.warning(`Token whitelisting: resolving escrow wallet address for plan ${planId} failed: ${e}`);
      return undefined;
    }
  }
}
