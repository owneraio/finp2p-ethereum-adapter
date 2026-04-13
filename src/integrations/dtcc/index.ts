import { JsonRpcProvider, Wallet, NonceManager } from "ethers";
import {
  CollateralDepositPlugin,
  CollateralPlanApprovalPlugin,
  CollateralTokenStandard,
  TokenStandardName as DTCC_TOKEN_STANDARD,
} from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { tokenStandardRegistry } from "../../services/direct";
import { IntegrationContext } from "../registry";

/**
 * Registers the DTCC collateral token standard and its deposit + plan approval
 * plugins when DTCC_PLUGIN_ENABLED=true.
 */
export function registerDtccPlugin(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED !== 'true') return;

  const { orgId, logger, pluginManager, finP2PClient, walletResolver, rpcUrl } = ctx;

  const provider = new JsonRpcProvider(rpcUrl);
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY!;
  const providerKey = process.env.PROVIDER_PRIVATE_KEY!;
  const factoryAddress = process.env.FACTORY_ADDRESS ?? '';
  const subgraphBaseUrl = process.env.SUBGRAPH_BASE_URL;
  const agentSigner = new NonceManager(new Wallet(operatorKey, provider));
  const providerSigner = new NonceManager(new Wallet(providerKey, provider));

  tokenStandardRegistry.register(DTCC_TOKEN_STANDARD, new CollateralTokenStandard(factoryAddress, provider, agentSigner) as any);

  const depositPlugin = new CollateralDepositPlugin(
    orgId, provider, agentSigner, finP2PClient, logger, walletResolver, providerSigner, subgraphBaseUrl,
  );
  pluginManager.registerPaymentsPlugin(depositPlugin);

  const planApprovalPlugin = new CollateralPlanApprovalPlugin(
    provider, agentSigner, finP2PClient, logger, walletResolver,
  );
  pluginManager.registerPlanApprovalPlugin(planApprovalPlugin);

  logger.info(`DTCC plugin activated: token standard '${DTCC_TOKEN_STANDARD}', deposit + plan approval plugins registered`);
}
