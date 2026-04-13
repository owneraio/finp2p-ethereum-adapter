import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import {
  register,
  PluginManager,
  PlanApprovalServiceImpl,
  PaymentsServiceImpl,
  workflows,
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
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

function registerDirectServices(
  app: express.Application, logger: winston.Logger, custodyProvider: CustodyProvider, appConfig: AppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager, workflowsConfig: workflows.Config | undefined,
) {
  const healthService = new DirectHealthServiceImpl(custodyProvider.rpcProvider);
  const mappingConfig = buildMappingConfig(custodyProvider);
  const accountMapping: AccountMappingService = appConfig.accountMappingType === 'database'
    ? new DbAccountMapping()
    : new DerivationAccountMapping();

  if (appConfig.accountModel === 'omnibus') {
    if (!workflowsConfig?.storage) throw new Error('Workflows storage config is required for omnibus account model');
    const delegate = new OmnibusDelegate(logger, custodyProvider, accountMapping);
    const { tokenService, escrowService, commonService, mappingService, distributionService, inboundTransferHook } = createVanillaServices(
      { transfer: delegate, asset: delegate, escrow: delegate, omnibus: delegate },
      workflowsConfig.storage,
      logger,
    );
    // TODO(omnibus-inbound): use deterministic inbound idempotency key `${planId}:${instructionSequence}`
    // instead of request-scoped idempotency key to prevent duplicate credits on retried proposal callbacks.
    const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, workflowsConfig?.finP2PClient, inboundTransferHook);
    register(app, tokenService, escrowService, commonService, commonService, delegate, planApprovalService, pluginManager, workflowsConfig, mappingConfig, mappingService);
    if (distributionService) {
      registerDistributionRoutes(app, distributionService);
    }
    return;
  }

  const dbMapping = accountMapping instanceof DbAccountMapping ? accountMapping : undefined;
  const tokenService = new DirectTokenService(logger, custodyProvider, accountMapping);
  const commonService = new DirectCommonServiceImpl();
  const planApprovalService = new PlanApprovalServiceImpl(appConfig.orgId, pluginManager, workflowsConfig?.finP2PClient);
  register(app, tokenService, tokenService, commonService, healthService, paymentsService, planApprovalService, pluginManager, workflowsConfig, mappingConfig, dbMapping);
}

function registerFinP2PContractServices(
  app: express.Application, contractConfig: FinP2PContractAppConfig,
  paymentsService: PaymentsServiceImpl, pluginManager: PluginManager,
  workflowsConfig: workflows.Config | undefined,
) {
  if (contractConfig.accountModel === 'omnibus') {
    throw new Error('Omnibus account model is not supported with finp2p-contract provider');
  }
  const planApprovalService = new PlanApprovalServiceImpl(contractConfig.orgId, pluginManager, contractConfig.finP2PClient);
  const escrowService = new EscrowServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
  const tokenService = new TokenServiceImpl(contractConfig.finP2PContract, contractConfig.finP2PClient, contractConfig.execDetailsStore, contractConfig.proofProvider, pluginManager);
  const mappingService = new CredentialsMappingService(contractConfig.finP2PContract);
  const mappingConfig = buildMappingConfig();
  register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, workflowsConfig, mappingConfig, mappingService);
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

  let custodyProvider: CustodyProvider | undefined;
  if (custodyRegistry.has(appConfig.type)) {
    logger.info(`Activating custody provider: ${appConfig.type} (available: ${custodyRegistry.availableProviders.join(', ')})`);
    custodyProvider = await custodyRegistry.create(appConfig.type, appConfig);
  }

  registerIntegrations({
    orgId: appConfig.orgId,
    logger,
    pluginManager,
    finP2PClient: workflowsConfig?.finP2PClient!,
    walletResolver: custodyProvider ? createWalletResolver(custodyProvider) : undefined,
    rpcUrl: getNetworkRpcUrl(),
  });

  const paymentsService = new PaymentsServiceImpl(pluginManager);

  if (custodyProvider) {
    registerDirectServices(app, logger, custodyProvider, appConfig, paymentsService, pluginManager, workflowsConfig);
  } else if (appConfig.type === 'finp2p-contract') {
    registerFinP2PContractServices(app, appConfig as FinP2PContractAppConfig, paymentsService, pluginManager, workflowsConfig);
  } else {
    throw new Error(`Unknown provider type: '${appConfig.type}'. Available custody providers: ${custodyRegistry.availableProviders.join(', ')}`);
  }

  return app;
}

export default createApp;
