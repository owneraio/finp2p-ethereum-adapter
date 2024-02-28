import { logger } from "./helpers/logger";
import { FinP2PContract } from "./contracts/finp2p";
import * as process from "process";
import createApp from "./app";

const port = process.env.PORT || "3000";
const ethereumRPCUrl = process.env.NETWORK_HOST || "";
const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY || "";
const finP2PContractAddress = process.env.TOKEN_ADDRESS || "";

if (!ethereumRPCUrl) {
  throw new Error("ETHEREUM_RPC_URL is not set");
}
if (!operatorPrivateKey) {
  throw new Error("OPERATOR_PRIVATE_KEY is not set");
}
if (!finP2PContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}

logger.info(`Connecting to ethereum RPC URL: ${ethereumRPCUrl}`);

const finP2PContract = new FinP2PContract(ethereumRPCUrl, operatorPrivateKey, finP2PContractAddress);
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


