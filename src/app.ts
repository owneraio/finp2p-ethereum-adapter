import express, { Application } from 'express';
import { logger as expressLogger } from 'express-winston';
import { format, transports } from 'winston';
import process from 'process';
import * as routes from './routes';
import { TokenService } from './services/tokens';
import { EscrowService } from './services/escrow';
import { PaymentsService } from './services/payments';
import { PlanService } from './services/plans';
import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';




function configureLogging(app: Application) {
  app.use(
    expressLogger({
      transports: [new transports.Console({ level: process.env.LOG_LEVEL || 'info' })],
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
}

function createApp(finP2PContract: FinP2PContract) {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  configureLogging(app);

  routes.register(
    app,
    new TokenService(finP2PContract),
    new EscrowService(finP2PContract),
    new PaymentsService(finP2PContract),
    new PlanService(),
  );

  return app;
}

export default createApp;