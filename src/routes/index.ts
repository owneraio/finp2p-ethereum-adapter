import * as express from 'express';
import * as routes from './routes';
import { TokenServiceImpl } from '../services/impl/tokens';
import { EscrowService } from '../services/impl/escrow';
import { PaymentsService } from '../services/impl/payments';
import { PlanService } from '../services/impl/plans';

export const register = (app: express.Application,
  tokenService: TokenServiceImpl,
  escrowService: EscrowService,
  paymentService: PaymentsService,
  planService: PlanService) => {
  // define a route handler for the default home page
  app.get('/', (req, res) => {
    res.send('OK');
  });

  routes.register(app, tokenService, escrowService, paymentService, planService);
};
