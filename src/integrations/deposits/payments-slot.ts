/**
 * True when a token-standard-specific integration (DTCC, collateral, …)
 * already owns the single PaymentsPlugin slot, so the account-model deposit
 * methods (wallet / pull / ota) must stand down.
 */
export function paymentsSlotClaimedExternally(): boolean {
  return process.env.DTCC_PLUGIN_ENABLED === 'true'
      || (!!process.env.COLLATERAL_REGISTRY_ADDRESS && !!process.env.COLLATERAL_AGENT_PRIVATE_KEY);
}
