import { IntegrationContext } from "../../registry";
import { DepositTargetResolver } from "../types";
import { OtaDepositPlugin } from "./plugin";

/**
 * One-time-address (OTA) deposit method: provisions a fresh custody account per deposit
 * via CustodyProvider.createCustodyAccount and returns its EVM address as the deposit
 * target. The investor sends funds to this address; a BalanceWatcher detects the
 * inbound, sweeps the balance to the configured sweep target, and exports a receipt
 * to FinAPI. The ephemeral key never leaves custody — the sweep is signed by the
 * custody-issued signer obtained via createWalletForCustodyId.
 *
 * Sweep target depends on account model:
 *   - segregated: the investor's mapped wallet W_I (resolved via walletResolver)
 *   - omnibus:    the operator's omnibus wallet (custodyProvider.omnibus)
 *
 * Useful when the depositor's source address is not known in advance and 1:1
 * attribution (deposit ↔ address) is required.
 *
 * In-memory deposit store; persistence is a TODO. Note: because the custody account
 * is durable, deposits can be recovered after process restart by re-instantiating
 * the wallet via createWalletForCustodyId(custodyAccountId) — the EVM key isn't
 * lost on crash, only the in-memory deposit metadata is.
 *
 * Not registered when:
 *   - DTCC_PLUGIN_ENABLED=true (DTCC owns the single PaymentsPlugin slot)
 *   - DEPOSIT_METHOD != 'ota' (default is 'wallet')
 *   - custody provider lacks createCustodyAccount / createWalletForCustodyId
 *   - segregated mode without walletResolver, or omnibus mode without an omnibus wallet
 */
export function registerOtaDeposit(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED === 'true') return;
  if (process.env.DEPOSIT_METHOD !== 'ota') return;

  const { pluginManager, logger, custodyProvider, assetStore, walletResolver, accountModel, finP2PClient, inboundTransferHook } = ctx;
  if (!custodyProvider || !assetStore) {
    logger.info('OTA-deposit plugin not registered: requires custody provider + asset store');
    return;
  }
  if (!custodyProvider.createCustodyAccount || !custodyProvider.createWalletForCustodyId) {
    logger.info('OTA-deposit plugin not registered: custody provider does not support per-deposit account creation');
    return;
  }
  if (accountModel === 'omnibus' && !custodyProvider.omnibus) {
    logger.info('OTA-deposit plugin not registered (omnibus mode): custody provider has no omnibus wallet configured');
    return;
  }
  if (accountModel === 'segregated' && !walletResolver) {
    logger.info('OTA-deposit plugin not registered (segregated mode): no wallet resolver available');
    return;
  }

  const network = process.env.NETWORK_NAME ?? 'ethereum';

  let resolveSweepTarget: DepositTargetResolver;
  if (accountModel === 'omnibus') {
    let omnibusAddress: string | undefined;
    resolveSweepTarget = async () => {
      if (!omnibusAddress) omnibusAddress = await custodyProvider.omnibus!.signer.getAddress();
      return omnibusAddress;
    };
  } else {
    resolveSweepTarget = async (finId) => (await walletResolver!(finId))?.walletAddress;
  }

  pluginManager.registerPaymentsPlugin(
    new OtaDepositPlugin(logger, assetStore, resolveSweepTarget, network, custodyProvider, finP2PClient, inboundTransferHook),
  );
  logger.info(`OTA-deposit plugin activated (network='${network}', accountModel='${accountModel}', inboundTransferHook=${inboundTransferHook ? 'present' : 'absent'})`);
}
