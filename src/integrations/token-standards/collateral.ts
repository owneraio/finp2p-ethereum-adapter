import {
  OwneraCollateralTokenStandard,
  TokenStandardName as COLLATERAL_TOKEN_STANDARD,
} from "@owneraio/finp2p-ethereum-collateral";
import { tokenStandardRegistry } from "../../services/direct";
import { IntegrationContext } from "../registry";
import { pooledProvider, pooledSigner } from "../signer-pool";

/**
 * Registers the Ownera triparty collateral token standard
 * (OWNERA_COLLATERAL_REGISTRY) when COLLATERAL_REGISTRY_ADDRESS +
 * COLLATERAL_AGENT_PRIVATE_KEY are set. The collateral agent EOA is its own
 * signer (keyed by COLLATERAL_AGENT_PRIVATE_KEY, deliberately separate from
 * OPERATOR_PRIVATE_KEY). The PaymentsPlugin for this standard is registered
 * separately (see integrations/collateral).
 */
export function registerCollateralTokenStandard(ctx: IntegrationContext): void {
  const registryAddress = process.env.COLLATERAL_REGISTRY_ADDRESS;
  const agentKey = process.env.COLLATERAL_AGENT_PRIVATE_KEY;
  if (!registryAddress || !agentKey) return;

  const { logger, rpcUrl } = ctx;
  if (!rpcUrl) {
    throw new Error('Collateral token standard requires NETWORK_HOST to be set');
  }

  const provider = pooledProvider(rpcUrl);
  const agentSigner = pooledSigner(rpcUrl, agentKey);

  tokenStandardRegistry.register(
    COLLATERAL_TOKEN_STANDARD,
    new OwneraCollateralTokenStandard(registryAddress, provider, agentSigner) as any,
  );
  logger.info(`Collateral token standard '${COLLATERAL_TOKEN_STANDARD}' registered: registry=${registryAddress}`);
}
