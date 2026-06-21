import { JsonRpcProvider, Wallet, NonceManager } from "ethers";
import {
  OwneraCollateralPlugin,
  OwneraCollateralTokenStandard,
  TokenStandardName as COLLATERAL_TOKEN_STANDARD,
} from "@owneraio/finp2p-ethereum-collateral";
import { tokenStandardRegistry } from "../../services/direct";
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

  const { orgId, logger, pluginManager, finP2PClient, rpcUrl } = ctx;
  if (!rpcUrl) {
    throw new Error('Collateral plugin requires NETWORK_HOST to be set');
  }

  const operatorKey = process.env.OPERATOR_PRIVATE_KEY!;
  const provider = new JsonRpcProvider(rpcUrl);
  const agentSigner = new NonceManager(new Wallet(operatorKey, provider));

  tokenStandardRegistry.register(
    COLLATERAL_TOKEN_STANDARD,
    new OwneraCollateralTokenStandard(registryAddress, provider, agentSigner) as any,
  );

  // 0.28.5 dropped walletResolver from the constructor — the plugin is now operator-driven.
  // Investors pre-approve the registry out-of-band; agentSigner triggers all on-chain calls.
  const plugin = new OwneraCollateralPlugin(
    orgId, provider, agentSigner, finP2PClient, logger, registryAddress,
  );
  pluginManager.registerPaymentsPlugin(plugin);

  logger.info(`Collateral plugin activated: token standard '${COLLATERAL_TOKEN_STANDARD}', registry=${registryAddress}`);
}
