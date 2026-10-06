import { JsonRpcProvider, NonceManager, Provider, Signer, Wallet } from "ethers";

const providers = new Map<string, Provider>();
const signers = new Map<string, Signer>();

export function pooledProvider(rpcUrl: string): Provider {
  let provider = providers.get(rpcUrl);
  if (!provider) {
    provider = new JsonRpcProvider(rpcUrl);
    providers.set(rpcUrl, provider);
  }
  return provider;
}

/**
 * One NonceManager per (rpcUrl, key), shared across all integrations —
 * separate managers over the same address cache nonces independently and
 * produce stale/duplicate transactions when integrations alternate.
 */
export function pooledSigner(rpcUrl: string, privateKey: string): Signer {
  const key = `${rpcUrl}|${privateKey.toLowerCase().replace(/^0x/, "")}`;
  let signer = signers.get(key);
  if (!signer) {
    signer = new NonceManager(new Wallet(privateKey, pooledProvider(rpcUrl)));
    signers.set(key, signer);
  }
  return signer;
}

/** Test hook: drop pooled providers/signers between isolated test setups. */
export function resetSignerPool(): void {
  providers.clear();
  signers.clear();
}
