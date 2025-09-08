import * as express from "express";
import { asyncMiddleware } from "../helpers/middleware";
import { EscrowService } from "../services/impl/escrow";
import { PaymentsService } from "../services/impl/payments";
import { PlanService } from "../services/impl/plans";
import {
  assetFromAPI,
  assetResultToAPI,
  destinationFromAPI,
  executionContextFromAPI,
  signatureFromAPI,
  sourceFromAPI,
  receiptResultToAPI, balanceToAPI
} from "./mapping";
import LedgerTokenId = FinAPIComponents.Schemas.LedgerTokenId;
import { HealthService, TokenService } from "../services/interfaces";
import { logger } from "../helpers/logger";


export const register = (app: express.Application,
                         tokenService: TokenService,
                         escrowService: EscrowService,
                         paymentService: PaymentsService,
                         planService: PlanService,
                         healthService: HealthService
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
      const response = await planService.approvePlan(req.body);
      return res.send(response);
    })
  );

  /* POST create asset. */
  app.post(
    "/api/assets/create",
    asyncMiddleware(async (req, res) => {
      // @ts-ignore
      const request = req as Paths.CreateAsset.RequestBody;
      const { asset, ledgerAssetBinding } = request;
      const { assetId } = assetFromAPI(asset);
      let tokenId: string | undefined = undefined;
      if (ledgerAssetBinding) {
        ({ tokenId } = ledgerAssetBinding as LedgerTokenId);
      }
      const result = await tokenService.createAsset(assetId, tokenId);
      return res.send(assetResultToAPI(result));
    })
  );

  /* Get token balance. */
  app.post(
    "/api/assets/getBalance",
    asyncMiddleware(async (req, res) => {
      // @ts-ignore
      const request = req as Paths.GetAssetBalance.RequestBody;
      logger.debug("getBalance", { request });
      const { asset, owner: { finId } } = request;
      const { assetId } = assetFromAPI(asset);
      const balance = await tokenService.getBalance(assetId, finId);
      res.send({ asset, balance } as Components.Schemas.Balance);
    })
  );

  /* Get token balance. */
  app.post(
    "/api/asset/balance",
    asyncMiddleware(async (req, res) => {
      // @ts-ignore
      const request = req as Paths.GetAssetBalanceInfo.RequestBody;
      const { asset, account } = request;
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
      // @ts-ignore
      const request = req as Paths.IssueAssets.RequestBody;
      const { asset, quantity, destination: { finId: issuerFinId }, executionContext } = request;

      const result = await tokenService.issue(
        assetFromAPI(asset),
        issuerFinId,
        quantity,
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptResultToAPI(result));
    })
  );

  /* POST transfer token. */
  app.post(
    "/api/assets/transfer",
    asyncMiddleware(async (req, res) => {
      // @ts-ignore
      const request = req as Paths.TransferAsset.RequestBody;
      const { nonce, source, destination, asset, quantity, signature, executionContext } = request;
      const result = await tokenService.transfer(
        nonce,
        sourceFromAPI(source),
        destinationFromAPI(destination),
        assetFromAPI(asset),
        quantity,
        signatureFromAPI(signature),
        executionContextFromAPI(executionContext!)
      );
      res.json(receiptResultToAPI(result));
    })
  );

  /* POST redeem token. */
  app.post(
    "/api/assets/redeem",
    asyncMiddleware(async (req, res) => {
      const receipt = await escrowService.releaseAndRedeem(req.body);
      res.json(receipt);
    })
  );

  app.get(
    "/api/assets/receipts/:id",
    asyncMiddleware(async (req, res) => {
      const { id } = req.params;
      const receipt = await tokenService.getReceipt(id);
      res.json(receipt);
    })
  );

  /* POST get deposit instruction. */
  app.post(
    "/api/payments/depositInstruction/",
    asyncMiddleware(async (req, res) => {
      const receipt = await paymentService.deposit(req.body);
      res.json(receipt);
    })
  );

  /* POST hold token. */
  app.post(
    "/api/assets/hold",
    asyncMiddleware(async (req, res) => {
      const receipt = await escrowService.hold(req.body);
      res.json(receipt);
    })
  );

  /* POST release token. */
  app.post(
    "/api/assets/release",
    asyncMiddleware(async (req, res) => {
      const receipt = await escrowService.releaseTo(req.body);
      res.json(receipt);
    })
  );

  /* POST rollback token. */
  app.post(
    "/api/assets/rollback",
    asyncMiddleware(async (req, res) => {
      const receipt = await escrowService.releaseBack(req.body);
      res.json(receipt);
    })
  );

  /* POST payout funds. */
  app.post(
    "/api/payments/payout",
    asyncMiddleware(async (req, res) => {
      const receipt = await paymentService.payout(req.body);
      res.json(receipt);
    })
  );

  /* POST operation status. */
  app.get(
    "/api/operations/status/:cid",
    asyncMiddleware(async (req, res) => {
      const status = await tokenService.operationStatus(req.params.cid);
      res.json(status);
    })
  );
};
