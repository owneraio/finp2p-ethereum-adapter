import { Interface, Log, LogDescription, TransactionReceipt } from "ethers";
import { FinP2PReceipt } from "./model";

export const parseTransactionReceipt = async (receipt: TransactionReceipt, contractInterface: Interface): Promise<FinP2PReceipt> => {
  const id = receipt.hash;
  const timestamp = 0;

  for (const log of receipt.logs) {
    try {
      const parsedLog = contractInterface.parseLog(log);
      if (parsedLog === null) {
        continue;
      }
      switch (parsedLog.name) {
        case "Issue":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            amount: parsedLog.args.quantity.toNumber(),
            destination: parsedLog.args.issuerFinId,
            timestamp: timestamp
          };
        case "Transfer":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            amount: parsedLog.args.quantity.toNumber(),
            source: parsedLog.args.sourceFinId,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp
          };
        case "Redeem":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            amount: parsedLog.args.quantity.toNumber(),
            source: parsedLog.args.issuerFinId,
            timestamp: timestamp
          };
        case "Hold":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            amount: parsedLog.args.quantity.toNumber(),
            source: parsedLog.args.finId,
            timestamp: timestamp
          };
        case "Release":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            amount: parsedLog.args.quantity.toNumber(),
            source: parsedLog.args.sourceFinId,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp
          };
        case "Rollback":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            amount: parsedLog.args.quantity.toNumber(),
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp
          };
      }
    } catch (e) {
      // do nothing
    }
  }

  return {
    id: "",
    assetId: "",
    amount: 0,
    source: "",
    destination: "",
    timestamp: 0
  };
};