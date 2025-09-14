import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import { register, PolicyGetter } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  AssetCreationPolicy,
  EscrowServiceImpl,
  ExecDetailsStore,
  PaymentsServiceImpl,
  PlanApprovalServiceImpl,
  TokenServiceImpl
} from "./services";
import { FinP2PContract } from "../finp2p-contracts/src";

function createApp(finP2PContract: FinP2PContract,
                   assetCreationPolicy: AssetCreationPolicy,
                   policyGetter: PolicyGetter | undefined,
                   execDetailsStore: ExecDetailsStore | undefined,
                   defaultDecimals: number,
                   logger: winston.Logger) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(expressLogger({
    winstonInstance: logger,
    meta: true,
    expressFormat: true,
    statusLevels: true,
    ignoreRoute: (req) => req.url.toLowerCase() === "/health/readiness" || req.url.toLowerCase() === "/health/liveness"
  }));

  const tokenService = new TokenServiceImpl(finP2PContract, assetCreationPolicy, policyGetter, execDetailsStore, defaultDecimals);
  const escrowService = new EscrowServiceImpl(finP2PContract, policyGetter, execDetailsStore, defaultDecimals);
  const paymentsService = new PaymentsServiceImpl(finP2PContract, policyGetter, execDetailsStore, defaultDecimals);
  const planApprovalService = new PlanApprovalServiceImpl();
  register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService);

  return app;
}

export default createApp;
