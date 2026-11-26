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
