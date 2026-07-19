import { parseEther, Provider } from "ethers";
import { CustodyWallet } from "./custody-provider";
import { GAS_FUNDING_TIMEOUT_MS, GAS_FUNDING_POLL_INTERVAL_MS } from "./gas-station";

/** Hedera mainnet / testnet / previewnet / localnode. */
export const HEDERA_CHAIN_IDS = new Set([295n, 296n, 297n, 298n]);

export const DEFAULT_ACTIVATION_AMOUNT = "0.001";

/**
 * Detect whether the connected network activates accounts on first funding
 * (Hedera-style auto-create). Two signals, no configuration:
 * - well-known Hedera chain ids;
 * - the Hedera JSON-RPC relay identifies itself as "relay/x.y.z" via
 *   web3_clientVersion, which also catches private networks (e.g. HashSphere)
 *   running the relay under a custom chain id.
 */
// JSON-RPC -32601 is authoritative; the message fallback must reference the
// method itself (e.g. geth's "the method web3_clientVersion does not exist/is
// not available") so generic outage messages ("service is not available")
// stay transient and are retried
const METHOD_UNSUPPORTED = /method\s+(?:\S+\s+)?(?:not found|not supported|not available|does not exist)|unsupported method/i;

const isMethodUnsupported = (e: unknown): boolean => {
  const err = e as { code?: unknown; message?: string; error?: { code?: unknown } };
  return err?.code === -32601 || err?.error?.code === -32601 || METHOD_UNSUPPORTED.test(err?.message ?? "");
};

export async function isHederaNetwork(provider: Provider): Promise<boolean> {
  const { chainId } = await provider.getNetwork();
  if (HEDERA_CHAIN_IDS.has(chainId)) return true;

  const send = (provider as { send?: (method: string, params: unknown[]) => Promise<unknown> }).send;
  if (typeof send !== "function") return false;
  try {
    const clientVersion = await send.call(provider, "web3_clientVersion", []);
    return typeof clientVersion === "string" && /^relay\//i.test(clientVersion);
  } catch (e) {
    // a node that doesn't implement the probe is definitively not the relay;
    // anything else is transient — propagate so callers retry instead of
    // caching a false negative
    if (isMethodUnsupported(e)) return false;
    throw e;
  }
}

/**
 * One-time recipient activation for Hedera-style networks: an account alias
 * comes into existence (and receives its canonical 0.0.x id) on its first
 * native transfer. Balance > 0 proves the address is already activated;
 * balance 0 gets the one-time touch — a false negative (activated but empty
 * account) costs one harmless tiny transfer, a false positive is impossible.
 *
 * Distinct from GasStation on purpose: gas funding is sender-side, recurring
 * and threshold-scaled; activation is recipient-side and once per wallet
 * lifetime. Both send from the same funding wallet, so callers must not run
 * them concurrently.
 */
export class WalletActivator {
  constructor(
    private readonly fundingWallet: CustodyWallet,
    private readonly amount: string,
  ) {}

  async ensureActivated(address: string): Promise<void> {
    let balance = await this.fundingWallet.provider.getBalance(address);
    if (balance > 0n) return;

    await this.fundingWallet.signer.sendTransaction({
      to: address,
      value: parseEther(this.amount),
    });

    const deadline = Date.now() + GAS_FUNDING_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, GAS_FUNDING_POLL_INTERVAL_MS));
      balance = await this.fundingWallet.provider.getBalance(address);
      if (balance > 0n) return;
    }
    throw new Error(`Activation transfer to ${address} did not reflect on-chain after ${GAS_FUNDING_TIMEOUT_MS}ms`);
  }
}
