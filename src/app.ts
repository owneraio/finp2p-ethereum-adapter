import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import { register, ProofProvider, PlanApprovalServiceImpl } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  EscrowServiceImpl,
  ExecDetailsStore,
  PaymentsServiceImpl,
  TokenServiceImpl,
} from "./services";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import { PluginManager } from "@owneraio/finp2p-nodejs-skeleton-adapter/dist/lib/plugins/manager";

function createApp(orgId: string, finP2PContract: FinP2PContract,
                   finP2PClient: FinP2PClient | undefined,
                   execDetailsStore: ExecDetailsStore | undefined,
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
  const proofProvider = new ProofProvider(orgId, finP2PClient, signerPrivateKey)
  const tokenService = new TokenServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider);
  const escrowService = new EscrowServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider);
  const paymentsService = new PaymentsServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider);
  const planApprovalService = new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);
  register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager);

  return app;
}

export default createApp;
