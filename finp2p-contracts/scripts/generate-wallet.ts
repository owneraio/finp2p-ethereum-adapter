import { createAccount, privateKeyToFinId } from "../src/contracts/utils";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

const generateWallet = async () => {
  const account = createAccount();
  logger.info("New wallet:");
  logger.info("\tprivate key:\t", account.privateKey);
  logger.info("\taddress:\t", account.address);
  logger.info("\tfinId:\t", privateKeyToFinId(account.privateKey));
};

generateWallet()
  .then(() => {
  });