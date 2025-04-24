import * as express from 'express';
import * as routes from './routes';
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

  routes.register(app, tokenService, escrowService, paymentService, planService);
};
