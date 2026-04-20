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
import { LedgerStorage, VanillaServiceImpl, registerDistributionRoutes } from "@owneraio/finp2p-vanilla-service";
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
  finP2PClient?: FinP2PClient;
}

function wrapWithWorkflowProxy<T extends object>(
  service: T, workflowStorage: InstanceType<typeof workflows.WorkflowStorage> | undefined,
  finP2PClient: FinP2PClient | undefined, ...methods: (keyof T)[]
): T {
  if (!workflowStorage) return service;
  return workflows.createServiceProxy(() => Promise.resolve(), workflowStorage, finP2PClient, service, ...methods);
}

function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  dbPool: any, finP2PClient: FinP2PClient | undefined,
  accountMappingStore: AccountMappingStore | undefined,
  assetStore: AssetStore | undefined,
  ledgerSchema: string | undefined,
) {
  const healthService = new DirectHealthServiceImpl(custodyProvider.rpcProvider);
  const mappingConfig = buildMappingConfig(custodyProvider);
  // Skeleton 0.28.11+: caseSensitive=false makes the service lowercase
  // FIELD_LEDGER_ACCOUNT_ID values on save and lookup, so EIP-55 checksummed
  // and lowercase EVM addresses resolve to the same record.
  const accountMappingService = accountMappingStore
    ? new AccountMappingServiceImpl(accountMappingStore, { caseSensitive: false })
    : undefined;
  const accountMapping: AccountMappingService = appConfig.accountMappingType === 'database' && accountMappingService
    ? new DbAccountMapping(accountMappingService)
    : new DerivationAccountMapping();
  const workflowStorage = dbPool ? new workflows.WorkflowStorage(dbPool, ledgerSchema) : undefined;

  if (appConfig.accountModel === 'omnibus') {
    if (!dbPool || !assetStore) throw new Error('DB connection is required for omnibus account model');
    const delegate = new OmnibusDelegate(logger, custodyProvider, accountMapping, assetStore);
    // vanilla 0.28.2's createVanillaServices doesn't forward schemaName to its
    // LedgerStorage, so its account_mappings/accounts/transactions queries hit
    // the default `ledger_adapter` schema even when migrations placed those
    // tables in `ethereum_adapter`. Build the storage + service ourselves to
    // pin the schema. (LedgerStorage + VanillaServiceImpl are public exports.)
    const ledgerStorage = new LedgerStorage(dbPool, ledgerSchema);
    const vanillaService = new VanillaServiceImpl(ledgerStorage, delegate, delegate, delegate, delegate, finP2PClient);
    const tokenService = vanillaService;
    const escrowService = vanillaService;
    const commonService = vanillaService;
    const mappingService = vanillaService;
    const distributionService = vanillaService;
    const inboundTransferHook = vanillaService;
    const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient, inboundTransferHook);
    const proxiedPlanService = wrapWithWorkflowProxy(planApprovalService, workflowStorage, finP2PClient, 'approvePlan', 'proposeCancelPlan', 'proposeResetPlan', 'proposeInstructionApproval');
    const proxiedTokenService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'createAsset', 'issue', 'transfer', 'redeem');
    const proxiedEscrowService = wrapWithWorkflowProxy(escrowService, workflowStorage, finP2PClient, 'hold', 'release', 'rollback');
    const proxiedPaymentService = wrapWithWorkflowProxy(delegate, workflowStorage, finP2PClient, 'getDepositInstruction', 'payout');
    register(app, proxiedTokenService, proxiedEscrowService, commonService, commonService, proxiedPaymentService, proxiedPlanService, mappingConfig, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    return;
  }

  if (!assetStore || !dbPool || !accountMappingStore || !accountMappingService) throw new Error('DB connection is required for direct mode');
  let tokenService: DirectTokenService = new DirectTokenService(logger, custodyProvider, accountMapping, assetStore);
  const commonService = new DirectCommonServiceImpl(workflowStorage!);
  let planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient);

  const proxiedTokenService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'createAsset', 'issue', 'transfer', 'redeem');
  const proxiedEscrowService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'hold', 'release', 'rollback');
  const proxiedPlanService = wrapWithWorkflowProxy(planApprovalService, workflowStorage, finP2PClient, 'approvePlan', 'proposeCancelPlan', 'proposeResetPlan', 'proposeInstructionApproval');
  const proxiedPaymentsService = wrapWithWorkflowProxy(paymentsService, workflowStorage, finP2PClient, 'getDepositInstruction', 'payout');
  register(app, proxiedTokenService, proxiedEscrowService, commonService, healthService, proxiedPaymentsService, proxiedPlanService, mappingConfig, accountMappingService);
}

