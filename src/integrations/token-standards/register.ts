import { Wallet } from "ethers";
import { TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { TrexTokenStandard, TokenStandardName as TREX_STANDARD } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard, TokenStandardName as CMTAT_STANDARD } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard, TokenStandardName as BENJI_STANDARD } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard, TokenStandardName as HEDERA_ATS_STANDARD } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { OwneraCollateralTokenStandard, TokenStandardName as COLLATERAL_TOKEN_STANDARD } from "@owneraio/finp2p-ethereum-collateral";
import { CollateralTokenStandard as DtccCollateralTokenStandard, TokenStandardName as DTCC_TOKEN_STANDARD } from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { tokenStandardRegistry } from "../../services/direct";
import { IntegrationContext } from "../registry";
import { pooledProvider, pooledSigner } from "../signer-pool";

/**
 * Registers every direct-mode token standard: the always-on Ethereum plugin
 * standards and the env-gated collateral and DTCC standards. Deposit /
 * plan-approval plugins are wired separately (integrations/deposits).
 */
export function registerTokenStandards(ctx: IntegrationContext): void {
  registerEthereumTokenStandards(ctx);
  registerCollateralTokenStandard(ctx);
  registerDtccTokenStandard(ctx);
}

/**
 * TREX/CMTAT/BENJI/HEDERA_ATS. issuer/controller default to
 * OPERATOR_PRIVATE_KEY (override per role via TOKEN_STANDARD_ISSUER/CONTROLLER
 * _PRIVATE_KEY); whitelisting writes use TOKEN_STANDARD_ALLOWLISTER_PRIVATE_KEY.
 * Absent an issuer/controller key an ephemeral signer stands in — reads and
 * whitelist checks work; on-chain writes need a configured, authorized key.
 */
export function registerEthereumTokenStandards(ctx: IntegrationContext): void {
  const { logger, rpcUrl } = ctx;
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
  const issuerKey = process.env.TOKEN_STANDARD_ISSUER_PRIVATE_KEY ?? operatorKey;
  const controllerKey = process.env.TOKEN_STANDARD_CONTROLLER_PRIVATE_KEY ?? operatorKey;
  const allowlisterKey = process.env.TOKEN_STANDARD_ALLOWLISTER_PRIVATE_KEY;

  const names = [TREX_STANDARD, CMTAT_STANDARD, BENJI_STANDARD, HEDERA_ATS_STANDARD];
  if (!rpcUrl) {
    logger.warn(`Ethereum token standards (${names.join(", ")}) not registered: NETWORK_HOST is not set`);
    return;
  }

  const provider = pooledProvider(rpcUrl);
  const ephemeral = !issuerKey || !controllerKey ? Wallet.createRandom().connect(provider) : undefined;
  if (ephemeral) {
    logger.info(`Ethereum token standards (${names.join(", ")}): no issuer/controller key configured — using an ephemeral signer (reads and whitelist checks work; set TOKEN_STANDARD_ISSUER_PRIVATE_KEY to issue)`);
  }
  const issuer = issuerKey ? pooledSigner(rpcUrl, issuerKey) : ephemeral!;
  const controller = controllerKey ? pooledSigner(rpcUrl, controllerKey) : ephemeral!;
  const allowlister = allowlisterKey ? pooledSigner(rpcUrl, allowlisterKey) : undefined;

  const standards: Array<[string, TokenStandard]> = [
    [TREX_STANDARD, new TrexTokenStandard(provider, issuer, controller, allowlister)],
    [CMTAT_STANDARD, new CmtatTokenStandard(provider, issuer, controller, allowlister)],
    [BENJI_STANDARD, new BenjiTokenStandard(provider, issuer, controller)],
    [HEDERA_ATS_STANDARD, new AtsTokenStandard(provider, issuer, controller, allowlister)],
  ];

  const registered: string[] = [];
  for (const [name, impl] of standards) {
    if (tokenStandardRegistry.has(name)) continue;
    tokenStandardRegistry.register(name, impl, { erc20Compatible: true });
    registered.push(name);
  }
  logger.info(`Ethereum token standards registered: ${registered.join(", ")}`);
}

/**
 * OWNERA_COLLATERAL_REGISTRY — gated on COLLATERAL_REGISTRY_ADDRESS +
 * COLLATERAL_AGENT_PRIVATE_KEY (its own signer, separate from the operator).
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

/** DTCC_COLLATERAL_ACCOUNT — gated on DTCC_PLUGIN_ENABLED. */
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
    new DtccCollateralTokenStandard(factoryAddress, provider, agentSigner) as any,
  );
  logger.info(`DTCC token standard '${DTCC_TOKEN_STANDARD}' registered`);
}
