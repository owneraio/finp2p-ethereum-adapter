import { JsonRpcProvider, Wallet, NonceManager } from "ethers";
import { OwneraCollateralPlugin } from "@owneraio/finp2p-ethereum-collateral";
import { IntegrationContext } from "../registry";

/**
 * Registers the Ownera triparty collateral PaymentsPlugin when
 * COLLATERAL_REGISTRY_ADDRESS is set. Mutually exclusive with
 * DTCC_PLUGIN_ENABLED — both compete for the single PaymentsPlugin slot.
 */
export function registerCollateralPlugin(ctx: IntegrationContext): void {
  const registryAddress = process.env.COLLATERAL_REGISTRY_ADDRESS;
  if (!registryAddress) return;

  if (process.env.DTCC_PLUGIN_ENABLED === 'true') {
    throw new Error('COLLATERAL_REGISTRY_ADDRESS and DTCC_PLUGIN_ENABLED are mutually exclusive — both claim the single PaymentsPlugin slot');
  }

  const { orgId, logger, pluginManager, finP2PClient, walletResolver, rpcUrl } = ctx;
  if (!walletResolver) {
    throw new Error('Collateral plugin requires a custody provider to resolve investor wallets');
  }
  if (!rpcUrl) {
    throw new Error('Collateral plugin requires NETWORK_HOST to be set');
  }

  const operatorKey = process.env.OPERATOR_PRIVATE_KEY!;
  const provider = new JsonRpcProvider(rpcUrl);
  const agentSigner = new NonceManager(new Wallet(operatorKey, provider));

  const plugin = new OwneraCollateralPlugin(
    orgId, provider, agentSigner, finP2PClient, logger, walletResolver, registryAddress,
  );
  pluginManager.registerPaymentsPlugin(plugin);

  logger.info(`Collateral plugin activated: registry=${registryAddress}`);
}
