import { logger } from './helpers/logger';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import * as process from 'process';
import createApp from './app';
import { FinP2PContractConfig, readConfig } from '../finp2p-contracts/src/contracts/config';
import { RegulationChecker } from './finp2p/regulation';
import { OssClient } from './finp2p/oss.client';
import { DeployNewToken } from './services/tokens';

const init = async () => {
  const port = process.env.PORT || '3000';

  const configFile = process.env.CONFIG_FILE || '';
  let config: FinP2PContractConfig;
  if (configFile) {
    config = await readConfig<FinP2PContractConfig>(configFile);

    // TODO: add config validation

  } else {
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

    const finP2PContractAddress = process.env.TOKEN_ADDRESS || '';
    if (!finP2PContractAddress) {
      throw new Error('FINP2P_CONTRACT_ADDRESS is not set');
    }
    config = {
      rpcURL: ethereumRPCUrl,
      signerPrivateKey: operatorPrivateKey,
      finP2PContractAddress,
    };
  }

  logger.info(`Connecting to ethereum RPC URL: ${config.rpcURL}`);

  const finP2PContract = new FinP2PContract(config);
  let regulation: RegulationChecker | undefined;
  const ossUrl = process.env.OSS_URL;
  if (ossUrl) {
    regulation = new RegulationChecker(new OssClient(ossUrl, undefined));
  }
  const assetCreationPolicy = { type: 'deploy-new-token' } as DeployNewToken;
  const app = createApp(finP2PContract, assetCreationPolicy, regulation);
  app.listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });
};

init().then(() => {
  logger.info('Server started successfully');
}).catch((err) => {
  logger.error('Error starting server', err);
  process.exit(1);
});


