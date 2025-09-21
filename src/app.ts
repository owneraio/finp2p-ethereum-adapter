import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import { register, ProofProvider } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import {
  EscrowServiceImpl,
  ExecDetailsStore,
  PaymentsServiceImpl,
  TokenServiceImpl
} from "./services";
import { FinP2PContract } from "../finp2p-contracts";
import { PlanApprovalServiceImpl } from "./services";

function createApp(finP2PContract: FinP2PContract,
                   finP2PClient: FinP2PClient | undefined,
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

  const signerPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
  const proofProvider = new ProofProvider(finP2PClient, signerPrivateKey)
  const tokenService = new TokenServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider, defaultDecimals);
  const escrowService = new EscrowServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider, defaultDecimals);
  const paymentsService = new PaymentsServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider, defaultDecimals);
  const planApprovalService = new PlanApprovalServiceImpl(finP2PClient);
  register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService);

  return app;
}

export default createApp;
