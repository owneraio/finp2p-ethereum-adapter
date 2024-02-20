import * as express from 'express';
import * as tokens from './routes';
import {TokenService} from "../services/tokens";
import {EscrowService} from "../services/escrow";
import {PaymentsService} from "../services/payments";
import {PlanService} from "../services/plans";
import {OperatorService} from "../services/operator";

export const register = (app: express.Application,
                         tokenService: TokenService,
                         escrowService: EscrowService,
                         paymentService: PaymentsService,
                         planService: PlanService,
                         operatorService: OperatorService) => {
  // define a route handler for the default home page
  app.get('/', (req, res) => {
    res.send('OK');
  });

  app.get('/healthCheck', (req, res) => {
    res.send('OK');
  });

  tokens.register(app, tokenService, escrowService, paymentService, planService, operatorService);
};
