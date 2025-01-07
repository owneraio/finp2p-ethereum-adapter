import { logger } from './helpers/logger';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import * as process from 'process';
import createApp from './app';
import { RegulationChecker } from './finp2p/regulation';
import { OssClient } from './finp2p/oss.client';
import { AssetCreationPolicy } from "./services/tokens";
import {
  createProviderAndSigner,
  FinP2PContractConfig,
  ProviderType,
  readConfig
} from "../finp2p-contracts/src/contracts/config";

const createAssetCreationPolicy = async (contractManager: FinP2PContract | undefined): Promise<AssetCreationPolicy> => {
  const type = (process.env.ASSET_CREATION_POLICY || 'deploy-new-token');
  switch (type) {
    case 'deploy-new-token':
      return {type: 'deploy-new-token'};
    case 'reuse-existing-token':
      let tokenAddress = process.env.TOKEN_ADDRESS;
      if (!tokenAddress) {
        if (!contractManager) {
          throw new Error('Contract manager is not defined');
        }
        logger.info('Deploying new ERC20 token to reuse it later');
        tokenAddress = await contractManager.deployERC20(`ERC20`, `ERC20`, contractManager.finP2PContractAddress);
        logger.info(`Token deployed at address: ${tokenAddress}`);
      }

      return {
        type: 'reuse-existing-token',
        tokenAddress,
      };
    case 'no-deployment':
      return {type: 'no-deployment'}
    default:
      throw new Error(`Unknown asset creation policy: ${type}`);
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

  const ossUrl = process.env.OSS_URL;

  const { provider, signer } = await createProviderAndSigner(providerType);
  const finp2pContract = new FinP2PContract(provider, signer, finP2PContractAddress);
  const assetCreationPolicy = await createAssetCreationPolicy(finp2pContract);

  createApp(
    finp2pContract,
    assetCreationPolicy,
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


