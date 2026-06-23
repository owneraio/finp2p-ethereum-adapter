import { JsonRpcProvider, Wallet, NonceManager } from "ethers";
import {
  OwneraCollateralPlugin,
  OwneraCollateralTokenStandard,
  TokenStandardName as COLLATERAL_TOKEN_STANDARD,
  WalletResolver as CollateralWalletResolver,
} from "@owneraio/finp2p-ethereum-collateral";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import { tokenStandardRegistry, WalletResolver as CustodyWalletResolver } from "../../services/direct";
import { IntegrationContext } from "../registry";

/**
 * Registers the Ownera triparty collateral PaymentsPlugin when
 * COLLATERAL_REGISTRY_ADDRESS is set. Mutually exclusive with
 * DTCC_PLUGIN_ENABLED — both compete for the single PaymentsPlugin slot.
 *
 * The collateral agent EOA is its **own** signer, keyed by
 * COLLATERAL_AGENT_PRIVATE_KEY — deliberately separate from
 * OPERATOR_PRIVATE_KEY. They sign different things (the operator drives
 * FINP2POperator / hold-release flows; the collateral agent drives the
 * triparty registry) and sharing a key would let either path's
 * out-of-band ops scripts drift the other's in-memory NonceManager.
 *
 * The agent's address is derived from the key — there is no
 * COLLATERAL_AGENT_ADDRESS env var to keep in sync.
 *
 * 0.28.6's WalletResolver is address-only: `(finId) => Promise<string | undefined>`.
 * We construct it from whichever lookup is available in the current PROVIDER_TYPE:
 *   - custody modes (fireblocks/dfns): adapt the fat custody resolver, returning
 *     just `walletAddress`.
 *   - finp2p-contract mode (no custody): call FINP2POperator.getCredentialAddress(finId)
 *     directly. The on-chain credentials registry maps finIds to ETH addresses;
 *     custodyAccountId isn't relevant in this mode.
 */
export function registerCollateralPlugin(ctx: IntegrationContext): void {
  const registryAddress = process.env.COLLATERAL_REGISTRY_ADDRESS;
  const agentKey = process.env.COLLATERAL_AGENT_PRIVATE_KEY;
  if (!registryAddress || !agentKey) return;

  if (process.env.DTCC_PLUGIN_ENABLED === 'true') {
    throw new Error('Collateral plugin and DTCC_PLUGIN_ENABLED are mutually exclusive — both claim the single PaymentsPlugin slot');
  }

  const { orgId, logger, pluginManager, finP2PClient, rpcUrl, walletResolver, finP2PContract } = ctx;
  if (!rpcUrl) {
    throw new Error('Collateral plugin requires NETWORK_HOST to be set');
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const agentWallet = new Wallet(agentKey, provider);
  const agentAddress = agentWallet.address;
  const agentSigner = new NonceManager(agentWallet);

  // `ledgerName` is the logical name the FinP2P router uses to identify this
  // adapter — not the chain (use NETWORK_NAME for that). Defaults to 'ethereum'
  // for back-compat with existing router configurations.
  const ledgerName = process.env.LEDGER_NAME ?? 'ethereum';
  const collateralWalletResolver = buildCollateralWalletResolver(walletResolver, finP2PContract);

  tokenStandardRegistry.register(
    COLLATERAL_TOKEN_STANDARD,
    new OwneraCollateralTokenStandard(registryAddress, provider, agentSigner) as any,
  );

  const plugin = new OwneraCollateralPlugin(
    orgId, provider, agentSigner, finP2PClient, logger, collateralWalletResolver, registryAddress, ledgerName,
  );
  pluginManager.registerPaymentsPlugin(plugin);

  logger.info(`Collateral plugin activated: token standard '${COLLATERAL_TOKEN_STANDARD}', registry=${registryAddress}, agent=${agentAddress}, ledger=${ledgerName}`);
}

function buildCollateralWalletResolver(
  custodyResolver: CustodyWalletResolver | undefined,
  finP2PContract: FinP2PContract | undefined,
): CollateralWalletResolver {
  if (custodyResolver) {
    return async (finId: string) => (await custodyResolver(finId))?.walletAddress;
  }
  if (finP2PContract) {
    // finp2p-contract mode: resolve finId → ETH address from the FINP2POperator
    // credentials registry. Unmapped finIds revert with "Credential not found"
    // (FINP2POperator.sol:127) — translate that one revert into `undefined` so the
    // plugin's normal "no address" path runs; bubble any other failure up.
    return async (finId: string) => {
      try {
        return await finP2PContract.getCredentialAddress(finId);
      } catch (e) {
        if (e instanceof Error && /Credential not found/.test(e.message)) return undefined;
        throw e;
      }
    };
  }
  throw new Error('Collateral plugin requires either a custody provider or a finp2p-contract to resolve finIds to wallet addresses');
}
