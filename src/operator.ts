import { FinP2PContract } from '../finp2p-contracts/src/contracts/finp2p';
import express from 'express';
import { OperatorService } from './operator/service';
import { asyncMiddleware } from './helpers/middleware';

function createOperatorApp(finP2PContract: FinP2PContract) {
  const operatorService = new OperatorService(finP2PContract);
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.post(
    '/operator/setBalance',
    asyncMiddleware(async (req, res) => {
      const response = await operatorService.setBalance(req.body);
      return res.send(response);
    }),
  );
  return app;
}

export default createOperatorApp;