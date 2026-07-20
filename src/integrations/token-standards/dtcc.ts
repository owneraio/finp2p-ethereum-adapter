import {
  CollateralTokenStandard,
  TokenStandardName as DTCC_TOKEN_STANDARD,
} from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { tokenStandardRegistry } from "../../services/direct";
import { IntegrationContext } from "../registry";
import { pooledProvider, pooledSigner } from "../signer-pool";

/**
 * Registers the DTCC collateral token standard (DTCC_COLLATERAL_ACCOUNT) when
 * DTCC_PLUGIN_ENABLED=true. The deposit + plan-approval plugins for this
 * standard are registered separately (see integrations/dtcc).
 */
export function registerDtccTokenStandard(ctx: IntegrationContext): void {
  if (process.env.DTCC_PLUGIN_ENABLED !== 'true') return;

  const { logger, rpcUrl } = ctx;
  if (!rpcUrl) {
    throw new Error('DTCC token standard requires NETWORK_HOST to be set');
  }

  const provider = pooledProvider(rpcUrl);
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY!;
  const factoryAddress = process.env.FACTORY_ADDRESS ?? '';
  const agentSigner = pooledSigner(rpcUrl, operatorKey);

  tokenStandardRegistry.register(
    DTCC_TOKEN_STANDARD,
    new CollateralTokenStandard(factoryAddress, provider, agentSigner) as any,
  );
  logger.info(`DTCC token standard '${DTCC_TOKEN_STANDARD}' registered`);
}
