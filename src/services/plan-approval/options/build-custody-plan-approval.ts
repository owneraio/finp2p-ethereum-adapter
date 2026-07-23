import { Provider } from "ethers";
import { logger, PlanApprovalService } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { ConfigurablePlanApprovalService } from "../configurable-plan-approval-service";
import { PlanApprovalOption } from "../option";
import { GasStation } from "../../gas-station";
import { AccountResolver, AssetStore } from "../../accounts/account-resolver";
import { isHederaNetwork } from "../../../config";
import { TokenWhitelistingOption } from "./token-whitelisting-option";
import { GasPrefundingOption } from "./gas-prefunding-option";
import { WalletActivationOption } from "./wallet-activation-option";

export interface CustodyPlanApprovalOptions {
  walletActivationAmount?: string;
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
 * (direct and omnibus): whitelisting + gas prefunding (direct only), plus
 * recipient activation prepended only on Hedera-style networks (probed once here).
 */
export async function buildCustodyPlanApprovalService(
  orgId: string,
  finP2PClient: FinP2PClient | undefined,
  base: PlanApprovalService,
  gasStation: GasStation | undefined,
  readProvider: Provider,
  accountMapping: AccountResolver,
  assetStore: AssetStore,
  opts: CustodyPlanApprovalOptions,
): Promise<ConfigurablePlanApprovalService> {
  const options: PlanApprovalOption[] = [
    new TokenWhitelistingOption(assetStore, accountMapping),
  ];
  if (opts.investorPrefunding) {
    options.push(new GasPrefundingOption(gasStation, accountMapping));
  }

  // A definitive non-Hedera node returns false; a throw is a transient RPC
  // failure — let it fail startup (the adapter needs the RPC anyway) so a
  // restart retries, rather than silently disabling activation until restart.
  if (await isHederaNetwork(readProvider)) {
    if (gasStation) {
      logger.info("Wallet activation: network requires recipient activation — enabling the option");
      options.unshift(new WalletActivationOption(gasStation, accountMapping, opts.walletActivationAmount));
    } else {
      // Don't wire a silent no-op: activation needs the gas station to fund
      // recipients. Surface the misconfiguration instead of logging "enabled".
      logger.warning("Wallet activation: Hedera-style network detected but no gas station is configured (set GAS_FUNDING_CUSTODY_ACCOUNT_ID and GAS_FUNDING_AMOUNT) — recipient activation is disabled; wallets needing first-funding will fail to receive");
    }
  }

  return new ConfigurablePlanApprovalService(orgId, finP2PClient, base, options);
}
