import { logger } from './helpers/logger';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import * as process from 'process';
import createApp from './app';
import { ApiBaseUrl, ChainId, FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import { RegulationChecker } from './finp2p/regulation';
import { OssClient } from './finp2p/oss.client';
import { AssetCreationPolicy, DeploymentType } from "./services/tokens";
import fs from "node:fs";
import { BrowserProvider, JsonRpcProvider, NonceManager, Provider, Signer, Wallet } from 'ethers';

type ProviderType =  'local' | 'fireblocks';

type ProviderDetails = {
  provider: Provider,
  signer: Signer,
  finP2PContractAddress: string
}

const createProvider = async (providerType: ProviderType): Promise<ProviderDetails> => {
  const finP2PContractAddress = process.env.TOKEN_ADDRESS || '';
  if (!finP2PContractAddress) {
    throw new Error('FINP2P_CONTRACT_ADDRESS is not set');
  }

  switch (providerType) {
    case 'local': {
      let ethereumRPCUrl = process.env.NETWORK_HOST;
      if (!ethereumRPCUrl) {
        throw new Error('ETHEREUM_RPC_URL is not set');
      }
      const ethereumRPCAuth = process.env.NETWORK_AUTH;
      if (ethereumRPCAuth) {
        if (ethereumRPCUrl.startsWith('https://')) {
          ethereumRPCUrl = 'https://' + ethereumRPCAuth + '@' + ethereumRPCUrl.replace('https://', '');
        } else if (ethereumRPCUrl.startsWith('http://')) {
          ethereumRPCUrl = 'http://' + ethereumRPCAuth + '@' + ethereumRPCUrl.replace('http://', '');
        } else {
          ethereumRPCUrl = ethereumRPCAuth + '@' + ethereumRPCUrl;
        }
      }
      const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY || '';
      if (!operatorPrivateKey) {
        throw new Error('OPERATOR_PRIVATE_KEY is not set');
      }

      const provider = new JsonRpcProvider(ethereumRPCUrl);
      const signer = new NonceManager(new Wallet(operatorPrivateKey)).connect(provider);

      return {provider, signer, finP2PContractAddress};
    }
    case 'fireblocks': {
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

      return {provider, signer, finP2PContractAddress};
    }
  }
}

const createAssetCreationPolicy = (deploymentType: DeploymentType): AssetCreationPolicy => {
  switch (deploymentType) {
    case 'deploy-new-token':
      return {type: 'deploy-new-token'};
    case 'reuse-existing-token':
      return {
        type: 'reuse-existing-token',
        tokenAddress: process.env.TOKEN_ADDRESS || ''
      };
    case 'no-deployment':
      return {type: 'no-deployment'};
  }
}

const createRegulation = (ossUrl: string | undefined): RegulationChecker | undefined => {
  if (ossUrl) {
    logger.info(`Turning on regulation checks with OSS URL: '${ossUrl}', no auth`);
    return  new RegulationChecker(new OssClient(ossUrl, undefined));
  }
  return undefined;
}

const init = async () => {
  const port = process.env.PORT || '3000';
  const providerType = (process.env.PROVIDER_TYPE || '') as ProviderType;
  const deploymentType = (process.env.DEPLOYMENT_TYPE || 'no-deployment') as DeploymentType;
  const ossUrl = process.env.OSS_URL;

  const { provider, signer, finP2PContractAddress} = await createProvider(providerType);
  const finp2pContract = new FinP2PContract(provider, signer, finP2PContractAddress);

  createApp(
    finp2pContract,
    createAssetCreationPolicy(deploymentType),
    createRegulation(ossUrl)
  ).listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });
};

init().then(() => {
  logger.info('Server started successfully');
}).catch((err) => {
  logger.error('Error starting server', err);
  process.exit(1);
});


