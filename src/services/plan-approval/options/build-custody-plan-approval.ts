import { logger, PlanApprovalService } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { ConfigurablePlanApprovalService } from "../configurable-plan-approval-service";
import { PlanApprovalOption } from "../option";
import { CustodyProvider } from "../../custody/custody-provider";
import { AccountResolver, AssetStore } from "../../accounts/account-resolver";
import { isHederaNetwork } from "../../custody/wallet-activation";
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
  custodyProvider: CustodyProvider,
  accountMapping: AccountResolver,
  assetStore: AssetStore,
  opts: CustodyPlanApprovalOptions,
): Promise<ConfigurablePlanApprovalService> {
  const options: PlanApprovalOption[] = [
    new TokenWhitelistingOption(assetStore, accountMapping),
  ];
  if (opts.investorPrefunding) {
    options.push(new GasPrefundingOption(custodyProvider, accountMapping));
  }

  // A definitive non-Hedera node returns false; a throw is a transient RPC
  // failure — let it fail startup (the adapter needs the RPC anyway) so a
  // restart retries, rather than silently disabling activation until restart.
  if (await isHederaNetwork(custodyProvider.rpcProvider)) {
    logger.info("Wallet activation: network requires recipient activation — enabling the option");
    options.unshift(new WalletActivationOption(custodyProvider, accountMapping, opts.walletActivationAmount));
  }

  return new ConfigurablePlanApprovalService(orgId, finP2PClient, base, options);
}
