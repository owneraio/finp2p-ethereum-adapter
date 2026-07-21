import { TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { TrexTokenStandard, TokenStandardName as TREX_STANDARD } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard, TokenStandardName as CMTAT_STANDARD } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard, TokenStandardName as BENJI_STANDARD } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard, TokenStandardName as HEDERA_ATS_STANDARD } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { OwneraCollateralTokenStandard, TokenStandardName as COLLATERAL_TOKEN_STANDARD } from "@owneraio/finp2p-ethereum-collateral";
import { CollateralTokenStandard as DtccCollateralTokenStandard, TokenStandardName as DTCC_TOKEN_STANDARD } from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { ERC20TokenStandard, TokenStandardName as ERC20_STANDARD } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { tokenStandardRegistry } from "./registry";
import { IntegrationContext } from "../registry";
import { pooledProvider, pooledSigner } from "../signer-pool";

/** Register a standard once (idempotent); returns its name if newly added, else undefined. */
function register(name: string, impl: TokenStandard, erc20Compatible = false): string | undefined {
  if (tokenStandardRegistry.has(name)) return undefined;
  tokenStandardRegistry.register(name, impl, { erc20Compatible });
  return name;
}

/**
 * Registers every direct-mode token standard. Deposit / plan-approval plugins
 * are wired separately (integrations/deposits).
 *
 * ERC20 (default) + TREX/CMTAT/BENJI/HEDERA_ATS are all wired the same way: the
 * issuer is the env-injected signer (ASSET_ISSUER_PRIVATE_KEY) — never the
 * custody wallet; the controller comes from ASSET_CONTROLLER_PRIVATE_KEY and
 * whitelisting writes from ASSET_WHITELIST_PRIVATE_KEY. Each role is its own
 * explicit key with no cross-fallback. These standards mint and administer with
 * those keys, so without a persistent issuer and controller nothing is
 * registered — an ephemeral signer, regenerated on every restart, would strand
 * every asset they deploy. Collateral and DTCC are separately env-gated.
 */
export function registerTokenStandards(ctx: IntegrationContext): void {
  const { logger, rpcUrl } = ctx;
  if (!rpcUrl) {
    logger.warn(`Token standards not registered: NETWORK_HOST is not set`);
    return;
  }

  const issuerKey = process.env.ASSET_ISSUER_PRIVATE_KEY;
  const controllerKey = process.env.ASSET_CONTROLLER_PRIVATE_KEY;
  const allowlisterKey = process.env.ASSET_WHITELIST_PRIVATE_KEY;
  if (!issuerKey || !controllerKey) {
    logger.warn(`Ethereum token standards not registered: set ASSET_ISSUER_PRIVATE_KEY and ASSET_CONTROLLER_PRIVATE_KEY — these standards mint and administer with those keys and cannot run without a persistent signer`);
  } else {
    const provider = pooledProvider(rpcUrl);
    const issuer = pooledSigner(rpcUrl, issuerKey);
    const controller = pooledSigner(rpcUrl, controllerKey);
    const allowlister = allowlisterKey ? pooledSigner(rpcUrl, allowlisterKey) : undefined;

    const registered = [
      register(ERC20_STANDARD, new ERC20TokenStandard(provider, issuer), true),
      register(TREX_STANDARD, new TrexTokenStandard(provider, issuer, controller, allowlister), true),
      register(CMTAT_STANDARD, new CmtatTokenStandard(provider, issuer, controller, allowlister), true),
      register(BENJI_STANDARD, new BenjiTokenStandard(provider, issuer, controller), true),
      register(HEDERA_ATS_STANDARD, new AtsTokenStandard(provider, issuer, controller, allowlister), true),
    ].filter(Boolean);
    logger.info(`Ethereum token standards registered: ${registered.join(", ")}`);
  }

  // OWNERA_COLLATERAL_REGISTRY — gated on COLLATERAL_REGISTRY_ADDRESS +
  // COLLATERAL_AGENT_PRIVATE_KEY (its own signer, separate from the operator).
  const collateralRegistry = process.env.COLLATERAL_REGISTRY_ADDRESS;
  const collateralAgentKey = process.env.COLLATERAL_AGENT_PRIVATE_KEY;
  if (collateralRegistry && collateralAgentKey) {
    const agentSigner = pooledSigner(rpcUrl, collateralAgentKey);
    const impl = new OwneraCollateralTokenStandard(collateralRegistry, pooledProvider(rpcUrl), agentSigner) as any;
    if (register(COLLATERAL_TOKEN_STANDARD, impl)) {
      logger.info(`Collateral token standard '${COLLATERAL_TOKEN_STANDARD}' registered: registry=${collateralRegistry}`);
    }
  }

  // DTCC_COLLATERAL_ACCOUNT — gated on DTCC_PLUGIN_ENABLED.
  if (process.env.DTCC_PLUGIN_ENABLED === "true") {
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY!;
    const factoryAddress = process.env.FACTORY_ADDRESS ?? "";
    const agentSigner = pooledSigner(rpcUrl, operatorKey);
    const impl = new DtccCollateralTokenStandard(factoryAddress, pooledProvider(rpcUrl), agentSigner) as any;
    if (register(DTCC_TOKEN_STANDARD, impl)) {
      logger.info(`DTCC token standard '${DTCC_TOKEN_STANDARD}' registered`);
    }
  }
}
