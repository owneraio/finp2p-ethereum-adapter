import express from "express";
import { logger as expressLogger } from "express-winston";
import winston from "winston";
import { Provider, Signer } from "ethers";
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
} from "./services";
import {
  CommonServiceImpl as CommonServiceFireblocksImpl,
  EscrowServiceImpl as EscrowServiceFireblocksImpl,
  HealthServiceImpl as HealthServiceFireblocksImpl,
  PaymentsServiceImpl as PaymentsServiceFireblocksImpl,
  PlanApprovalServiceImpl as PlanApprovalServiceFireblocksImpl,
  TokenServiceImpl as TokenServiceFireblocksImpl,
} from "./services/fireblocks"

/**
 * Configuration for Fireblocks-based initialization.
 * When using Fireblocks, we only need the provider, signer, and workflows config.
 * FinP2P contract manager and plugin managers are not required.
 */
type FireblocksAppConfig = {
  useFireblocks: true;
  provider: Provider;
  signer: Signer;
  workflowsConfig: workflows.Config | undefined;
  logger: winston.Logger;
}

/**
 * Configuration for standard (non-Fireblocks) initialization.
 * This mode requires the full FinP2P contract setup with client, exec details store,
 * and organization ID for proof provider initialization.
 */
type StandardAppConfig = {
  useFireblocks: false;
  orgId: string;
  finP2PContract: FinP2PContract;
  finP2PClient: FinP2PClient | undefined;
  execDetailsStore: ExecDetailsStore | undefined;
  workflowsConfig: workflows.Config | undefined;
  logger: winston.Logger;
}

/**
 * Discriminated union type for app configuration.
 * The 'useFireblocks' property acts as the discriminator, allowing TypeScript
 * to narrow the type and ensure only the required properties are provided for each mode.
 */
type AppConfig = FireblocksAppConfig | StandardAppConfig;

/**
 * Creates and configures the Express application with the appropriate services
 * based on the configuration mode (Fireblocks or Standard).
 * 
 * This function has been refactored to use TypeScript discriminated unions,
 * making it easier to understand and maintain by clearly separating the two
 * initialization paths:
 * 
 * 1. Fireblocks mode: Uses Fireblocks-specific service implementations that
 *    interact directly with Fireblocks infrastructure. Only requires provider,
 *    signer, and workflow configuration.
 * 
 * 2. Standard mode: Uses FinP2P contract-based service implementations with
 *    full plugin support and proof providers. Requires FinP2P contract manager,
 *    client, and additional dependencies.
 * 
 * @param config - Discriminated union configuration object
 * @returns Configured Express application
 */
function createApp(config: AppConfig) {
  // Initialize Express with standard middleware
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(expressLogger({
    winstonInstance: config.logger,
    meta: true,
    expressFormat: true,
    statusLevels: true,
    ignoreRoute: (req) => req.url.toLowerCase() === "/health/readiness" || req.url.toLowerCase() === "/health/liveness"
  }));

  // Use discriminator to determine initialization path
  if (config.useFireblocks) {
    // Fireblocks mode: Initialize lightweight services without FinP2P contract dependencies
    // These services interact with blockchain through Fireblocks infrastructure
    const commonService = new CommonServiceFireblocksImpl()
    const escrowService = new EscrowServiceFireblocksImpl()
    const healthService = new HealthServiceFireblocksImpl(config.provider)
    const paymentsService = new PaymentsServiceFireblocksImpl()
    const planApprovalService = new PlanApprovalServiceFireblocksImpl()
    const tokenService = new TokenServiceFireblocksImpl(config.provider, config.signer, config.logger)

    // Register services without plugin manager (not needed in Fireblocks mode)
    register(app, tokenService, escrowService, commonService, healthService, paymentsService, planApprovalService, undefined, config.workflowsConfig)
  } else {
    // Standard mode: Initialize full FinP2P contract-based services with plugin support
    const pluginManager = new PluginManager();

    // Initialize proof provider for signature verification
    const signerPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
    const proofProvider = new ProofProvider(config.orgId, config.finP2PClient, signerPrivateKey);
    
    // Create service instances with full FinP2P contract integration
    const tokenService = new TokenServiceImpl(config.finP2PContract, config.finP2PClient, config.execDetailsStore, proofProvider, pluginManager)
    const escrowService = new EscrowServiceImpl(config.finP2PContract, config.finP2PClient, config.execDetailsStore, proofProvider, pluginManager);
    const paymentsService = new PaymentsServiceImpl(pluginManager);
    const planApprovalService = new PlanApprovalServiceImpl(config.orgId, pluginManager, config.finP2PClient);
    
    // Register services with plugin manager support
    register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, config.workflowsConfig);
  }

  return app;
}

// Export types for use in other modules
export type { AppConfig, FireblocksAppConfig, StandardAppConfig };
export default createApp;
