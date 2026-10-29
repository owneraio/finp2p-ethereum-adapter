import express from "express";
import winston, { format, transports } from "winston";
import { ConfigStore, InMemorySecretVault, createConfigRouter, ethereumAdapterSchema, ethereumAdapterValidators } from "./services/configuration";
import { redactSecrets } from "./redact-secrets";

/**
 * The configuration API on its own, on the same express stack as the adapter,
 * so configuration UIs can be built against it before the adapter boots from it.
 * Values are kept in memory.
 */
const port = process.env.CONFIG_PORT || "3100";
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  transports: [new transports.Console()],
  format: format.combine(format.timestamp(), format.json(), redactSecrets()),
});

const app = express();
app.use("/config", createConfigRouter({
  store: new ConfigStore(ethereumAdapterSchema(), new InMemorySecretVault()),
  validators: ethereumAdapterValidators,
  logger,
}));

app.listen(port, () => logger.info(`configuration API at http://localhost:${port}/config/schema`));
