import { Wallet } from "ethers";
import { TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { TrexTokenStandard, TokenStandardName as TREX_STANDARD, TokenyClient, createTokenyQualifier, TrexInvestorQualifier } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard, TokenStandardName as CMTAT_STANDARD } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard, TokenStandardName as BENJI_STANDARD } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard, TokenStandardName as HEDERA_ATS_STANDARD } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { tokenStandardRegistry } from "../../services/direct";
import { IntegrationContext } from "../registry";
import { pooledProvider, pooledSigner } from "../signer-pool";

/**
 * Registers the provisioned Ethereum token standards (TREX, CMTAT, BENJI,
 * HEDERA_ATS) in the direct-mode token-standard registry.
 *
 * These register the value-op standard only — no PaymentsPlugin, no
 * plan-approval — so they are wired unconditionally (support-all, not
 * feature-flagged) and never contend for the single PaymentsPlugin slot.
 * Onboarding / plan-approval, where a standard needs it, is a separate concern.
 *
 * Needs NETWORK_HOST (rpc). issuer/controller default to
 * OPERATOR_PRIVATE_KEY; override per role with
 * TOKEN_STANDARD_ISSUER_PRIVATE_KEY / TOKEN_STANDARD_CONTROLLER_PRIVATE_KEY.
 * Role keys are valueless operator wallets configured via env (KMS backed),
 * never custody wallets.
 *
 * The standards are black boxes behind the TokenStandard/InvestorWhitelisting
 * interfaces: this module only maps env config onto each plugin's public
 * constructor arguments — an optional whitelisting signer
 * (TOKEN_STANDARD_ALLOWLISTER_PRIVATE_KEY) where the constructor accepts one
 * (CMTAT, HEDERA_ATS), and an optional TREX investor qualifier built from
 * TOKENY_API_URL + TOKENY_EMAIL + TOKENY_PASSWORD when those are set. What
 * each argument authorizes, and the behavior when it is absent, is the
 * plugin's contract.
 *
 * A missing issuer/controller key is not a real secret for deployments that
 * don't use these standards for agent writes (plain ERC20 signs via custody
 * wallets): an ephemeral signer stands in, so provider-backed reads and
 * whitelist checks work with a valid address. Unauthorized/unfunded writes
 * still fail on-chain per operation — nothing is lost versus a configured key
 * for such deployments, and deployments that DO issue set the explicit keys.
 */
export function registerEthereumTokenStandards(ctx: IntegrationContext): void {
  const { logger, rpcUrl, finP2PClient } = ctx;
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
  // Absent role keys get one shared ephemeral signer (valid address, can sign
  // locally; on-chain writes fail unless the address is actually authorized).
  // Deployments issuing through these standards set the explicit keys.
  const ephemeral = !issuerKey || !controllerKey ? Wallet.createRandom().connect(provider) : undefined;
  if (ephemeral) {
    logger.info(`Ethereum token standards (${names.join(", ")}): no issuer/controller key configured — using an ephemeral signer (reads and whitelist checks work; set TOKEN_STANDARD_ISSUER_PRIVATE_KEY to issue)`);
  }
  const issuer = issuerKey ? pooledSigner(rpcUrl, issuerKey) : ephemeral!;
  const controller = controllerKey ? pooledSigner(rpcUrl, controllerKey) : ephemeral!;
  const allowlister = allowlisterKey ? pooledSigner(rpcUrl, allowlisterKey) : undefined;

  const tokenyUrl = process.env.TOKENY_API_URL;
  const tokenyEmail = process.env.TOKENY_EMAIL;
  const tokenyPassword = process.env.TOKENY_PASSWORD;
  let trexQualifier: TrexInvestorQualifier | undefined;
  if (tokenyUrl && tokenyEmail && tokenyPassword) {
    trexQualifier = createTokenyQualifier(new TokenyClient(tokenyUrl, tokenyEmail, tokenyPassword), finP2PClient as any, provider, controller);
    logger.info("TREX investor qualifier enabled via the Tokeny API");
  }

  const standards: Array<[string, TokenStandard]> = [
    [TREX_STANDARD, new TrexTokenStandard(provider, issuer, controller, trexQualifier)],
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
