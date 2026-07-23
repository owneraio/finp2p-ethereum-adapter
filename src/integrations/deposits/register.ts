import { IntegrationContext } from "../registry";
import { registerWalletDeposit } from "./wallet-deposit";
import { registerPullDeposit } from "./pull-deposit";
import { registerOtaDeposit } from "./ota-deposit";
import { registerDtccPlugin } from "./dtcc";
import { registerCollateralPlugin } from "./collateral";

/**
 * Registers every deposit / PaymentsPlugin integration in one place: the
 * account-model deposits (wallet / pull / ota) and the collateral and DTCC
 * plugins. Only one may claim the single PaymentsPlugin slot — each registrar
 * self-gates on its env (DEPOSIT_METHOD / account model, COLLATERAL_*,
 * DTCC_PLUGIN_ENABLED) and collateral/DTCC are mutually exclusive.
 *
 * Token-standard registration for the collateral and DTCC standards is a
 * separate concern (integrations/token-standards).
 */
export function registerDeposits(ctx: IntegrationContext): void {
  registerWalletDeposit(ctx);
  registerPullDeposit(ctx);
  registerOtaDeposit(ctx);
  registerDtccPlugin(ctx);
  registerCollateralPlugin(ctx);
}
