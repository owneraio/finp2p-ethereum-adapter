import { logger } from './helpers/logger';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import * as process from 'process';
import createApp from './app';

const init = async () => {
  const port = process.env.PORT || '3000';
  let ethereumRPCUrl = process.env.NETWORK_HOST || '';
  if (!ethereumRPCUrl) {
    throw new Error('ETHEREUM_RPC_URL is not set');
  }
  const ethereumRPCAuth = process.env.NETWORK_AUTH || '';
  if (!ethereumRPCAuth) {
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

  logger.info(`Connecting to ethereum RPC URL: ${ethereumRPCUrl}`);

  const finP2PContract = new FinP2PContract(ethereumRPCUrl, operatorPrivateKey, finP2PContractAddress);
  const app = createApp(finP2PContract);
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


