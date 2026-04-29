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
  finP2PClient?: FinP2PClient;
}

function wrapWithWorkflowProxy<T extends object>(
  service: T, workflowStorage: InstanceType<typeof workflows.WorkflowStorage> | undefined,
  finP2PClient: FinP2PClient | undefined, ...methods: (keyof T)[]
): T {
  if (!workflowStorage) return service;
  return workflows.createServiceProxy(() => Promise.resolve(), workflowStorage, finP2PClient, service, ...methods);
}

/**
 * Pre-built omnibus services. Created in createApp BEFORE registerIntegrations so the
 * inboundTransferHook can be threaded into the deposit plugins at construction time —
 * otherwise the plugins capture undefined and successful omnibus deposits silently fall
 * back to importTransactions only, never crediting the adapter's own omnibus ledger.
 */
interface OmnibusContext {
  delegate: OmnibusDelegate;
  vanilla: ReturnType<typeof createVanillaServices>;
}

function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  dbPool: any, finP2PClient: FinP2PClient | undefined,
  accountMappingStore: AccountMappingStore | undefined,
  assetStore: AssetStore | undefined,
  accountMapping: AccountMappingService,
  omnibusCtx: OmnibusContext | undefined,
) {
  const healthService = new DirectHealthServiceImpl(custodyProvider.rpcProvider);
  const mappingConfig = buildMappingConfig(custodyProvider);
  const workflowStorage = dbPool ? new workflows.WorkflowStorage(dbPool) : undefined;

  if (appConfig.accountModel === 'omnibus') {
    if (!omnibusCtx) throw new Error('Omnibus context not built — createVanillaServices must run before registerDirectServices');
    const { delegate, vanilla } = omnibusCtx;
    const { tokenService, escrowService, commonService, mappingService, distributionService, inboundTransferHook } = vanilla;
    const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient, inboundTransferHook);
    const proxiedPlanService = wrapWithWorkflowProxy(planApprovalService, workflowStorage, finP2PClient, 'approvePlan', 'proposeCancelPlan', 'proposeResetPlan', 'proposeInstructionApproval');
    const proxiedTokenService = wrapWithWorkflowProxy(tokenService, workflowStorage, finP2PClient, 'createAsset', 'issue', 'transfer', 'redeem');
    const proxiedEscrowService = wrapWithWorkflowProxy(escrowService, workflowStorage, finP2PClient, 'hold', 'release', 'rollback');
    // When a PaymentsPlugin is registered (e.g. ota-deposit / pull-deposit), route deposits
    // through it so per-deposit ephemeral addresses, approval-watchers, and FinAPI receipt
    // export run. Otherwise fall back to the omnibus delegate's barebones "deposit to omnibus"
    // instruction, which has no plugin awareness.
    const paymentImpl = pluginManager.getPaymentsPlugin() !== null ? paymentsService : delegate;
    const proxiedPaymentService = wrapWithWorkflowProxy(paymentImpl, workflowStorage, finP2PClient, 'getDepositInstruction', 'payout');
    // vanilla-service's commonService.operationStatus unconditionally throws — async ops
    // persisted by the workflow proxy would be unreachable via /operations/status. Use the
    // workflow-storage-backed DirectCommonServiceImpl for that route, keep vanilla
    // commonService for liveness/readiness.
    const directCommonService = workflowStorage ? new DirectCommonServiceImpl(workflowStorage) : commonService;
    register(app, proxiedTokenService, proxiedEscrowService, directCommonService, commonService, proxiedPaymentService, proxiedPlanService, mappingConfig, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    return;
  }

  if (!assetStore || !dbPool || !accountMappingStore) throw new Error('DB connection is required for direct mode');
  let tokenService: DirectTokenService = new DirectTokenService(logger, custodyProvider, accountMapping, assetStore);
  const commonService = new DirectCommonServiceImpl(workflowStorage!);
  let planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, finP2PClient);
  const accountMappingService = new AccountMappingServiceImpl(accountMappingStore);

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
) {
  if (contractConfig.accountModel === 'omnibus') {
    throw new Error('Omnibus account model is not supported with finp2p-contract provider');
  }
  const workflowStorage = dbPool ? new workflows.WorkflowStorage(dbPool) : undefined;
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

  // Shared data stores — decoupled from workflow storage
  const { Pool } = require('pg');
  const dbPool = dbConnectionString ? new Pool({ connectionString: dbConnectionString }) : undefined;
  dbPool?.on('error', () => {}); // Suppress pool errors during shutdown
  const accountMappingStore = dbPool ? new storageModule.PgAccountStore(dbPool) : undefined;
  const assetStore = dbPool ? new storageModule.PgAssetStore(dbPool) : undefined;

  let custodyProvider: CustodyProvider | undefined;
  if (custodyRegistry.has(appConfig.type)) {
    logger.info(`Activating custody provider: ${appConfig.type} (available: ${custodyRegistry.availableProviders.join(', ')})`);
    custodyProvider = await custodyRegistry.create(appConfig.type, appConfig);
  }

  // Pre-build accountMapping + (in omnibus mode) the OmnibusDelegate and vanilla services
  // BEFORE plugin registration. Deposit plugins capture inboundTransferHook in their
  // constructors; if it's undefined at registration time they fall back to
  // finP2PClient.importTransactions only, skipping the vanilla hook's storage.credit(...)
  // and leaving the adapter's omnibus balance state stale.
  const accountMapping: AccountMappingService = appConfig.accountMappingType === 'database' && accountMappingStore
    ? new DbAccountMapping(accountMappingStore)
    : new DerivationAccountMapping();

  let omnibusCtx: OmnibusContext | undefined;
  if (appConfig.accountModel === 'omnibus' && custodyProvider) {
    if (!dbPool || !assetStore) throw new Error('DB connection is required for omnibus account model');
    const delegate = new OmnibusDelegate(logger, custodyProvider, accountMapping, assetStore);
    const vanilla = createVanillaServices(
      { transfer: delegate, asset: delegate, escrow: delegate, omnibus: delegate },
      { connectionString: dbPool.options?.connectionString ?? '' },
      logger,
    );
    omnibusCtx = { delegate, vanilla };
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
    inboundTransferHook: omnibusCtx?.vanilla.inboundTransferHook,
  });

  const paymentsService = new PaymentsServiceImpl(pluginManager);

  if (custodyProvider) {
    registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, pluginManager, dbPool, finP2PClient, accountMappingStore, assetStore, accountMapping, omnibusCtx);
  } else if (appConfig.type === 'finp2p-contract') {
    registerFinP2PContractServices(app, appConfig as FinP2PContractAppConfig, paymentsService, pluginManager, dbPool, finP2PClient);
  } else {
    throw new Error(`Unknown provider type: '${appConfig.type}'. Available custody providers: ${custodyRegistry.availableProviders.join(', ')}`);
  }

  return app;
}

export default createApp;
