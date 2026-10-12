import { ASSETS } from "@fireblocks/fireblocks-web3-provider";

const PUBLIC_RPC: Record<string, string> = {
  "1": "https://ethereum-rpc.publicnode.com",
  "11155111": "https://ethereum-sepolia-rpc.publicnode.com",
  "17000": "https://ethereum-holesky-rpc.publicnode.com",
  "560048": "https://ethereum-hoodi-rpc.publicnode.com",
  "295": "https://mainnet.hashio.io/api",
  "296": "https://testnet.hashio.io/api",
};

/** NETWORK_HOST with NETWORK_AUTH folded in, or undefined when NETWORK_HOST is not set. */
export function configuredRpcUrl(): string | undefined {
  const networkHost = process.env.NETWORK_HOST || undefined;
  if (!networkHost) return undefined;
  const auth = process.env.NETWORK_AUTH || undefined;
  if (!auth) return networkHost;
  const scheme = networkHost.match(/^https?:\/\//)?.[0];
  return scheme ? `${scheme}${auth}@${networkHost.slice(scheme.length)}` : `${auth}@${networkHost}`;
}

export function publicRpcUrl(chainId: bigint | number | string): string | undefined {
  const key = String(chainId);
  return PUBLIC_RPC[key] ?? (ASSETS as Record<string, { rpcUrl?: string } | undefined>)[key]?.rpcUrl;
}

/**
 * The RPC endpoint chain reads go through: NETWORK_HOST when set, otherwise a
 * public endpoint of the chain the custodian operates on.
 */
export function resolveRpcUrl(chainId: bigint | number | string): string {
  const url = configuredRpcUrl() ?? publicRpcUrl(chainId);
  if (!url) throw new Error(`No public RPC endpoint is known for chain ${chainId}; set NETWORK_HOST`);
  return url;
}
