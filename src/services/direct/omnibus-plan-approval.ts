import {
  Asset, PlanApprovalStatus, IntentType, PlanContract,
  approvedPlan, rejectedPlan,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import type { PlanApprovalPlugin, PlanFailureReason } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import winston from "winston";
import { AccountMappingService } from "./account-mapping";
import { OMNIBUS_FIN_ID } from "./special-accounts";

const REJECT_CODE_OMNIBUS_SETTLEMENT_MISMATCH = 1001;

/**
 * Guards against operating an omnibus adapter whose configured wallet (e.g.
 * OMNIBUS_CUSTODY_ACCOUNT_ID -> on-chain address) does not match the
 * `orgSettlementAccount.wallet.address` registered on FinP2P for assets owned
 * by this org. A mismatch means the adapter would credit/debit a different
 * wallet than the one counterparties believe holds settlement balances —
 * funds become un-reconcilable.
 *
 * Scope: only assets where `OssAsset.organizationId === this.orgId`. Assets
 * owned by other orgs settle against THEIR omnibus; we have no opinion on it.
 */
export class OmnibusPlanApprovalPlugin implements PlanApprovalPlugin {
  // Cache approvals only — rejections must re-check so an operator fix takes
  // effect immediately on the next plan attempt.
  private readonly approvedAssets = new Set<string>();

  constructor(
    private readonly orgId: string,
    private readonly accountMapping: AccountMappingService,
    private readonly finP2PClient: FinP2PClient | undefined,
    private readonly logger: winston.Logger,
  ) {}

  async validateIssuance(_destinationFinId: string, asset: Asset, _amount: string): Promise<PlanApprovalStatus> {
    return this.validateAsset(asset);
  }

  async validateTransfer(_sourceFinId: string, _destinationFinId: string, asset: Asset, _amount: string): Promise<PlanApprovalStatus> {
    return this.validateAsset(asset);
  }

  async validateRedemption(
    _sourceFinId: string, _destinationFinId: string | undefined,
    sourceAsset: Asset, destinationAsset: Asset | undefined, _amount: string,
  ): Promise<PlanApprovalStatus> {
    const sourceResult = await this.validateAsset(sourceAsset);
    if (sourceResult.type !== 'approved') return sourceResult;
    if (destinationAsset) return this.validateAsset(destinationAsset);
    return approvedPlan();
  }

  async onPlanCompleted(_planId: string, _intentType: IntentType | undefined, _contract: PlanContract): Promise<void> {}

  async onPlanFailed(_planId: string, _intentType: IntentType | undefined, _contract: PlanContract, _status: string, _reason: PlanFailureReason | undefined): Promise<void> {}

  private async validateAsset(asset: Asset): Promise<PlanApprovalStatus> {
    if (!this.finP2PClient) return approvedPlan();
    const assetId = asset.assetId;
    if (!assetId) return approvedPlan();
    if (this.approvedAssets.has(assetId)) return approvedPlan();

    let ossAsset;
    try {
      ossAsset = await this.finP2PClient.getAsset(assetId);
    } catch (e) {
      // Don't gate approvals on FinP2P availability — log and pass.
      this.logger.warn(`omnibus settlement validation: failed to fetch asset ${assetId} from FinP2P (${e}); skipping`);
      return approvedPlan();
    }

    if (ossAsset.organizationId !== this.orgId) {
      // Counterparty asset — settles against their omnibus, not ours.
      this.approvedAssets.add(assetId);
      return approvedPlan();
    }

    const settlementAddress = ossAsset.orgSettlementAccount?.wallet?.address;
    if (!settlementAddress) {
      this.logger.warn(`omnibus settlement validation: asset ${assetId} owned by ${this.orgId} has no orgSettlementAccount.wallet.address registered on FinP2P; skipping`);
      this.approvedAssets.add(assetId);
      return approvedPlan();
    }

    const omnibusAddress = await this.accountMapping.resolveAccount(OMNIBUS_FIN_ID);
    if (!omnibusAddress) {
      this.logger.warn(`omnibus settlement validation: no '${OMNIBUS_FIN_ID}' entry in account_mappings; skipping (boot-time registerSpecialAccount may not have run)`);
      return approvedPlan();
    }
    if (settlementAddress.toLowerCase() !== omnibusAddress.toLowerCase()) {
      const message = `Omnibus wallet ${omnibusAddress} does not match asset ${assetId} orgSettlementAccount ${settlementAddress}. Verify OMNIBUS_CUSTODY_ACCOUNT_ID env vs the orgSettlementAccount registered on FinP2P.`;
      this.logger.error(message);
      return rejectedPlan(REJECT_CODE_OMNIBUS_SETTLEMENT_MISMATCH, message);
    }

    this.approvedAssets.add(assetId);
    return approvedPlan();
  }
}
