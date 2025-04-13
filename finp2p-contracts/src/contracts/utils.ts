import {
  concat, ContractFactory,
  HDNodeWallet,
  isAddress,
  keccak256,
  Signature, Signer,
  TransactionReceipt,
  Wallet
} from "ethers";
import { assetTypeFromNumber, FinP2PReceipt } from "./model";
import * as secp256k1 from "secp256k1";
import {
  FINP2POperatorERC20Interface,
  HoldEvent,
  IssueEvent,
  RedeemEvent,
  ReleaseEvent,
  TransferEvent
} from "../../typechain-types/contracts/token/ERC20/FINP2POperatorERC20";

import {
  FINP2POperatorERC20CollateralInterface
} from "../../typechain-types/contracts/token/collateral/finp2p/FINP2POperatorERC20Collateral";
import {
  AccountCreatedEvent,
  IAccountFactoryInterface
} from "../../typechain-types/contracts/token/collateral/IAccountFactory";
import { FinP2PCollateralBasket } from "../../typechain-types";
import FIN2P2P_COLLATERAL_ASSET_FACTORY
  from "../../artifacts/contracts/token/collateral/finp2p/FinP2PCollateralBasket.sol/FinP2PCollateralBasket.json";

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

export const parseTransactionReceipt = (
  receipt: TransactionReceipt,
  contractInterface: FINP2POperatorERC20Interface | FINP2POperatorERC20CollateralInterface,
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
        case "Issue(string,uint8,string,string)": {
          const { assetId, assetType, quantity, issuerFinId } = parsedLog.args as unknown as IssueEvent.OutputObject;
          return {
            id,
            assetId,
            assetType: assetTypeFromNumber(assetType),
            quantity,
            destination: issuerFinId,
            timestamp,
            operationType: "issue"
          };
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
            assetId,
            assetType: assetTypeFromNumber(assetType),
            quantity,
            source: sourceFinId,
            destination: destinationFinId,
            timestamp,
            operationType: "transfer"
          };
        }
        case "Redeem(string,uint8,string,string,string)": {
          const { assetId, assetType, quantity, ownerFinId } = parsedLog.args as unknown as RedeemEvent.OutputObject;
          return {
            id,
            assetId,
            assetType: assetTypeFromNumber(assetType),
            quantity,
            source: ownerFinId,
            timestamp,
            operationType: "redeem"
          };
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
            assetId,
            assetType: assetTypeFromNumber(assetType),
            quantity,
            source: finId,
            timestamp,
            operationType: "hold",
            operationId
          };
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
            assetId,
            assetType: assetTypeFromNumber(assetType),
            quantity,
            source: sourceFinId,
            destination: destinationFinId,
            timestamp,
            operationType: "release",
            operationId
          };
        }
      }
    } catch (e) {
      // do nothing
    }
  }

  return null;
};

export const parseCreateAccount = (receipt: TransactionReceipt,
                                   contractInterface: IAccountFactoryInterface): {
  address: string,
  id: bigint
} => {
  for (const log of receipt.logs) {
    try {
      const parsed = contractInterface.parseLog(log);
      if (parsed && parsed.name === "AccountCreated") {
        const { account, accountId } = parsed.args as unknown as AccountCreatedEvent.OutputObject;
        return { address: account, id: accountId };
      }
    } catch (e) {
      // do nothing
    }
  }
  throw new Error("Failed to parse create account");
};


// export const parseERC20Transfers = (receipt: TransactionReceipt,
//                                    contractInterface: IERC20Interface): ERC20Transfer[] => {
//   let transfers: ERC20Transfer[] = []
//   for (const log of receipt.logs) {
//     try {
//       const parsedLog = contractInterface.parseLog(log);
//       if (parsedLog === null) {
//         continue;
//       }
//
//       if (parsedLog.signature === "Transfer(address,address,uint256)") {
//         const { address } = log;
//         const { from, to, value } = parsedLog.args as unknown as ERC20TransferEvent.OutputObject;
//         transfers.push({ address, from, to, value });
//       }
//     } catch (e) {
//       // do nothing
//     }
//   }
//   return transfers;
// };

export const isEthereumAddress = (address: string): boolean => {
  return isAddress(address);
};

export const finIdToEthereumAddress = (finId: string): string => {
  return "0x" + keccak256(`0x${finId}`).slice(-40);
};

const undefinedIfEmpty = (value: string): string | undefined => {
  return value === "" ? undefined : value;
};


export const setAccountFactoryAddress = async (signer: Signer, collateralBasketAddress: string, factoryAddress: string) => {
  const factory = new ContractFactory<any[], FinP2PCollateralBasket>(FIN2P2P_COLLATERAL_ASSET_FACTORY.abi, FIN2P2P_COLLATERAL_ASSET_FACTORY.bytecode, signer);
  const contract = await factory.attach(collateralBasketAddress) as FinP2PCollateralBasket;
  const rsp = await contract.setAccountFactoryAddress(factoryAddress);
  await rsp.wait();
};

