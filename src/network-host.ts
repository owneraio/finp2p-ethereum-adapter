export const getNetworkRpcUrl = (): string => {
  let networkHost = process.env.NETWORK_HOST;
  if (!networkHost) {
    throw new Error("NETWORK_HOST is not set");
  }
  const ethereumRPCAuth = process.env.NETWORK_AUTH;
  if (ethereumRPCAuth) {
    if (networkHost.startsWith("https://")) {
      networkHost = "https://" + ethereumRPCAuth + "@" + networkHost.replace("https://", "");
    } else if (networkHost.startsWith("http://")) {
      networkHost = "http://" + ethereumRPCAuth + "@" + networkHost.replace("http://", "");
    } else {
      networkHost = ethereumRPCAuth + "@" + networkHost;
    }
  }
  return networkHost;
};

/** RPC endpoint for a key that signs and submits its own transactions (local submit) — the one use of NETWORK_HOST. */
export const localSubmitRpcUrl = (keyName: string): string => {
  if (!process.env.NETWORK_HOST) {
    throw new Error(`${keyName} signs and submits its own transactions, which needs NETWORK_HOST`);
  }
  return getNetworkRpcUrl();
};
