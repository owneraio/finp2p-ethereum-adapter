import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import {
  register,
  PluginManager,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl,
  AccountMappingServiceImpl,
  workflows,
  storage as storageModule,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import { createVanillaServices, registerDistributionRoutes } from "@owneraio/finp2p-vanilla-service";
import {
  CredentialsMappingService,
  EscrowServiceImpl,
  TokenServiceImpl,
} from "./services/finp2p-contract";
import {
  DirectTokenService,
  CustodyProvider,
  custodyRegistry,
  DerivationAccountMapping,
  DbAccountMapping,
  AccountMappingService,
  AccountMappingStore,
  AssetStore,
  OmnibusDelegate,
  CommonServiceImpl as DirectCommonServiceImpl,
  HealthServiceImpl as DirectHealthServiceImpl,
  tokenStandardRegistry,
  ERC20TokenStandard,
  ERC20_TOKEN_STANDARD,
  buildMappingConfig,
  createWalletResolver,
} from "./services/direct";
import { registerCustodyIntegrations, registerIntegrations } from "./integrations/registry";
import { AppConfig, FinP2PContractAppConfig, getNetworkRpcUrl } from "./config";

// Register compiled-in custody providers and built-in token standards
registerCustodyIntegrations();
tokenStandardRegistry.register(ERC20_TOKEN_STANDARD, new ERC20TokenStandard());

export interface WorkflowsConfig {
  migration: workflows.MigrationConfig;
  storage: { connectionString: string };
  finP2PClient?: FinP2PClient;
}

function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  dbConnectionString: string | undefined, finP2PClient: FinP2PClient | undefined,
  accountMappingStore: AccountMappingStore | undefined,
  assetStore: AssetStore | undefined,
) {
  const healthService = new DirectHealthServiceImpl(custodyProvider.rpcProvider);
  const mappingConfig = buildMappingConfig(custodyProvider);
  const accountMapping: AccountMappingService = appConfig.accountMappingType === 'database' && accountMappingStore
    ? new DbAccountMapping(accountMappingStore)
    : new DerivationAccountMapping();

  if (appConfig.accountModel === 'omnibus') {
    if (!dbConnectionString || !assetStore) throw new Error('DB connection is required for omnibus account model');
    const delegate = new OmnibusDelegate(logger, custodyProvider, accountMapping, assetStore);
    const { tokenService, escrowService, commonService, mappingService, distributionService, inboundTransferHook } = createVanillaServices(
      { transfer: delegate, asset: delegate, escrow: delegate, omnibus: delegate },
      { connectionString: dbConnectionString },
      logger,
    );
    const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient, inboundTransferHook);
    register(app, tokenService, escrowService, commonService, commonService, delegate, planApprovalService, pluginManager, dbConnectionString, finP2PClient, mappingConfig, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    return;
  }

  if (!assetStore || !dbConnectionString || !accountMappingStore) throw new Error('DB connection is required for direct mode');
  const tokenService = new DirectTokenService(logger, custodyProvider, accountMapping, assetStore);
  const workflowStorage = new workflows.WorkflowStorage(dbConnectionString);
  const commonService = new DirectCommonServiceImpl(workflowStorage);
  const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient);
  const mappingService = new AccountMappingServiceImpl(accountMappingStore);
  register(app, tokenService, tokenService, commonService, healthService, paymentsService, planApprovalService, pluginManager, dbConnectionString, finP2PClient, mappingConfig, mappingService);
}

function registerFinP2PContractServices(
  app: express.Application, contractConfig: FinP2PContractAppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  dbConnectionString: string | undefined, finP2PClient: FinP2PClient | undefined,
) {
  if (contractConfig.accountModel === 'omnibus') {
    throw new Error('Omnibus account model is not supported with finp2p-contract provider');
  }
  const planApprovalService = new PlanApprovalServiceImpl(contractConfig.orgId, pluginManager, contractConfig.finP2PClient);
  const escrowService = new EscrowServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
  const tokenService = new TokenServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
  const mappingService = new CredentialsMappingService(contractConfig.finP2PContract);
  const mappingConfig = buildMappingConfig();
  register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, dbConnectionString, finP2PClient, mappingConfig, mappingService);
}

async function createApp(
  workflowsConfig: WorkflowsConfig | undefined,
  logger: winston.Logger,
  appConfig: AppConfig,
  dbConnectionString?: string,
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

  // Run database migrations if configured
  if (workflowsConfig?.migration) {
    await workflows.migrateIfNeeded(workflowsConfig.migration);
  }

  const pluginManager = new PluginManager();
  const finP2PClient = workflowsConfig?.finP2PClient;

  // Shared data stores — decoupled from workflow storage
  const { Pool } = require('pg');
  const dbPool = dbConnectionString ? new Pool({ connectionString: dbConnectionString }) : undefined;
  const accountMappingStore = dbPool ? new storageModule.PgAccountStore(dbPool) : undefined;
  const assetStore = dbPool ? new storageModule.PgAssetStore(dbPool) : undefined;

  let custodyProvider: CustodyProvider | undefined;
  if (custodyRegistry.has(appConfig.type)) {
    logger.info(`Activating custody provider: ${appConfig.type} (available: ${custodyRegistry.availableProviders.join(', ')})`);
    custodyProvider = await custodyRegistry.create(appConfig.type, appConfig);
  }

  registerIntegrations({
    orgId: appConfig.orgId,
    logger,
    pluginManager,
    finP2PClient: finP2PClient!,
    walletResolver: custodyProvider && accountMappingStore ? createWalletResolver(accountMappingStore, custodyProvider) : undefined,
    rpcUrl: process.env.NETWORK_HOST ? getNetworkRpcUrl() : undefined,
  });

  const paymentsService = new PaymentsServiceImpl(pluginManager);

  if (custodyProvider) {
    registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, pluginManager, dbConnectionString, finP2PClient, accountMappingStore, assetStore);
  } else if (appConfig.type === 'finp2p-contract') {
    registerFinP2PContractServices(app, appConfig as FinP2PContractAppConfig, paymentsService, pluginManager, dbConnectionString, finP2PClient);
  } else {
    throw new Error(`Unknown provider type: '${appConfig.type}'. Available custody providers: ${custodyRegistry.availableProviders.join(', ')}`);
  }

  return app;
}

export default createApp;
