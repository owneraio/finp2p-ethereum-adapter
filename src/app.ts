import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import * as routes from "./routes";
import { AssetCreationPolicy, TokenService } from "./services/tokens";
import { EscrowService } from "./services/escrow";
import { PaymentsService } from "./services/payments";
import { PlanService } from "./services/plans";
import { FinP2PContract } from "../finp2p-contracts/src/contracts/finp2p";
import { PolicyGetter } from "./finp2p/policy";
import { ExecDetailsStore } from "./services/common";
import { FinAPIClient } from "./finp2p/finapi/finapi.client";
import { FinP2PCollateralAssetFactoryContract } from "../finp2p-contracts/src/contracts/collateral";
import { OssClient } from "./finp2p/oss.client";


function createApp(finP2PContract: FinP2PContract,
                   collateralAssetFactoryContract: FinP2PCollateralAssetFactoryContract,
                   assetCreationPolicy: AssetCreationPolicy,
                   ossClient: OssClient | undefined,
                   policyGetter: PolicyGetter | undefined,
                   finApiClient: FinAPIClient | undefined,
                   execDetailsStore: ExecDetailsStore | undefined,
                   logger: winston.Logger
) {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(expressLogger({
    winstonInstance: logger,
    meta: true,
    expressFormat: true,
    statusLevels: true,
    ignoreRoute: (req) => req.url.toLowerCase() === "/readiness" || req.url.toLowerCase() === "/liveness"
  }));

  routes.register(app,
    new TokenService(finP2PContract, assetCreationPolicy, policyGetter, finApiClient, execDetailsStore),
    new EscrowService(finP2PContract, policyGetter, finApiClient, execDetailsStore),
    new PaymentsService(finP2PContract, collateralAssetFactoryContract, ossClient, finApiClient, policyGetter, execDetailsStore, ),
    new PlanService());

  return app;
}

export default createApp;