import * as express from 'express';
import * as routes from './routes';
import { EscrowService, TokenService, PaymentService, PlanApprovalService } from "../services/interfaces";

export const register = (app: express.Application,
  tokenService: TokenService,
  escrowService: EscrowService,
  paymentService: PaymentService,
  planService: PlanApprovalService) => {
  // define a route handler for the default home page
  app.get('/', (req, res) => {
    res.send('OK');
  });

  routes.register(app, tokenService, escrowService, paymentService, planService);
};
