import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import {
  register,
  PluginManager,
  ProofProvider,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl,
  workflows,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { createVanillaServices, LedgerStorage, registerDistributionRoutes } from "@owneraio/finp2p-vanilla-service";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { FinP2PContract } from "@owneraio/finp2p-contracts";
import { Pool } from "pg";
import {
  CredentialsMappingService,
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
import {
  OmnibusDelegate,
  OmnibusInboundMonitor,
  OmnibusInboundStore,
  OmnibusPaymentService,
} from "./services/omnibus"

function resolveAccountMapping(appConfig: AppConfig): AccountMappingService {
  switch (appConfig.accountMappingType) {
    case 'database':
      return new DbAccountMapping();
    case 'derivation':
    default:
      return new DerivationAccountMapping();
  }
}

function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager, workflowsConfig: workflows.Config | undefined,
) {
  const healthService = new DirectHealthServiceImpl(custodyProvider.rpcProvider);

  if (appConfig.accountModel === 'omnibus') {
    if (!workflowsConfig?.storage) throw new Error('Workflows storage config is required for omnibus account model');
    const accountMapping = resolveAccountMapping(appConfig);
    const delegate = new OmnibusDelegate(logger, custodyProvider, accountMapping);
    const pool = new Pool({ connectionString: workflowsConfig.storage.connectionString });
    const inboundStore = new OmnibusInboundStore(pool);
    const ledgerStorage = new LedgerStorage(pool);
    const paymentService = new OmnibusPaymentService(logger, custodyProvider, inboundStore, {
      intentTtlMs: Number(process.env.OMNIBUS_DEPOSIT_INTENT_TTL_MS ?? 24 * 60 * 60 * 1000),
    });
    const inboundMonitor = new OmnibusInboundMonitor(logger, custodyProvider, inboundStore, ledgerStorage, delegate, {
      intervalMs: Number(process.env.OMNIBUS_INBOUND_MONITOR_INTERVAL_MS ?? 30_000),
      confirmations: Number(process.env.OMNIBUS_INBOUND_CONFIRMATIONS ?? 2),
      initialLookbackBlocks: Number(process.env.OMNIBUS_INBOUND_LOOKBACK_BLOCKS ?? 5_000),
    });
    const { tokenService, escrowService, commonService, mappingService, distributionService, inboundTransferHook } = createVanillaServices(
      { transfer: delegate, asset: delegate, escrow: delegate, omnibus: delegate },
      workflowsConfig.storage,
      logger,
    );
    // TODO(omnibus-inbound): use deterministic inbound idempotency key `${planId}:${instructionSequence}`
    // instead of request-scoped idempotency key to prevent duplicate credits on retried proposal callbacks.
    const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, appConfig.finP2PClient, inboundTransferHook);
    register(app, tokenService, escrowService, commonService, commonService, paymentService, planApprovalService, pluginManager, workflowsConfig, {
      fields: [{ field: 'ledgerAccountId', description: 'Ethereum address', exampleValue: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18' }],
    }, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    inboundMonitor.start();
    return;
  }

  const accountMapping = resolveAccountMapping(appConfig);
  const tokenService = new DirectTokenService(logger, custodyProvider, accountMapping);
  const commonService = new DirectCommonServiceImpl();
  const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, appConfig.finP2PClient);
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

  switch (appConfig.type) {
    case 'fireblocks': {
      const custodyProvider = await FireblocksCustodyProvider.create(appConfig);
      registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, pluginManager, workflowsConfig);
      break
    }
    case 'dfns': {
      const custodyProvider = await DfnsCustodyProvider.create(appConfig);
      registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, pluginManager, workflowsConfig);
      break
    }
    case 'finp2p-contract': {
      if (appConfig.accountModel === 'omnibus') {
        throw new Error('Omnibus account model is not supported with finp2p-contract provider');
      }
      const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, appConfig.finP2PClient);
      const escrowService = new EscrowServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      const tokenService = new TokenServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      const mappingService = new CredentialsMappingService(appConfig.finP2PContract);
      register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, workflowsConfig, {
        fields: [{ field: 'ledgerAccountId', description: 'Ethereum address', exampleValue: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18' }],
      }, mappingService);
      break
    }
  }

  return app;
}

export default createApp;
