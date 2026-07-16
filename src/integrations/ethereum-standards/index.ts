import { JsonRpcProvider, Wallet, NonceManager } from "ethers";
import { TokenStandard } from "@owneraio/finp2p-ethereum-ownera";
import { TrexTokenStandard, TokenStandardName as TREX_STANDARD } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard, TokenStandardName as CMTAT_STANDARD } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard, TokenStandardName as BENJI_STANDARD } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard, TokenStandardName as HEDERA_ATS_STANDARD } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { tokenStandardRegistry } from "../../services/direct";
import { IntegrationContext } from "../registry";

/**
 * Registers the provisioned Ethereum token standards (TREX, CMTAT, BENJI,
 * HEDERA_ATS) in the direct-mode token-standard registry.
 *
 * These register the value-op standard only — no PaymentsPlugin, no
 * plan-approval — so they are wired unconditionally (support-all, not
 * feature-flagged) and never contend for the single PaymentsPlugin slot.
 * Onboarding / plan-approval, where a standard needs it, is a separate concern.
 *
 * Needs NETWORK_HOST (rpc) + an agent key. issuer/controller default to
 * OPERATOR_PRIVATE_KEY; override per role with
 * TOKEN_STANDARD_ISSUER_PRIVATE_KEY / TOKEN_STANDARD_CONTROLLER_PRIVATE_KEY.
 */
export function registerEthereumTokenStandards(ctx: IntegrationContext): void {
  const { logger, rpcUrl } = ctx;
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
  const issuerKey = process.env.TOKEN_STANDARD_ISSUER_PRIVATE_KEY ?? operatorKey;
  const controllerKey = process.env.TOKEN_STANDARD_CONTROLLER_PRIVATE_KEY ?? operatorKey;

  const names = [TREX_STANDARD, CMTAT_STANDARD, BENJI_STANDARD, HEDERA_ATS_STANDARD];
  if (!rpcUrl || !issuerKey || !controllerKey) {
    logger.warn(`Ethereum token standards (${names.join(", ")}) not registered: set NETWORK_HOST + OPERATOR_PRIVATE_KEY (or TOKEN_STANDARD_ISSUER/CONTROLLER_PRIVATE_KEY)`);
    return;
  }

  const provider = new JsonRpcProvider(rpcUrl);
  // compare keys normalized: one NonceManager per address, or the two
  // managers would cache the same account's nonce independently
  const normalize = (key: string) => key.toLowerCase().replace(/^0x/, "");
  const issuer = new NonceManager(new Wallet(issuerKey, provider));
  const controller = normalize(controllerKey) === normalize(issuerKey)
    ? issuer
    : new NonceManager(new Wallet(controllerKey, provider));

  const standards: Array<[string, TokenStandard]> = [
    [TREX_STANDARD, new TrexTokenStandard(provider, issuer, controller)],
    [CMTAT_STANDARD, new CmtatTokenStandard(provider, issuer, controller)],
    [BENJI_STANDARD, new BenjiTokenStandard(provider, issuer, controller)],
    [HEDERA_ATS_STANDARD, new AtsTokenStandard(provider, issuer, controller)],
  ];

  const registered: string[] = [];
  for (const [name, impl] of standards) {
    if (tokenStandardRegistry.has(name)) continue;
    tokenStandardRegistry.register(name, impl);
    registered.push(name);
  }
  logger.info(`Ethereum token standards registered: ${registered.join(", ")}`);
}
