import * as process from "process";
import { logger } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FinP2PClient } from "@owneraio/finp2p-client";
import winston, { format, transports } from "winston";
import {
  FinP2PContract,
  createProviderAndSigner,
  FinP2PContractConfig,
  ProviderType,
  readConfig
} from "../finp2p-contracts/src";
import createApp from "./app";
import { InMemoryExecDetailsStore } from "./services";


const init = async () => {
  const port = process.env.PORT || "3000";
  const configFile = process.env.CONFIG_FILE || "";
  let finP2PContractAddress: string;
  if (configFile) {
    const config = await readConfig<FinP2PContractConfig>(configFile);
    finP2PContractAddress = config.finP2PContractAddress;

  } else {
    finP2PContractAddress = process.env.TOKEN_ADDRESS || "";
    if (!finP2PContractAddress) {
      throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
    }
  }
  const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;

  const ossUrl = process.env.OSS_URL;
  if (!ossUrl) {
    throw new Error("OSS_URL is not set");
  }

  const level = process.env.LOG_LEVEL || "info";
  const logger = winston.createLogger({
    level,
    transports: [new transports.Console()],
    format: format.combine(format.timestamp(), format(function dynamicContent(info) {
      if (info.timestamp) {
        info.time = info.timestamp;
        delete info.timestamp;
      }
      if (info.message) {
        info.msg = info.message;
        // @ts-ignore
        delete info.message;
      }
      return info;
    })(), format.json())
  });

  const defaultDecimals = parseInt(process.env.DEFAULT_DECIMALS || "18");

  const useNonceManager = process.env.NONCE_POLICY === "fast";
  const { provider, signer } = await createProviderAndSigner(providerType, logger, useNonceManager);
  const finp2pContract = new FinP2PContract(provider, signer, finP2PContractAddress, logger);
  const finP2PClient = new FinP2PClient("", ossUrl);
  const execDetailsStore = new InMemoryExecDetailsStore();

  const version = await finp2pContract.getVersion();
  logger.info(`FinP2P contract version: ${version}`);

  createApp(finp2pContract, finP2PClient, execDetailsStore, defaultDecimals, logger).listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });
};

init().then(() => {
  logger.info("Server started successfully");
}).catch((err) => {
  logger.error("Error starting server", err);
  process.exit(1);
});


