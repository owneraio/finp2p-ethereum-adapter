import * as express from 'express';
import { asyncMiddleware } from '../helpers/middleware';
import { TokenService } from '../services/tokens';
import { EscrowService } from '../services/escrow';
import { PaymentsService } from '../services/payments';
import { OperatorService } from '../services/operator';
import { PlanService } from '../services/plans';


export const register = (app: express.Application,
                         tokenService: TokenService,
                         escrowService: EscrowService,
                         paymentService: PaymentsService,
                         planService: PlanService,
                         operatorService: OperatorService
) => {

  app.post(
    '/api/plan/approve',
    asyncMiddleware(async (req, res) => {
      const response = await planService.approvePlan(req.body);
      return res.send(response);
    }),
  );

  /* POST create asset. */
  app.post(
    '/api/assets/create',
    asyncMiddleware(async (req, res) => {
      const response = await tokenService.createAsset(req.body);
      return res.send(response);
    }),
  );

  /* Get token balance. */
  app.post(
    '/api/assets/getBalance',
    asyncMiddleware(async (req, res) => {
      const balance = await tokenService.balance(req.body);
      res.send(balance);
    }),
  );

  /* POST issue a token for a user. */
  app.post(
    '/api/assets/issue',
    asyncMiddleware(async (req, res) => {
      const receipt = await tokenService.issue(req.body);
      res.json(receipt);
    }),
  );

  /* POST transfer token. */
  app.post(
    '/api/assets/transfer',
    asyncMiddleware(async (req, res) => {
      const receipt = await tokenService.transfer(req.body);
      res.json(receipt);
    }),
  );

  /* POST redeem token. */
  app.post(
    '/api/assets/redeem',
    asyncMiddleware(async (req, res) => {
      const receipt = await tokenService.redeem(req.body);
      res.json(receipt);
    }),
  );

  app.get(
    '/api/assets/receipts/:id',
    asyncMiddleware(async (req, res) => {
      const { id } = req.params;
      const receipt = await tokenService.getReceipt(id);
      res.json(receipt);
    }),
  );

  /* POST get deposit instruction. */
  app.post(
    '/api/payments/depositInstruction/',
    asyncMiddleware(async (req, res) => {
      const receipt = await paymentService.deposit(req.body);
      res.json(receipt);
    }),
  );

  /* POST hold token. */
  app.post(
    '/api/assets/hold',
    asyncMiddleware(async (req, res) => {
      const receipt = await escrowService.hold(req.body);
      res.json(receipt);
    }),
  );

  /* POST release token. */
  app.post(
    '/api/assets/release',
    asyncMiddleware(async (req, res) => {
      const receipt = await escrowService.release(req.body);
      res.json(receipt);
    }),
  );

  /* POST rollback token. */
  app.post(
    '/api/assets/rollback',
    asyncMiddleware(async (req, res) => {
      const receipt = await escrowService.rollback(req.body);
      res.json(receipt);
    }),
  );

  /* POST payout funds. */
  app.post(
    '/api/payments/payout',
    asyncMiddleware(async (req, res) => {
      const receipt = await paymentService.payout(req.body);
      res.json(receipt);
    }),
  );

  /* POST operation status. */
  app.get(
    '/api/operations/status/:cid',
    asyncMiddleware(async (req, res) => {
      const status = await tokenService.operationStatus(req.params.cid);
      res.json(status);
    }),
  );

  /* POST operation status. */
  app.post(
    '/api/operator/setBalance',
    asyncMiddleware(async (req, res) => {
      const status = await operatorService.setBalance(req.body);
      res.json(status);
    }),
  );
};
