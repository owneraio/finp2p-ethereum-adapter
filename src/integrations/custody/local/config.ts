import { Wallet } from "ethers";

export type LocalCustodyConfig = {
  /** 0x-prefixed private keys, one wallet each */
  privateKeys: string[]
}

/**
 * Reads LOCAL_CUSTODY_PRIVATE_KEYS (comma-separated). Refuses to start unless
 * LOCAL_CUSTODY_DEV_ONLY=true: these keys sit in the process environment, so
 * the provider is for local and dev chains only.
 */
export function createLocalCustodyConfig(env: NodeJS.ProcessEnv = process.env): LocalCustodyConfig {
  if (env.LOCAL_CUSTODY_DEV_ONLY !== 'true') {
    throw new Error('PROVIDER_TYPE=local keeps private keys in the environment and is for local or dev chains only. Set LOCAL_CUSTODY_DEV_ONLY=true to confirm this is not a production deployment.');
  }
  const privateKeys = (env.LOCAL_CUSTODY_PRIVATE_KEYS ?? '').split(',').map((key) => key.trim()).filter((key) => key !== '');
  if (privateKeys.length === 0) {
    throw new Error('LOCAL_CUSTODY_PRIVATE_KEYS is required for PROVIDER_TYPE=local: a comma-separated list of 0x private keys');
  }
  privateKeys.forEach((key, index) => {
    try {
      new Wallet(key);
    } catch {
      throw new Error(`LOCAL_CUSTODY_PRIVATE_KEYS entry ${index + 1} is not a valid private key`);
    }
  });
  return { privateKeys };
}

/** Hardhat and anvil default (31337), geth and ganache dev chains (1337). */
export const DEV_CHAIN_IDS: readonly bigint[] = [31337n, 1337n];

/**
 * Refuses to start unless the RPC serves a dev chain: the keys are plaintext
 * in the environment, so a chain that holds real value must not be reachable.
 */
export async function requireDevChain(provider: { getNetwork(): Promise<{ chainId: bigint }> }): Promise<void> {
  const { chainId } = await provider.getNetwork();
  if (!DEV_CHAIN_IDS.includes(chainId)) {
    throw new Error(`PROVIDER_TYPE=local refuses to run on chain ${chainId}: it only runs on a dev chain (${DEV_CHAIN_IDS.join(', ')}) because its keys are plaintext in the environment`);
  }
}