function registerFinP2PContractServices(
  app: express.Application, contractConfig: FinP2PContractAppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  dbPool: any, finP2PClient: FinP2PClient | undefined,
  ledgerSchema: string | undefined,
) {
  if (contractConfig.accountModel === 'omnibus') {
    throw new Error('Omnibus account model is not supported with finp2p-contract provider');
  }
  const workflowStorage = dbPool ? new workflows.WorkflowStorage(dbPool, ledgerSchema) : undefined;
  let planApprovalService = new PlanApprovalServiceImpl(contractConfig.orgId, pluginManager, contractConfig.finP2PClient);
  const escrowService = new EscrowServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
  const tokenService = new TokenServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
  const mappingService = new CredentialsMappingService(contractConfig.finP2PContract);
  const mappingConfig = buildMappingConfig();

  const commonService = workflowStorage ? new DirectCommonServiceImpl(workflowStorage) : tokenService as any;

  const proxiedTokenService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'createAsset', 'issue', 'transfer', 'redeem');
  const proxiedEscrowService = wrapWithWorkflowProxy(escrowService, workflowStorage, finP2PClient, 'hold', 'release', 'rollback');
  const proxiedPlanService = wrapWithWorkflowProxy(planApprovalService, workflowStorage, finP2PClient, 'approvePlan', 'proposeCancelPlan', 'proposeResetPlan', 'proposeInstructionApproval');
  register(app, proxiedTokenService, proxiedEscrowService, commonService, tokenService, paymentsService, proxiedPlanService, mappingConfig, mappingService);
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

  // Postgres schema for skeleton tables — must match what migration created.
  // Read from migration config (preferred) or fall back to LEDGER_SCHEMA env var.
  const ledgerSchema = workflowsConfig?.migration?.schemaName || process.env.LEDGER_SCHEMA || undefined;

  // Shared data stores — decoupled from workflow storage
  const { Pool } = require('pg');
  const dbPool = dbConnectionString ? new Pool({ connectionString: dbConnectionString }) : undefined;
  dbPool?.on('error', () => {}); // Suppress pool errors during shutdown
  const accountMappingStore = dbPool ? new storageModule.PgAccountStore(dbPool, ledgerSchema) : undefined;
  const assetStore = dbPool ? new storageModule.PgAssetStore(dbPool, ledgerSchema) : undefined;

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
    assetStore,
    accountModel: appConfig.accountModel,
    custodyProvider,
    inboundTransferHook: undefined, // populated in omnibus path via createVanillaServices — see registerDirectServices
  });

  const paymentsService = new PaymentsServiceImpl(pluginManager);

  if (custodyProvider) {
    registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, pluginManager, dbPool, finP2PClient, accountMappingStore, assetStore, ledgerSchema);
  } else if (appConfig.type === 'finp2p-contract') {
    registerFinP2PContractServices(app, appConfig as FinP2PContractAppConfig, paymentsService, pluginManager, dbPool, finP2PClient, ledgerSchema);
  } else {
    throw new Error(`Unknown provider type: '${appConfig.type}'. Available custody providers: ${custodyRegistry.availableProviders.join(', ')}`);
  }

  return app;
}

export default createApp;
