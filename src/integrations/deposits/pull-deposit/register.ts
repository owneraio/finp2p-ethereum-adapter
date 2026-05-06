import { IntegrationContext } from "../../registry";
import { DepositTargetResolver, resolveDepositMethod } from "../types";
import { OMNIBUS_FIN_ID, ESCROW_FIN_ID } from "../../../services/direct";
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
 *   - resolved deposit method != 'pull' (defaults: omnibus → 'ota', segregated →
 *     'wallet'; explicit DEPOSIT_METHOD env wins in either case)
 *   - segregated mode without walletResolver, or omnibus mode without an omnibus wallet
 */
export async function registerPullDeposit(ctx: IntegrationContext): Promise<void> {
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') return;
  if (resolveDepositMethod(ctx.accountModel) !== 'pull') return;

  const { pluginManager, logger, custodyProvider, assetStore, walletResolver, accountModel, finP2PClient, inboundTransferHook, accountMapping } = ctx;
  if (!custodyProvider || !assetStore) {
    logger.info('Pull-deposit plugin not registered: requires custody provider + asset store');
    return;
  }
  if (!accountMapping) {
    logger.info('Pull-deposit plugin not registered: requires DB-backed account mapping');
    return;
  }
  if (accountModel === 'segregated' && !walletResolver) {
    logger.info('Pull-deposit plugin not registered (segregated mode): no wallet resolver available');
    return;
  }

  // Resolve the operator wallet (transferFrom signer + ERC20 spender) from the
  // '__escrow__' mapping. Reuses the escrow account as in v1; a dedicated
  // PULL_DEPOSIT_OPERATOR_CUSTODY_ID can be added later.
  const escrowMapping = await accountMapping.resolveFullAccount?.(ESCROW_FIN_ID);
  if (!escrowMapping?.custodyAccountId) {
    logger.info(`Pull-deposit plugin not registered: no '${ESCROW_FIN_ID}' mapping (set ASSET_ESCROW_CUSTODY_ACCOUNT_ID)`);
    return;
  }
  const operatorWallet = await custodyProvider.createWalletForCustodyId(escrowMapping.custodyAccountId);

  if (accountModel === 'omnibus') {
    const omnibusAddress = await accountMapping.resolveAccount(OMNIBUS_FIN_ID);
    if (!omnibusAddress) {
      logger.info(`Pull-deposit plugin not registered (omnibus mode): no '${OMNIBUS_FIN_ID}' mapping (set OMNIBUS_CUSTODY_ACCOUNT_ID)`);
      return;
    }
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';

  let resolveDepositTarget: DepositTargetResolver;
  if (accountModel === 'omnibus') {
    resolveDepositTarget = async () => accountMapping.resolveAccount(OMNIBUS_FIN_ID);
  } else {
    resolveDepositTarget = async (finId) => (await walletResolver!(finId))?.walletAddress;
  }

  pluginManager.registerPaymentsPlugin(
    new PullDepositPlugin(logger, assetStore, resolveDepositTarget, network, operatorWallet, custodyProvider, finP2PClient, inboundTransferHook),
  );
  logger.info(`Pull-deposit plugin activated (network='${network}', accountModel='${accountModel}', inboundTransferHook=${inboundTransferHook ? 'present' : 'absent'})`);
}
