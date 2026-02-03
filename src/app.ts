import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import {
  register,
  PluginManager,
  ProofProvider,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl,
  workflows
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import {
  EscrowServiceImpl,
  ExecDetailsStore,
  TokenServiceImpl
} from "./services";
import { AppConfig } from './config'
import {
  CommonServiceImpl as CommonServiceFireblocksImpl,
  HealthServiceImpl as HealthServiceFireblocksImpl,
  PaymentsServiceImpl as PaymentsServiceFireblocksImpl,
  PlanApprovalServiceImpl as PlanApprovalServiceFireblocksImpl,
  TokenServiceImpl as TokenServiceFireblocksImpl,
} from "./services/fireblocks"

function createApp(
  workflowsConfig: workflows.Config | undefined,
  logger: winston.Logger,
  appConfig: AppConfig,
): express.Application {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(expressLogger({
    winstonInstance: logger,
    meta: true,
    expressFormat: true,
    statusLevels: true,
    ignoreRoute: (req) => req.url.toLowerCase() === "/health/readiness" || req.url.toLowerCase() === "/health/liveness"
  }));

  switch (appConfig.type) {
    case 'fireblocks': {
      const commonService = new CommonServiceFireblocksImpl()
      const escrowService = new TokenServiceFireblocksImpl(logger, appConfig)
      const healthService = new HealthServiceFireblocksImpl(appConfig.assetEscrow.provider)
      const paymentsService = new PaymentsServiceFireblocksImpl()
      const planApprovalService = new PlanApprovalServiceFireblocksImpl()
      const tokenService = new TokenServiceFireblocksImpl(logger, appConfig)

      register(app, tokenService, escrowService, commonService, healthService, paymentsService, planApprovalService, undefined, workflowsConfig)
      break
    }
    case 'local': {
      const pluginManager = new PluginManager();

      const escrowService = new EscrowServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      const paymentsService = new PaymentsServiceImpl(pluginManager);
      const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, appConfig.finP2PClient);
      const tokenService = new TokenServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, workflowsConfig);
      break
    }
  }

  return app;
}

export default createApp;
