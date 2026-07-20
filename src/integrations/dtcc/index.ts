import {
  CollateralDepositPlugin,
  CollateralPlanApprovalPlugin,
} from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { IntegrationContext } from "../registry";
import { pooledProvider, pooledSigner } from "../signer-pool";

/**
 * Registers the DTCC deposit + plan-approval plugins when
 * DTCC_PLUGIN_ENABLED=true. The DTCC token standard itself is registered
 * separately (see integrations/token-standards/dtcc).
 */
export function registerDtccPlugin(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED !== 'true') return;

  const { orgId, logger, pluginManager, finP2PClient, walletResolver, rpcUrl } = ctx;
  if (!walletResolver) {
    throw new Error('DTCC plugin requires a custody provider to resolve investor wallets');
  }
  if (!rpcUrl) {
    throw new Error('DTCC plugin requires NETWORK_HOST to be set');
  }

  const provider = pooledProvider(rpcUrl);
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY!;
  const providerKey = process.env.PROVIDER_PRIVATE_KEY!;
  const subgraphBaseUrl = process.env.SUBGRAPH_BASE_URL;
  const agentSigner = pooledSigner(rpcUrl, operatorKey);
  const providerSigner = pooledSigner(rpcUrl, providerKey);

  const depositPlugin = new CollateralDepositPlugin(
    orgId, provider, agentSigner, finP2PClient, logger, walletResolver, providerSigner, subgraphBaseUrl,
  );
  pluginManager.registerPaymentsPlugin(depositPlugin);

  const planApprovalPlugin = new CollateralPlanApprovalPlugin(
    provider, agentSigner, finP2PClient, logger, walletResolver,
  );
  pluginManager.registerPlanApprovalPlugin(planApprovalPlugin);

  logger.info('DTCC plugin activated: deposit + plan approval plugins registered');
}
