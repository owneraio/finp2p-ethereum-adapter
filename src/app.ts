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
} from "./services/finp2p-contract";
import { AppConfig } from './config'
import {
  DirectTokenService,
  FireblocksCustodyProvider,
  DfnsCustodyProvider,
  CustodyProvider,
  DerivationAccountMapping,
  DbAccountMapping,
  AccountMappingService,
  CommonServiceImpl as DirectCommonServiceImpl,
  HealthServiceImpl as DirectHealthServiceImpl,
} from "./services/direct"

function resolveAccountMapping(appConfig: AppConfig, custodyProvider: CustodyProvider): AccountMappingService {
  switch (appConfig.accountMappingType) {
    case 'database':
      return new DbAccountMapping();
    case 'custody-provider':
      if (!custodyProvider.accountMapping) {
        throw new Error('custody-provider account mapping is not supported by the current provider');
      }
      return custodyProvider.accountMapping;
    case 'derivation':
    default:
      return new DerivationAccountMapping();
  }
}

function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, planApprovalService: PlanApprovalServiceImpl,
  pluginManager: PluginManager, workflowsConfig: workflows.Config | undefined,
) {
  const accountMapping = resolveAccountMapping(appConfig, custodyProvider);
  const tokenService = new DirectTokenService(logger, custodyProvider, accountMapping);
  const commonService = new DirectCommonServiceImpl();
  const healthService = new DirectHealthServiceImpl(custodyProvider.healthCheckProvider);

  register(app, tokenService, tokenService, commonService, healthService, paymentsService, planApprovalService, pluginManager, workflowsConfig, {
    fields: [{ field: 'ledgerAccountId', description: 'Ethereum address', exampleValue: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18' }],
  });
}

async function createApp(
  workflowsConfig: workflows.Config | undefined,
  logger: winston.Logger,
  appConfig: AppConfig,
): Promise<express.Application> {
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
  const paymentsService = new PaymentsServiceImpl(pluginManager);
  const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, appConfig.finP2PClient);

  switch (appConfig.type) {
    case 'fireblocks': {
      const custodyProvider = await FireblocksCustodyProvider.create(appConfig);
      registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, planApprovalService, pluginManager, workflowsConfig);
      break
    }
    case 'dfns': {
      const custodyProvider = await DfnsCustodyProvider.create(appConfig);
      registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, planApprovalService, pluginManager, workflowsConfig);
      break
    }
    case 'finp2p-contract': {
      const escrowService = new EscrowServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      const tokenService = new TokenServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, workflowsConfig, {
        fields: [{ field: 'ledgerAccountId', description: 'Ethereum address', exampleValue: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18' }],
      });
      break
    }
  }

  return app;
}

export default createApp;
