import * as express from "express";
import { asyncMiddleware } from "../helpers/middleware";
import {
  assetFromAPI,
  createAssetOperationToAPI,
  destinationFromAPI,
  executionContextFromAPI,
  signatureFromAPI,
  sourceFromAPI,
  receiptOperationToAPI, balanceToAPI, destinationOptFromAPI, operationStatusToAPI, planApprovalOperationToAPI,
  depositOperationToAPI, signatureOptFromAPI, depositAssetFromAPI
} from "./mapping";
import {
  CommonService,
  EscrowService,
  HealthService,
  PlanApprovalService,
  TokenService,
  PaymentService
} from "../services/interfaces";

export const register = (app: express.Application,
                         tokenService: TokenService,
                         escrowService: EscrowService,
                         commonService: CommonService,
                         healthService: HealthService,
                         paymentService: PaymentService,
                         planService: PlanApprovalService
) => {

  app.get("/health/liveness",
    asyncMiddleware(async (req, res) => {
      if (req.headers["skip-vendor"] !== "true") {
        await healthService.liveness();
      }
      res.send("OK");
    })
  );

  app.get("/health/readiness",
    asyncMiddleware(async (req, res) => {
      if (req.headers["skip-vendor"] !== "true") {
        await healthService.readiness();
      }
      return res.send("OK");
    })
  );

  app.get("/health",
    asyncMiddleware(async (req, res) => {
      res.send("OK");
    })
  );

  app.post(
    "/api/plan/approve",
    asyncMiddleware(async (req, res) => {
      const approveOp = await planService.approvePlan(req.body);
      return res.send(planApprovalOperationToAPI(approveOp));
    })
  );

  /* POST create asset. */
  app.post(
    "/api/assets/create",
    asyncMiddleware(async (req, res) => {
      const { asset, ledgerAssetBinding } = req as unknown as Paths.CreateAsset.RequestBody;
      const { assetId } = assetFromAPI(asset);
      let tokenId: string | undefined = undefined;
      if (ledgerAssetBinding) {
        ({ tokenId } = ledgerAssetBinding as Components.Schemas.LedgerTokenId);
      }
      const result = await tokenService.createAsset(assetId, tokenId);
      return res.send(createAssetOperationToAPI(result));
    })
  );

  /* Get token balance. */
  app.post(
    "/api/assets/getBalance",
    asyncMiddleware(async (req, res) => {
      const { asset, owner: { finId } } = req as unknown as Paths.GetAssetBalance.RequestBody;
      const { assetId } = assetFromAPI(asset);
      const balance = await tokenService.getBalance(assetId, finId);
      res.send({ asset, balance } as Components.Schemas.Balance);
    })
  );

  /* Get token balance. */
  app.post(
    "/api/asset/balance",
    asyncMiddleware(async (req, res) => {
      const { asset, account } = req as unknown as Paths.GetAssetBalanceInfo.RequestBody;
      const { assetId } = assetFromAPI(asset);
      const { finId } = account;
      const balance = await tokenService.balance(assetId, finId);
      res.send(balanceToAPI(asset, account, balance));
    })
  );

  /* POST issue a token for a user. */
  app.post(
    "/api/assets/issue",
    asyncMiddleware(async (req, res) => {
      const { asset, quantity, destination: { finId: issuerFinId }, executionContext } =
        req as unknown as Paths.IssueAssets.RequestBody;

      const receiptOp = await tokenService.issue(
        assetFromAPI(asset),
        issuerFinId,
        quantity,
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptOperationToAPI(receiptOp));
    })
  );

  /* POST transfer token. */
  app.post(
    "/api/assets/transfer",
    asyncMiddleware(async (req, res) => {
      const { nonce, source, destination, asset, quantity, signature, executionContext } =
        req as unknown as Paths.TransferAsset.RequestBody;
      const receiptOp = await tokenService.transfer(
        nonce,
        sourceFromAPI(source),
        destinationFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        signatureFromAPI(signature),
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptOperationToAPI(receiptOp));
    })
  );

  /* POST redeem token. */
  app.post(
    "/api/assets/redeem",
    asyncMiddleware(async (req, res) => {
      const { nonce, source, asset, quantity, operationId, signature, executionContext } =
        req as unknown as Paths.RedeemAssets.RequestBody;
      const receiptOp = await tokenService.redeem(
        nonce,
        source,
        assetFromAPI(asset),
        quantity,
        operationId,
        signatureFromAPI(signature),
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptOperationToAPI(receiptOp));
    })
  );

  app.get(
    "/api/assets/receipts/:id",
    asyncMiddleware(async (req, res) => {
      const { id } = req.params;
      const receiptResult = await commonService.getReceipt(id);
      res.json(receiptOperationToAPI(receiptResult));
    })
  );

  /* POST get deposit instruction. */
  app.post(
    "/api/payments/depositInstruction/",
    asyncMiddleware(async (req, res) => {
      const { owner, destination, asset, amount, details, nonce, signature } = req as unknown as Paths.DepositInstruction.RequestBody;
      const depositOp = await paymentService.deposit(
        sourceFromAPI(owner),
        destinationFromAPI(destination),
        depositAssetFromAPI(asset),
        amount,
        details,
        nonce,
        signatureOptFromAPI(signature)
      );
      res.json(depositOperationToAPI(depositOp));
    })
  );

  /* POST hold token. */
  app.post(
    "/api/assets/hold",
    asyncMiddleware(async (req, res) => {
      const { nonce, source, destination, asset, quantity, operationId, signature, executionContext } =
        req as unknown as Paths.HoldOperation.RequestBody;
      const receiptOp = await escrowService.hold(
        nonce,
        sourceFromAPI(source),
        destinationOptFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        signatureFromAPI(signature),
        operationId,
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptOperationToAPI(receiptOp));
    })
  );

  /* POST release token. */
  app.post(
    "/api/assets/release",
    asyncMiddleware(async (req, res) => {
      const { destination, asset, quantity, operationId, executionContext } =
        req as unknown as Paths.ReleaseOperation.RequestBody;
      const receiptOp = await escrowService.release(
        destinationFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        operationId,
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptOperationToAPI(receiptOp));
    })
  );

  /* POST rollback token. */
  app.post(
    "/api/assets/rollback",
    asyncMiddleware(async (req, res) => {
      const { asset, quantity, operationId, executionContext } =
        req as unknown as Paths.RollbackOperation.RequestBody;
      const receiptOp = await escrowService.rollback(
        assetFromAPI(asset),
        quantity,
        operationId,
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptOperationToAPI(receiptOp));
    })
  );

  /* POST payout funds. */
  app.post(
    "/api/payments/payout",
    asyncMiddleware(async (req, res) => {
      const { source, destination, quantity, asset, payoutInstruction, nonce, signature} = req as unknown as Paths.Payout.RequestBody;
      let description: string | undefined = undefined;
      if (payoutInstruction) {
        description = payoutInstruction.description
      }
      const receiptOp = await paymentService.payout(
        sourceFromAPI(source),
        destinationOptFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        description,
        nonce,
        signatureOptFromAPI(signature)
      );
      res.json(receiptOperationToAPI(receiptOp));
    })
  );

  /* POST operation status. */
  app.get(
    "/api/operations/status/:cid",
    asyncMiddleware(async (req, res) => {
      const status = await commonService.operationStatus(req.params.cid);
      res.json(operationStatusToAPI(status));
    })
  );
};
