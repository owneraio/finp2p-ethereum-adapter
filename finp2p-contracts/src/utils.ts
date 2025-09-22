import {
  computeAddress,
  concat,
  HDNodeWallet,
  isAddress,
  Signature,
  TransactionReceipt,
  Wallet
} from "ethers";
import { OperationParams, Phase } from "./model";
import * as secp256k1 from "secp256k1";
import {
  FINP2POperatorInterface,
  HoldEvent,
  IssueEvent,
  RedeemEvent,
  ReleaseEvent,
  TransferEvent
} from "../typechain-types/contracts/finp2p/FINP2POperator";
import {
  ERC20WithOperatorInterface,
  TransferEvent as ERC20TransferEvent
} from "../typechain-types/contracts/token/ERC20/ERC20WithOperator";
import { Destination, LegType, PrimaryType, Receipt } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { assetToService, finIdDestination, finIdSource } from "./mappers";
import { TradeDetails } from "@owneraio/finp2p-nodejs-skeleton-adapter/dist/lib/services/model";

export const compactSerialize = (signature: string): string => {
  const { r, s } = Signature.from(signature);
  return concat([r, s]).substring(2);
};

export const privateKeyToFinId = (privateKey: string): string => {
  const privKeyBuffer = Buffer.from(privateKey.replace("0x", ""), "hex");
  const pubKeyUInt8Array = secp256k1.publicKeyCreate(privKeyBuffer, true);
  return Buffer.from(pubKeyUInt8Array).toString("hex");
};

export const getFinId = (wallet: HDNodeWallet): string => {
  return privateKeyToFinId(wallet.privateKey);
};

export const createAccount = () => {
  const account = Wallet.createRandom();
  return {
    address: account.address,
    privateKey: account.privateKey,
    finId: privateKeyToFinId(account.privateKey)
  };
};

export const addressFromPrivateKey = (privateKey: string): string => {
  return new Wallet(privateKey).address;
};

// ethers version
export const finIdToAddress = (finId: string): string => {
  return computeAddress(`0x${finId}`);
};

// secp version
// export const finIdToAddress = (finId: string): string => {
//   const val = secp256k1.publicKeyConvert(Buffer.from(finId, "hex"), false).slice(1);
//   return "0x" + keccak256(val).slice(-40);
// };

const emptyTradeDetails = (): TradeDetails => {
  return {
    executionContext: {
      planId: "",
      sequence: 0
    },
  }
}

export const parseTransactionReceipt = (
  receipt: TransactionReceipt,
  contractInterface: FINP2POperatorInterface,
  timestamp: number
): Receipt | null => {
  const id = receipt.hash;

  const tradeDetails = emptyTradeDetails();
  for (const log of receipt.logs) {
    try {
      const parsedLog = contractInterface.parseLog(log);
      if (parsedLog === null) {
        continue;
      }

      switch (parsedLog.signature) {
        case "Issue(string,uint8,string,string)": {
          const { assetId, assetType, quantity, issuerFinId } = parsedLog.args as unknown as IssueEvent.OutputObject;

          return {
            id,
            operationType: "issue",
            asset: assetToService(assetId, assetType),
            quantity,
            destination: finIdDestination(issuerFinId),
            transactionDetails: {
              transactionId: id,
              operationId: undefined
            },
            tradeDetails,
            timestamp
          } as Receipt;
        }
        case "Transfer(string,uint8,string,string,string)": {
          const {
            assetId,
            assetType,
            quantity,
            sourceFinId,
            destinationFinId
          } = parsedLog.args as unknown as TransferEvent.OutputObject;
          return {
            id,
            operationType: "transfer",
            asset: assetToService(assetId, assetType),
            quantity,
            source: finIdSource(sourceFinId),
            destination: finIdDestination(destinationFinId),
            transactionDetails: {
              transactionId: id,
              operationId: undefined
            },
            tradeDetails,
            timestamp
          } as Receipt;
        }
        case "Redeem(string,uint8,string,string,string)": {
          const {
            assetId,
            assetType,
            quantity,
            ownerFinId,
            operationId
          } = parsedLog.args as unknown as RedeemEvent.OutputObject;
          return {
            id,
            operationType: "redeem",
            asset: assetToService(assetId, assetType),
            quantity,
            source: finIdSource(ownerFinId),
            transactionDetails: {
              transactionId: id,
              operationId: operationId
            },
            tradeDetails,
            timestamp
          } as Receipt;
        }
        case "Hold(string,uint8,string,string,string)": {
          const {
            assetId,
            assetType,
            quantity,
            finId,
            operationId
          } = parsedLog.args as unknown as HoldEvent.OutputObject;
          return {
            id,
            operationType: "hold",
            asset: assetToService(assetId, assetType),
            quantity,
            source: finIdSource(finId),
            transactionDetails: {
              transactionId: id,
              operationId: operationId
            },
            tradeDetails,
            timestamp
          } as Receipt;
        }
        case "Release(string,uint8,string,string,string,string)": {
          const {
            assetId,
            assetType,
            quantity,
            sourceFinId,
            destinationFinId,
            operationId
          } = parsedLog.args as unknown as ReleaseEvent.OutputObject;
          return {
            id,
            operationType: "release",
            asset: assetToService(assetId, assetType),
            quantity,
            source: finIdSource(sourceFinId),
            destination: finIdDestination(destinationFinId),
            transactionDetails: {
              transactionId: id,
              operationId: operationId
            },
            tradeDetails,
            timestamp
          } as Receipt;
        }
      }
    } catch (e) {
      // do nothing
      console.error(e);
    }
  }

  return null;
};

export const parseERC20Transfer = (receipt: TransactionReceipt,
                                   contractInterface: ERC20WithOperatorInterface): {
  from: string,
  to: string,
  value: bigint
} | undefined => {
  for (const log of receipt.logs) {
    try {
      const parsedLog = contractInterface.parseLog(log);
      if (parsedLog === null) {
        continue;
      }

      if (parsedLog.signature === "Transfer(address,address,uint256)") {
        const { from, to, value } = parsedLog.args as unknown as ERC20TransferEvent.OutputObject;
        return { from, to, value };
      }
    } catch (e) {
      // do nothing
    }
  }
};

export const isEthereumAddress = (address: string): boolean => {
  return isAddress(address);
};


const undefinedIfEmpty = (value: string): string | undefined => {
  return value === "" ? undefined : value;
};

export const truncateDecimals = (value: string, decimals: number): string => {
  const [intPart, decPart = ""] = value.split(".");

  if (decimals <= 0 || decPart.length === 0) {
    return intPart;
  }

  return `${intPart}.${decPart.slice(0, decimals)}`;
};

export const detectSigner = (op: OperationParams, buyerFinId: string, sellerFinId: string) => {
  if (op.leg === LegType.Asset) {
    if (op.phase === Phase.Initiate) {
      return sellerFinId;
    } else if (op.phase === Phase.Close) {
      return buyerFinId;
    } else {
      throw new Error("Invalid phase");
    }
  } else if (op.leg === LegType.Settlement) {
    if (op.eip712PrimaryType === PrimaryType.PrimarySale) {
      if (op.phase === Phase.Initiate) {
        return buyerFinId;
      } else if (op.phase === Phase.Close) {
        return sellerFinId;
      } else {
        throw new Error("Invalid phase");
      }
    } else {
      return buyerFinId;
    }
  } else {
    throw new Error("Invalid leg");
  }
};
