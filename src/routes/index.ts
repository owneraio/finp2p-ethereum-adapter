import * as express from 'express';
import * as tokens from './routes';
import { TokenService } from '../services/tokens';
import { EscrowService } from '../services/escrow';
import { PaymentsService } from '../services/payments';
import { PlanService } from '../services/plans';

export const register = (app: express.Application,
  tokenService: TokenService,
  escrowService: EscrowService,
  paymentService: PaymentsService,
  planService: PlanService) => {
  // define a route handler for the default home page
  app.get('/', (req, res) => {
    res.send('OK');
  });

  app.get('/liveness', (req, res) => {
    res.send('OK');
  });

  app.get('/readiness', (req, res) => {
    // todo: check ethereum connection
    res.send('OK');
  });

  tokens.register(app, tokenService, escrowService, paymentService, planService);
};
