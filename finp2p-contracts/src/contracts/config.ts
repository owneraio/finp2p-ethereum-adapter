import * as fs from 'fs';
import { ApiBaseUrl, ChainId, FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import { BrowserProvider, JsonRpcProvider, NonceManager, Provider, Signer, Wallet } from "ethers";
import process from "process";

export type ProviderType =  'local' | 'fireblocks';

export type ProviderAndSigner = {
  provider: Provider,
  signer: Signer,
}

export type ContractManagerConfig = {
  rpcURL: string;
  signerPrivateKey: string;
};

export type FinP2PContractConfig = ContractManagerConfig & {
  finP2PContractAddress: string;
};

const createLocalProvider = async (): Promise<ProviderAndSigner> => {
  let ethereumRPCUrl: string;
  let operatorPrivateKey: string;
  const configFile = process.env.CONFIG_FILE || '';
  if (configFile) {
    const config = await readConfig<ContractManagerConfig>(configFile);
    ethereumRPCUrl = config.rpcURL;
    operatorPrivateKey = config.signerPrivateKey;
  } else {
    let networkHost = process.env.NETWORK_HOST;
    if (!networkHost) {
      throw new Error('NETWORK_HOST is not set');
    }
    const ethereumRPCAuth = process.env.NETWORK_AUTH;
    if (ethereumRPCAuth) {
      if (networkHost.startsWith('https://')) {
        networkHost = 'https://' + ethereumRPCAuth + '@' + networkHost.replace('https://', '');
      } else if (networkHost.startsWith('http://')) {
        networkHost = 'http://' + ethereumRPCAuth + '@' + networkHost.replace('http://', '');
      } else {
        networkHost = ethereumRPCAuth + '@' + networkHost;
      }
    }
    ethereumRPCUrl = networkHost
    operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY || '';
    if (!operatorPrivateKey) {
      throw new Error('OPERATOR_PRIVATE_KEY is not set');
    }
  }

  const provider = new JsonRpcProvider(ethereumRPCUrl);
  const signer = new NonceManager(new Wallet(operatorPrivateKey)).connect(provider);

  return { provider, signer };
}

const createFireblocksProvider = async (): Promise<ProviderAndSigner> => {
  const apiKey = process.env.FIREBLOCKS_API_KEY || '';
  if (!apiKey) {
    throw new Error("FIREBLOCKS_API_KEY is not set");
  }

  const privKeyPath = process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH || '';
  if (!privKeyPath) {
    throw new Error("FIREBLOCKS_API_PRIVATE_KEY_PATH is not set");
  }
  const privateKey = fs.readFileSync(privKeyPath, "utf-8");

  const chainId = (process.env.FIREBLOCKS_CHAIN_ID || ChainId.MAINNET) as ChainId;
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl
  const vaultAccountIds = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS?.split(',').map((id) => parseInt(id)) || [];

  const eip1193Provider = new FireblocksWeb3Provider({
    privateKey, apiKey, chainId, apiBaseUrl, vaultAccountIds
  });
  const provider = new BrowserProvider(eip1193Provider);
  const signer = await provider.getSigner();

  return {provider, signer};
}

export const createProviderAndSigner = async (providerType: ProviderType): Promise<ProviderAndSigner> => {
  switch (providerType) {
    case 'local':
      return createLocalProvider();
    case 'fireblocks':
      return createFireblocksProvider();
  }
}

export const readConfig = async <T>(configPath: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    fs.readFile(configPath, 'utf8', (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(JSON.parse(data));
    });
  });
};

export const writeConfig = async <T>(config: T, configPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    fs.writeFile(configPath, JSON.stringify(config, null, 2), (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
};