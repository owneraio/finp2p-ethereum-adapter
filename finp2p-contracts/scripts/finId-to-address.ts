import process from "process";
import winston, { format, transports } from "winston";
import { finIdToAddress } from "../src/contracts/utils";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});


const finId = process.env.FIN_ID;
if (!finId) {
  throw new Error("OPERATOR_ADDRESS is not set");
}

logger.info(`${finId}: ${finIdToAddress(finId)}`);
