import { Interface, TransactionReceipt, Wallet } from "ethers";
import { FinP2PReceipt } from "./model";

export const addressFromPrivateKey = (privateKey: string): string => {
 return  new Wallet(privateKey).address;
}

export const parseTransactionReceipt = (receipt: TransactionReceipt, contractInterface: Interface): FinP2PReceipt | null => {
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
            assetType: "finp2p",
            amount: parsedLog.args.quantity,
            destination: parsedLog.args.issuerFinId,
            timestamp: timestamp
          };
        case "Transfer":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: "finp2p",
            amount: parsedLog.args.quantity,
            source: parsedLog.args.sourceFinId,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp
          };
        case "Redeem":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: "finp2p",
            amount: parsedLog.args.quantity,
            source: parsedLog.args.issuerFinId,
            timestamp: timestamp
          };
        case "Hold":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: "fiat",
            amount: parsedLog.args.quantity,
            source: parsedLog.args.finId,
            timestamp: timestamp
          };
        case "Release":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: "fiat",
            amount: parsedLog.args.quantity,
            source: parsedLog.args.sourceFinId,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp
          };
        case "Rollback":
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: "fiat",
            amount: parsedLog.args.quantity,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp
          };
      }
    } catch (e) {
      // do nothing
    }
  }

  return null;
};


export const stringToByte16 = (str: string): string => {
  return "0x" + Buffer.from(str).slice(0, 16).toString('hex').padEnd(32, '0');
}


