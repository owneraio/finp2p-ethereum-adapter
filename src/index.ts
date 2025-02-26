import { logger } from './helpers/logger';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import * as process from 'process';
import createApp from './app';
import { AssetCreationPolicy } from "./services/tokens";
import {
  createProviderAndSigner,
  FinP2PContractConfig,
  ProviderType,
  readConfig
} from "../finp2p-contracts/src/contracts/config";
import { PolicyGetter } from "./finp2p/policy";
import { OssClient } from "./finp2p/oss.client";

const createAssetCreationPolicy = async (contractManager: FinP2PContract | undefined): Promise<AssetCreationPolicy> => {
  const type = (process.env.ASSET_CREATION_POLICY || 'deploy-new-token');
  switch (type) {
    case 'deploy-new-token':
      let decimals = parseInt(process.env.TOKEN_DECIMALS || '0');
      return { type: 'deploy-new-token', decimals };
    case 'reuse-existing-token':
      let tokenAddress = process.env.TOKEN_ADDRESS;
      if (!tokenAddress) {
        if (!contractManager) {
          throw new Error('Contract manager is not defined');
        }
        logger.info('Deploying new ERC20 token to reuse it later');
        tokenAddress = await contractManager.deployERC20(`ERC20`, `ERC20`, 0, contractManager.finP2PContractAddress);
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
  if (!ossUrl) {
    throw new Error('OSS_URL is not set');
  }

  const { provider, signer } = await createProviderAndSigner(providerType);
  const finp2pContract = new FinP2PContract(provider, signer, finP2PContractAddress);
  const assetCreationPolicy = await createAssetCreationPolicy(finp2pContract);
  const policyGetter = new PolicyGetter(new OssClient(ossUrl, undefined));

  createApp(
    finp2pContract,
    assetCreationPolicy,
    policyGetter
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


