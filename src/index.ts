import express from 'express';
import * as routes from './routes';
import {logger as expressLogger} from 'express-winston';
import {format, transports} from 'winston';
import {logger} from './helpers/logger';
import {TokenService} from "./services/tokens";
import {EscrowService} from "./services/escrow";
import {PaymentsService} from "./services/payments";
import {PlanService} from "./services/plans";
import {OperatorService} from "./services/operator";
import {FinP2PContract} from "./contracts/finp2p";
import * as process from "process";

const port = process.env.PORT || 3000;
const ethereumRPCUrl = process.env.ETHEREUM_RPC_URL || "";
const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
const finP2PContractAddress = process.env.FINP2P_CONTRACT_ADDRESS || "";

if (!ethereumRPCUrl) {
  throw new Error('ETHEREUM_RPC_URL is not set');
}
if (!operatorPrivateKey) {
  throw new Error('OPERATOR_PRIVATE_KEY is not set');
}
if (!finP2PContractAddress) {
  throw new Error('FINP2P_CONTRACT_ADDRESS is not set');
}

logger.info(`Connecting to ethereum RPC URL: ${ethereumRPCUrl}`);

const finP2PContract = new FinP2PContract(ethereumRPCUrl, operatorPrivateKey, finP2PContractAddress);

const app = express();

app.use(express.json({limit: '50mb'}));

app.use(
  expressLogger({
    transports: [new transports.Console({level: process.env.LOG_LEVEL || 'info'})],
    format: format.combine(
      format.timestamp(),
      format(function dynamicContent(info) {
        if (info.timestamp) {
          info.time = info.timestamp;
          delete info.timestamp;
        }
        if (info.message) {
          info.msg = info.message;
          // @ts-ignore
          delete info.message;
        }
        return info;
      })(),
      format.json(),
    ),
    meta: true,
    expressFormat: true,
    statusLevels: true,
    ignoreRoute: (req) => req.url.toLowerCase() === '/healthcheck',
  }),
);


// Configure routes
routes.register(
  app,
  new TokenService(finP2PContract),
  new EscrowService(finP2PContract),
  new PaymentsService(),
  new PlanService(),
  new OperatorService()
);

app.listen(port, () => {
  logger.info(`listening at http://localhost:${port}`);
});

process.on('unhandledRejection', (reason, p) => {
  logger.error('Unhandled Rejection', {promise: p, reason});
});
process.on('uncaughtException', (err, origin) => {
  logger.error('uncaught exception', {err, origin});
});


