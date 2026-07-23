import { Provider } from "ethers";

/** Hedera mainnet / testnet / previewnet / localnode. */
export const HEDERA_CHAIN_IDS = new Set([295n, 296n, 297n, 298n]);

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
