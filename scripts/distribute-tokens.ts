#!/usr/bin/env node
import console from "console";
import winston, { format, transports } from "winston";
import { parseConfig } from "../src/config";

const logger = winston.createLogger({
  level: "info",
  transports: [new transports.Console()],
  format: format.json()
});

const distribute = async (
  serverPort: string,
  finId: string,
  assetId: string,
  assetType: string,
  amount: string
) => {
  const url = `http://localhost:${serverPort}/distribution/distribute`;

  logger.info(`Distributing ${amount} of asset ${assetId} (${assetType}) to finId ${finId}`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ finId, assetId, assetType, amount })
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  logger.info("Distribution successful", { response: body });
};

const config = parseConfig([
  {
    name: "server_port",
    envVar: "SERVER_PORT",
    defaultValue: "3000",
    description: "Local server port"
  },
  {
    name: "fin_id",
    envVar: "FIN_ID",
    required: true,
    description: "Recipient FinID (public key hex)"
  },
  {
    name: "asset_id",
    envVar: "ASSET_ID",
    required: true,
    description: "Asset ID to distribute"
  },
  {
    name: "asset_type",
    envVar: "ASSET_TYPE",
    defaultValue: "finp2p",
    description: "Asset type (default: finp2p)"
  },
  {
    name: "amount",
    envVar: "AMOUNT",
    required: true,
    description: "Amount to distribute (raw units)"
  }
]);

distribute(
  config.server_port!,
  config.fin_id!,
  config.asset_id!,
  config.asset_type!,
  config.amount!
).catch(console.error);
