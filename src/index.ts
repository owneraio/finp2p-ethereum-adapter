import { logger } from "./helpers/logger";
import { FinP2PContract } from "./contracts/finp2p";
import * as process from "process";
import createApp from "./app";
import { ContractsManager } from "./contracts/manager";
import { NonceManager, Wallet } from "ethers";

const init = async () => {
  const port = process.env.PORT || "3000";
  const ethereumRPCUrl = process.env.NETWORK_HOST || "";
  if (!ethereumRPCUrl) {
    throw new Error("ETHEREUM_RPC_URL is not set");
  }
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
  if (!operatorPrivateKey) {
    throw new Error("OPERATOR_PRIVATE_KEY is not set");
  }
  const operator = new NonceManager(new Wallet(operatorPrivateKey));

  const finP2PContractAddress = process.env.TOKEN_ADDRESS || "";
  if (!finP2PContractAddress) {
    throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
  }

  logger.info(`Connecting to ethereum RPC URL: ${ethereumRPCUrl}`);

  const finP2PContract = new FinP2PContract(ethereumRPCUrl, operator, finP2PContractAddress);
  const app = createApp(finP2PContract);
  app.listen(port, () => {
    logger.info(`listening at http://localhost:${port}`);
  });


  process.on("unhandledRejection", (reason, p) => {
    logger.error("Unhandled Rejection", { promise: p, reason });
  });
  process.on("uncaughtException", (err, origin) => {
    logger.error("uncaught exception", { err, origin });
  });
};

init().then(() => {
  logger.info("Server started successfully");
}).catch((err) => {
  logger.error("Error starting server", err);
  process.exit(1);
});


