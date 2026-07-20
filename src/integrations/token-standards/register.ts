import { IntegrationContext } from "../registry";
import { registerEthereumTokenStandards } from "./ethereum";
import { registerCollateralTokenStandard } from "./collateral";
import { registerDtccTokenStandard } from "./dtcc";

/**
 * Registers every direct-mode token standard the adapter supports — the
 * provisioned Ethereum plugin standards (TREX/CMTAT/BENJI/HEDERA_ATS) plus the
 * env-gated collateral (OWNERA_COLLATERAL_REGISTRY) and DTCC
 * (DTCC_COLLATERAL_ACCOUNT) standards. Deposit / plan-approval plugins for the
 * collateral and DTCC standards are wired separately.
 */
export function registerTokenStandards(ctx: IntegrationContext): void {
  registerEthereumTokenStandards(ctx);
  registerCollateralTokenStandard(ctx);
  registerDtccTokenStandard(ctx);
}
