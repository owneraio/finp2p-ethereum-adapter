import { logger } from './helpers/logger';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import * as process from 'process';
import createApp from './app';
import { FinP2PContractConfig } from '../finp2p-contracts/src/contracts/config';
import { ApiBaseUrl, ChainId } from "@fireblocks/fireblocks-web3-provider";
import { RegulationChecker } from './finp2p/regulation';
import { OssClient } from './finp2p/oss.client';
import { AssetCreationPolicy } from "./services/tokens";
import fs from "node:fs";

const init = async () => {
  const port = process.env.PORT || '3000';

  let config: FinP2PContractConfig;
  const fbPrivateKeyPath = process.env.FIREBLOCKS_API_PRIVATE_KEY_PATH || "";
  if (!fbPrivateKeyPath) {
    throw new Error("FIREBLOCKS_API_PRIVATE_KEY_PATH is not set");
  }
  const privateKey = fs.readFileSync(fbPrivateKeyPath, "utf-8");
  const apiKey = process.env.FIREBLOCKS_API_KEY || "";
  if (!apiKey) {
    throw new Error("FIREBLOCKS_API_KEY is not set");
  }
  const chainId = (process.env.FIREBLOCKS_CHAIN_ID || ChainId.MAINNET) as ChainId;
  const apiBaseUrl = (process.env.FIREBLOCKS_API_BASE_URL || ApiBaseUrl.Production) as ApiBaseUrl
  const vaultAccountIds = process.env.FIREBLOCKS_VAULT_ACCOUNT_IDS?.split(',').map((id) => parseInt(id)) || [];

  const finP2PContractAddress = process.env.TOKEN_ADDRESS || '';
  if (!finP2PContractAddress) {
    throw new Error('TOKEN_ADDRESS is not set');
  }
  config = {
    privateKey, apiKey, chainId, apiBaseUrl, vaultAccountIds,
    finP2PContractAddress,
  };

  logger.info(`Connecting to ${chainId}...`);

  const finP2PContract = new FinP2PContract(config);
  let regulation: RegulationChecker | undefined;
  const ossUrl = process.env.OSS_URL;
  if (ossUrl) {
    logger.info(`Turning on regulation checks with OSS URL: '${ossUrl}', no auth`);
    regulation = new RegulationChecker(new OssClient(ossUrl, undefined));
  }
  
  let policy: AssetCreationPolicy = {type: 'deployment-forbidden'};

  const app = createApp(finP2PContract, policy, regulation);
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


