import { PlanApprovalService } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { ConfigurablePlanApprovalService } from "../configurable-plan-approval-service";
import { PlanApprovalOption } from "../option";
import { GasStation } from "../../gas-station";
import { AccountResolver, AssetStore } from "../../accounts/account-resolver";
import { TokenWhitelistingOption } from "./token-whitelisting-option";
import { GasPrefundingOption } from "./gas-prefunding-option";

export interface CustodyPlanApprovalOptions {
  /**
   * Prefund the source investor's wallet of each local instruction. Direct
   * mode only: omnibus transactions are signed by the omnibus wallet, so
   * funding mapped investor addresses would drain the gas station on wallets
   * that never sign.
   */
  investorPrefunding: boolean;
}

/**
 * Assemble the plan-approval service shared by the custody-backed modes
 * (direct and omnibus): whitelisting validation + gas prefunding (direct
 * only). Recipient activation happens at investor onboarding, not here.
 */
export function buildCustodyPlanApprovalService(
  orgId: string,
  finP2PClient: FinP2PClient | undefined,
  base: PlanApprovalService,
  gasStation: GasStation | undefined,
  accountMapping: AccountResolver,
  assetStore: AssetStore,
  opts: CustodyPlanApprovalOptions,
): ConfigurablePlanApprovalService {
  const options: PlanApprovalOption[] = [
    new TokenWhitelistingOption(assetStore, accountMapping),
  ];
  if (opts.investorPrefunding) {
    options.push(new GasPrefundingOption(gasStation, accountMapping));
  }
  return new ConfigurablePlanApprovalService(orgId, finP2PClient, base, options);
}
