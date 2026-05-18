#!/usr/bin/env node
import { finIdToAddress } from "../src";
import { parseConfig } from "./config";

const convertFinIdToAddress = (finId: string) => {
  const address = finIdToAddress(finId);
  console.log(`finId: ${finId},  address: ${address}`);
};

const config = parseConfig([
  {
    name: "fin_id",
    envVar: "FIN_ID",
    description: "finId (secp256k1 public key) to convert to an Ethereum address",
    required: true
  }
]);

convertFinIdToAddress(config.fin_id!);
