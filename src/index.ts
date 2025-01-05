import { logger } from './helpers/logger';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import * as process from 'process';
import createApp from './app';
import { RegulationChecker } from './finp2p/regulation';
import { OssClient } from './finp2p/oss.client';
import { AssetCreationPolicy, DeploymentType } from "./services/tokens";
import {
  createProviderAndSigner,
  FinP2PContractConfig,
  ProviderType,
  readConfig
} from "../finp2p-contracts/src/contracts/config";


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
  const configFile = process.env.CONFIG_FILE || '';
  let finP2PContractAddress: string
  if (configFile) {
    const config = await readConfig<FinP2PContractConfig>(configFile);
    finP2PContractAddress = config.finP2PContractAddress;

  } else {
    finP2PContractAddress = process.env.TOKEN_ADDRESS || '';
    if (!finP2PContractAddress) {
      throw new Error('FINP2P_CONTRACT_ADDRESS is not set');
    }
  }
  const providerType = (process.env.PROVIDER_TYPE || 'local') as ProviderType;
  const deploymentType = (process.env.DEPLOYMENT_TYPE || 'deploy-new-token') as DeploymentType;

  const ossUrl = process.env.OSS_URL;

  const { provider, signer } = await createProviderAndSigner(providerType);
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


