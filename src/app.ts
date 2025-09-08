import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import * as routes from "./routes";
import { AssetCreationPolicy, TokenServiceImpl } from "./services/impl/tokens";
import { EscrowServiceImpl } from "./services/impl/escrow";
import { PaymentsServiceImpl } from "./services/impl/payments";
import { PlanApprovalServiceImpl } from "./services/impl/plans";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { PolicyGetter } from "./finp2p/policy";
import { ExecDetailsStore } from "./services/impl/common";


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

  routes.register(app,
    new TokenServiceImpl(finP2PContract, assetCreationPolicy, policyGetter, execDetailsStore, defaultDecimals),
    new EscrowServiceImpl(finP2PContract, policyGetter, execDetailsStore, defaultDecimals),
    new PaymentsServiceImpl(finP2PContract, policyGetter, execDetailsStore, defaultDecimals),
    new PlanApprovalServiceImpl());

  return app;
}

export default createApp;
