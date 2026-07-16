import { JsonRpcProvider, NonceManager, Provider, Signer, Wallet } from "ethers";
import { TokenStandard } from "@owneraio/finp2p-ethereum-ownera";
import { TrexTokenStandard, TokenStandardName as TREX } from "@owneraio/finp2p-ethereum-trex-plugin";
import { CmtatTokenStandard, TokenStandardName as CMTAT } from "@owneraio/finp2p-ethereum-cmtat-plugin";
import { BenjiTokenStandard, TokenStandardName as BENJI } from "@owneraio/finp2p-ethereum-benji-plugin";
import { AtsTokenStandard, TokenStandardName as HEDERA_ATS } from "@owneraio/finp2p-ethereum-hedera-plugin";
import { tokenStandardRegistry } from "../services/direct";
import { IntegrationContext } from "./registry";

type PluginEntry = {
  name: string;
  envPrefix: string;
  create: (provider: Provider, issuer: Signer, controller: Signer) => TokenStandard;
};

const PLUGINS: PluginEntry[] = [
  { name: TREX, envPrefix: "TREX", create: (p, i, c) => new TrexTokenStandard(p, i, c) },
  { name: CMTAT, envPrefix: "CMTAT", create: (p, i, c) => new CmtatTokenStandard(p, i, c) },
  { name: BENJI, envPrefix: "BENJI", create: (p, i, c) => new BenjiTokenStandard(p, i, c) },
  { name: HEDERA_ATS, envPrefix: "HEDERA_ATS", create: (p, i, c) => new AtsTokenStandard(p, i, c) },
];

/**
 * Registers plugin token standards (TREX, CMTAT, BENJI, HEDERA_ATS) in the
 * tokenStandardRegistry. A plugin is enabled by setting
 * `<PREFIX>_ISSUER_PRIVATE_KEY`; `<PREFIX>_CONTROLLER_PRIVATE_KEY` is optional
 * and defaults to the issuer key. Keys are deliberately separate from
 * OPERATOR_PRIVATE_KEY — plugin role signers manage their own nonces.
 */
export function registerTokenStandardPlugins(ctx: IntegrationContext): void {
  const enabled = PLUGINS.filter((plugin) => process.env[`${plugin.envPrefix}_ISSUER_PRIVATE_KEY`]);
  if (enabled.length === 0) return;

  if (!ctx.rpcUrl) {
    throw new Error(`Token standard plugin(s) [${enabled.map(p => p.name).join(", ")}] require NETWORK_HOST to be set`);
  }
  const provider = new JsonRpcProvider(ctx.rpcUrl);

  // one NonceManager per distinct key, shared across roles and plugins: two
  // managers over the same address would cache nonces independently and
  // produce stale/duplicate transactions
  const signers = new Map<string, Signer>();
  const signerFor = (key: string): Signer => {
    const normalized = key.toLowerCase().replace(/^0x/, "");
    let signer = signers.get(normalized);
    if (!signer) {
      signer = new NonceManager(new Wallet(key, provider));
      signers.set(normalized, signer);
    }
    return signer;
  };

  for (const plugin of enabled) {
    const issuerKey = process.env[`${plugin.envPrefix}_ISSUER_PRIVATE_KEY`]!;
    const controllerKey = process.env[`${plugin.envPrefix}_CONTROLLER_PRIVATE_KEY`] ?? issuerKey;
    tokenStandardRegistry.register(plugin.name, plugin.create(provider, signerFor(issuerKey), signerFor(controllerKey)));
    ctx.logger.info(`Registered token standard plugin: ${plugin.name}`);
  }
}
