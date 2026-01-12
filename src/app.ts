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
} from "./services";
import { TokenServiceImpl as TokenServiceFireblocksImpl } from "./services/fireblocks"

function createApp(orgId: string, finP2PContract: FinP2PContract,
                   finP2PClient: FinP2PClient | undefined,
                   execDetailsStore: ExecDetailsStore | undefined,
                   workflowsConfig: workflows.Config | undefined,
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


  const pluginManager = new PluginManager();

  const signerPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
  const proofProvider = new ProofProvider(orgId, finP2PClient, signerPrivateKey);
  const tokenService = new TokenServiceFireblocksImpl(finP2PContract.provider, finP2PContract.signer, logger)
  const escrowService = new EscrowServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider, pluginManager);
  const paymentsService = new PaymentsServiceImpl(pluginManager);
  const planApprovalService = new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);
  register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, workflowsConfig);

  return app;
}

export default createApp;
