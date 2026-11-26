import { Wallet } from "ethers";

export type LocalCustodyConfig = {
  /** 0x-prefixed private keys, one wallet each */
  privateKeys: string[]
  /** extra chain ids accepted as dev chains, beside the defaults */
  extraDevChainIds?: bigint[]
}

/**
 * Reads LOCAL_CUSTODY_PRIVATE_KEYS and the optional LOCAL_CUSTODY_DEV_CHAIN_IDS
 * (both comma-separated). Refuses to start unless
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
  return { privateKeys, extraDevChainIds: parseDevChainIds(env.LOCAL_CUSTODY_DEV_CHAIN_IDS) };
}

/** Comma-separated decimal chain ids; blank entries are ignored and an empty value means none. */
function parseDevChainIds(value: string | undefined): bigint[] {
  return (value ?? '').split(',').map((id) => id.trim()).filter((id) => id !== '').map((id) => {
    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new Error(`LOCAL_CUSTODY_DEV_CHAIN_IDS entry '${id}' is not a decimal chain id`);
    }
    return BigInt(id);
  });
}

/** Hardhat and anvil default (31337), geth and ganache dev chains (1337). */
export const DEV_CHAIN_IDS: readonly bigint[] = [31337n, 1337n];

/**
 * Refuses to start unless the RPC serves a dev chain, one of the defaults or
 * `extra`: the keys are plaintext in the environment, so a chain that holds
 * real value must not be reachable.
 */
export async function requireDevChain(
  provider: { getNetwork(): Promise<{ chainId: bigint }> },
  extra: readonly bigint[] = [],
): Promise<void> {
  const { chainId } = await provider.getNetwork();
  const allowed = [...DEV_CHAIN_IDS, ...extra];
  if (!allowed.includes(chainId)) {
    throw new Error(`PROVIDER_TYPE=local refuses to run on chain ${chainId}: it only runs on a dev chain (${allowed.join(', ')}) because its keys are plaintext in the environment. List another dev chain in LOCAL_CUSTODY_DEV_CHAIN_IDS.`);
  }
}
