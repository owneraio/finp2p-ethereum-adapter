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
  CommonServiceImpl as DirectCommonServiceImpl,
  HealthServiceImpl as DirectHealthServiceImpl,
} from "./services/direct"
import { ERC20Contract, finIdToAddress } from "@owneraio/finp2p-contracts";
import { parseUnits, parseEther } from "ethers";
import { createFireblocksEthersProvider } from "./config";

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
    case 'fireblocks':
    case 'dfns': {
      const custodyProvider = appConfig.type === 'fireblocks'
        ? await FireblocksCustodyProvider.create(appConfig)
        : await DfnsCustodyProvider.create(appConfig);
      const tokenService = new DirectTokenService(logger, custodyProvider);
      const commonService = new DirectCommonServiceImpl();
      const healthService = new DirectHealthServiceImpl(custodyProvider.healthCheckProvider);

      register(app, tokenService, tokenService, commonService, healthService, paymentsService, planApprovalService, pluginManager, workflowsConfig);

      // Admin endpoint: fund an investor's wallet with ERC20 tokens or native ETH
      app.post('/api/admin/fund', async (req, res) => {
        try {
          const { finId, amount, tokenAddress, sourceVaultId, native, assetId } = req.body as {
            finId: string; amount: string; tokenAddress?: string; sourceVaultId?: string;
            native?: boolean; assetId?: string;
          };
          const address = finIdToAddress(finId);

          // Native ETH via Fireblocks vault-to-vault transfer (reliable, polls for completion)
          if (native && appConfig.type === 'fireblocks' && sourceVaultId) {
            const fb = custodyProvider as FireblocksCustodyProvider;
            const targetVaultId = await fb.getVaultIdForAddress(address);
            if (!targetVaultId) throw new Error(`No Fireblocks vault found for address ${address}`);
            const fbAssetId = assetId ?? 'ETH_TEST5';
            await fb.transferBetweenVaults(sourceVaultId, targetVaultId, fbAssetId, amount);
            logger.info(`Vault-to-vault funded ${amount} ${fbAssetId} to vault ${targetVaultId} (${address}) from vault ${sourceVaultId}`);
            res.json({ success: true, to: address, amount, native: true, fromVault: sourceVaultId, toVault: targetVaultId });
            return;
          }

          // Use explicit source vault or fall back to escrow
          let wallet;
          if (sourceVaultId && appConfig.type === 'fireblocks') {
            wallet = await createFireblocksEthersProvider({
              apiKey: appConfig.apiKey,
              privateKey: appConfig.apiPrivateKey,
              chainId: appConfig.chainId,
              apiBaseUrl: appConfig.apiBaseUrl,
              vaultAccountIds: [sourceVaultId],
            });
          } else {
            wallet = custodyProvider.escrow;
          }

          if (native) {
            // Fallback: Web3 sendTransaction
            const tx = await wallet.signer.sendTransaction({
              to: address,
              value: parseEther(amount),
            });
            const receipt = await tx.wait();
            logger.info(`Funded ${amount} ETH to ${address} (finId: ${finId}) from vault ${sourceVaultId ?? 'escrow'}, tx: ${receipt?.hash}`);
            res.json({ success: true, txHash: receipt?.hash, to: address, amount, native: true });
          } else {
            // Send ERC20 tokens
            const c = new ERC20Contract(wallet.provider, wallet.signer, tokenAddress!, logger);
            const decimals = await c.decimals();
            const rawAmount = parseUnits(amount, decimals);
            const tx = await c.transfer(address, rawAmount);
            const receipt = await tx.wait();
            logger.info(`Funded ${amount} tokens to ${address} (finId: ${finId}) from vault ${sourceVaultId ?? 'escrow'}, tx: ${receipt?.hash}`);
            res.json({ success: true, txHash: receipt?.hash, to: address, amount });
          }
        } catch (e: any) {
          logger.error(`Fund failed: ${e.message ?? e}`);
          res.status(500).json({ error: String(e) });
        }
      });

      break
    }
    case 'finp2p-contract': {
      const escrowService = new EscrowServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      const tokenService = new TokenServiceImpl(appConfig.finP2PContract, appConfig.finP2PClient, appConfig.execDetailsStore, appConfig.proofProvider, pluginManager);
      register(app, tokenService, escrowService, tokenService, tokenService, paymentsService, planApprovalService, pluginManager, workflowsConfig);
      break
    }
  }

  return app;
}

export default createApp;
