import { logger, PlanApprovalService } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { ConfigurablePlanApprovalService } from "../configurable-plan-approval-service";
import { PlanApprovalOption } from "../option";
import { CustodyProvider } from "../../direct/custody-provider";
import { AccountMappingService, AssetStore } from "../../direct/account-mapping";
import { isHederaNetwork } from "../../direct/wallet-activation";
import { TokenWhitelistingOption } from "./token-whitelisting-option";
import { GasPrefundingOption } from "./gas-prefunding-option";
import { WalletActivationOption } from "./wallet-activation-option";

/**
 * Assemble the plan-approval service shared by the custody-backed modes
 * (direct and omnibus): whitelisting + gas prefunding, plus recipient
 * activation prepended only on Hedera-style networks (probed once here).
 */
export async function buildCustodyPlanApprovalService(
  orgId: string,
  finP2PClient: FinP2PClient | undefined,
  base: PlanApprovalService,
  custodyProvider: CustodyProvider,
  accountMapping: AccountMappingService,
  assetStore: AssetStore,
  walletActivationAmount?: string,
): Promise<ConfigurablePlanApprovalService> {
  const options: PlanApprovalOption[] = [
    new TokenWhitelistingOption(assetStore, accountMapping),
    new GasPrefundingOption(custodyProvider, accountMapping),
  ];

  let hederaLike = false;
  try {
    hederaLike = await isHederaNetwork(custodyProvider.rpcProvider);
  } catch (e) {
    logger.warning(`Wallet activation: network detection failed at startup — recipient activation disabled: ${e}`);
  }
  if (hederaLike) {
    logger.info("Wallet activation: network requires recipient activation — enabling the option");
    options.unshift(new WalletActivationOption(custodyProvider, accountMapping, walletActivationAmount));
  }

  return new ConfigurablePlanApprovalService(orgId, finP2PClient, base, options);
}
