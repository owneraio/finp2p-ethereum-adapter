import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import {
  register,
  PluginManager,
  ProofProvider,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  CollateralDepositPlugin,
  CollateralPlanApprovalPlugin,
  CollateralTransactionHook
} from "@owneraio/finp2p-ethereum-dtcc-plugin";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import {
  EscrowServiceImpl,
  ExecDetailsStore,
  TokenServiceImpl
} from "./services";

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

  // ---------------------------------------------------------
  // TODO: move to dynamic plugin loading
  if (finP2PClient) {
    const depositPlugin = new CollateralDepositPlugin(orgId, finP2PContract, finP2PClient, logger);
    pluginManager.registerPaymentsPlugin({ isAsync: true, asyncIface: depositPlugin });

    // doing collateral asset validation + erc20 approving of the borrower
    const approvalPlugin = new CollateralPlanApprovalPlugin(orgId, finP2PContract, finP2PClient, logger);
    pluginManager.registerPlanApprovalPlugin({ isAsync: true, asyncIface: approvalPlugin });

    // using this hook trick because of the borrower should initialize the collateral agreement
    const transactionHook = new CollateralTransactionHook(finP2PContract, finP2PClient, logger);
    pluginManager.registerTransactionHook(transactionHook);
  }

  // ---------------------------------------------------------

  const signerPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
  const proofProvider = new ProofProvider(orgId, finP2PClient, signerPrivateKey);
  const tokenService = new TokenServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider, pluginManager);
  const escrowService = new EscrowServiceImpl(finP2PContract, finP2PClient, execDetailsStore, proofProvider, pluginManager);
  const paymentsService = new PaymentsServiceImpl(pluginManager);
  const planApprovalService = new PlanApprovalServiceImpl(orgId, pluginManager, finP2PClient);
  register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager);

  return app;
}

export default createApp;
