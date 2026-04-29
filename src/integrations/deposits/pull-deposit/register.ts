import { IntegrationContext } from "../../registry";
import { DepositTargetResolver } from "../types";
import { PullDepositPlugin } from "./plugin";

/**
 * Pull-deposit method: returns the adapter's operator address as the spender to approve.
 * The investor approves from their external wallet (E_I). The ApprovalWatcher detects
 * the approval and executes transferFrom(E_I, destination, amount) — moving funds into
 * the deposit target.
 *
 * Destination depends on account model:
 *   - segregated: the investor's mapped wallet W_I (via walletResolver)
 *   - omnibus:    the operator's omnibus wallet
 *
 * After a successful transferFrom, the plugin either delegates crediting to an
 * InboundTransferHook (omnibus) or calls finP2PClient.importTransactions to register
 * the deposit with FinAPI (segregated).
 *
 * The operator wallet (env / adapter constant) is the ERC20 spender AND the transferFrom
 * signer. For v1 it reuses `custodyProvider.escrow`; a dedicated
 * PULL_DEPOSIT_OPERATOR_CUSTODY_ID can be added later.
 *
 * In-memory deposit store; persistence is a TODO — see ApprovalWatcher.
 *
 * Not registered when:
 *   - DTCC_PLUGIN_ENABLED=true (DTCC owns the single PaymentsPlugin slot)
 *   - DEPOSIT_METHOD != 'pull' (default is 'wallet', handled by wallet-deposit)
 *   - segregated mode without walletResolver, or omnibus mode without an omnibus wallet
 */
export function registerPullDeposit(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') return;
  if (process.env.DEPOSIT_METHOD !== 'pull') return;

  const { pluginManager, logger, custodyProvider, assetStore, walletResolver, accountModel, finP2PClient, inboundTransferHook } = ctx;
  if (!custodyProvider || !assetStore) {
    logger.info('Pull-deposit plugin not registered: requires custody provider + asset store');
    return;
  }
  if (accountModel === 'omnibus' && !custodyProvider.omnibus) {
    logger.info('Pull-deposit plugin not registered (omnibus mode): custody provider has no omnibus wallet configured');
    return;
  }
  if (accountModel === 'segregated' && !walletResolver) {
    logger.info('Pull-deposit plugin not registered (segregated mode): no wallet resolver available');
    return;
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';
  const operatorWallet = custodyProvider.escrow;

  let resolveDepositTarget: DepositTargetResolver;
  if (accountModel === 'omnibus') {
    let omnibusAddress: string | undefined;
    resolveDepositTarget = async () => {
      if (!omnibusAddress) omnibusAddress = await custodyProvider.omnibus!.signer.getAddress();
      return omnibusAddress;
    };
  } else {
    resolveDepositTarget = async (finId) => (await walletResolver!(finId))?.walletAddress;
  }

  pluginManager.registerPaymentsPlugin(
    new PullDepositPlugin(logger, assetStore, resolveDepositTarget, network, operatorWallet, custodyProvider, finP2PClient, inboundTransferHook),
  );
  logger.info(`Pull-deposit plugin activated (network='${network}', accountModel='${accountModel}', inboundTransferHook=${inboundTransferHook ? 'present' : 'absent'})`);
}
