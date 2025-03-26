import { concat, HDNodeWallet, isAddress, keccak256, Signature, TransactionReceipt, Wallet } from "ethers";
import { assetTypeFromNumber, FinP2PReceipt, ReceiptOperationType, ReceiptTradeDetails } from "./model";
import * as secp256k1 from "secp256k1";
import {
  FinP2P,
  FINP2POperatorERC20Interface,
  HoldEvent,
  IssueEvent,
  RedeemEvent,
  ReleaseEvent,
  TransferEvent
} from "../../typechain-types/contracts/token/ERC20/FINP2POperatorERC20";
import {
  ERC20WithOperatorInterface,
  TransferEvent as ERC20TransferEvent
} from "../../typechain-types/contracts/token/ERC20/ERC20WithOperator";
import ExecutionContextStructOutput = FinP2P.ExecutionContextStructOutput;

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

export const createReceipt = (
  id: string,
  operationType: ReceiptOperationType,
  assetId: string,
  assetType: bigint,
  source: string | undefined,
  destination: string | undefined,
  quantity: string,
  operationId: string | undefined,
  executionContext: ExecutionContextStructOutput,
  timestamp: number
): FinP2PReceipt => {
  const { planId, sequence } = executionContext;
  let tradeDetails: ReceiptTradeDetails | undefined;
  if (planId !== "" && sequence !== 0n) {
    tradeDetails = {
      executionContext: {
        executionPlanId: planId,
        instructionSequenceNumber: Number(sequence)
      }
    };
  }
  return {
    id,
    operationType,
    assetId,
    assetType: assetTypeFromNumber(assetType),
    quantity,
    source,
    destination,
    operationId,
    tradeDetails,
    timestamp
  };
};

export const parseTransactionReceipt = (
  receipt: TransactionReceipt,
  contractInterface: FINP2POperatorERC20Interface,
  timestamp: number
): FinP2PReceipt | null => {
  const id = receipt.hash;

  for (const log of receipt.logs) {
    try {
      const parsedLog = contractInterface.parseLog(log);
      if (parsedLog === null) {
        continue;
      }

      switch (parsedLog.signature) {
        case "Issue(string,uint8,string,string,ExecutionContext)": {
          const {
            assetId,
            assetType,
            quantity,
            issuerFinId,
            executionContext
          } = parsedLog.args as unknown as IssueEvent.OutputObject;
          return createReceipt(id, ReceiptOperationType.ISSUE, assetId, assetType, undefined, issuerFinId, quantity, undefined, executionContext, timestamp);
        }
        case "Transfer(string,uint8,string,string,string,ExecutionContext)": {
          const {
            assetId,
            assetType,
            quantity,
            sourceFinId,
            destinationFinId,
            executionContext
          } = parsedLog.args as unknown as TransferEvent.OutputObject;
          return createReceipt(id, ReceiptOperationType.TRANSFER, assetId, assetType, sourceFinId, destinationFinId, quantity, undefined, executionContext, timestamp);
        }
        case "Redeem(string,uint8,string,string,string,ExecutionContext)": {
          const {
            assetId,
            assetType,
            quantity,
            ownerFinId,
            executionContext
          } = parsedLog.args as unknown as RedeemEvent.OutputObject;
          return createReceipt(id, ReceiptOperationType.REDEEM, assetId, assetType, ownerFinId, undefined, quantity, undefined, executionContext, timestamp);
        }
        case "Hold(string,uint8,string,string,string,ExecutionContext)": {
          const {
            assetId,
            assetType,
            quantity,
            finId,
            operationId,
            executionContext
          } = parsedLog.args as unknown as HoldEvent.OutputObject;
          return createReceipt(id, ReceiptOperationType.HOLD, assetId, assetType, finId, undefined, quantity, operationId, executionContext, timestamp);
        }
        case "Release(string,uint8,string,string,string,string,ExecutionContext)": {
          const {
            assetId,
            assetType,
            quantity,
            sourceFinId,
            destinationFinId,
            operationId,
            executionContext
          } = parsedLog.args as unknown as ReleaseEvent.OutputObject;
          return createReceipt(id, ReceiptOperationType.RELEASE, assetId, assetType, sourceFinId, destinationFinId, quantity, operationId, executionContext, timestamp);
        }
      }
    } catch (e) {
      // do nothing
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

export const finIdToEthereumAddress = (finId: string): string => {
  return "0x" + keccak256(`0x${finId}`).slice(-40);
};

const undefinedIfEmpty = (value: string): string | undefined => {
  return value === "" ? undefined : value;
};