import {
  HDNodeWallet,
  Interface,
  TransactionReceipt,
  Wallet,
  Signature,
  isAddress,
  keccak256,
  concat,
  toUtf8Bytes, hexlify
} from "ethers";
import { FinP2PReceipt } from './model';
import * as secp256k1 from 'secp256k1';
import {
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

export const compactSerialize = (signature : string): string =>  {
  const { r, s } = Signature.from(signature)
  return concat([ r, s ]).substring(2)
}

export const hashToBytes16 = (val: string): string => {
  return hexlify(keccak256(toUtf8Bytes(val))).slice(0, 34);
}

export const privateKeyToFinId = (privateKey: string): string => {
  const privKeyBuffer = Buffer.from(privateKey.replace('0x', ''), 'hex');
  const pubKeyUInt8Array = secp256k1.publicKeyCreate(privKeyBuffer, true);
  return Buffer.from(pubKeyUInt8Array).toString('hex');
};

export const getFinId = (wallet: HDNodeWallet): string => {
  return privateKeyToFinId(wallet.privateKey);
};

export const createAccount = () => {
  const account = Wallet.createRandom();
  return {
    address: account.address,
    privateKey: account.privateKey,
    finId: privateKeyToFinId(account.privateKey),
  };
};

export const addressFromPrivateKey = (privateKey: string): string => {
  return new Wallet(privateKey).address;
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
        case 'Issue(string,string,string,string)': {
          const { assetId, assetType, quantity, issuerFinId } = parsedLog.args as unknown as IssueEvent.OutputObject;
          return { id, assetId, assetType, quantity, destination: issuerFinId, timestamp, operationType: 'issue' };
        }
        case 'Transfer(string,string,string,string,string)': {
            const { assetId, assetType, quantity, sourceFinId, destinationFinId } = parsedLog.args as unknown as TransferEvent.OutputObject;
            return { id, assetId, assetType, quantity, source: sourceFinId, destination: destinationFinId, timestamp, operationType: 'transfer' };
        }
        case 'Redeem(string,string,string,string,bytes16)': {
          const { assetId, assetType, quantity, ownerFinId } = parsedLog.args  as unknown as RedeemEvent.OutputObject;
          return { id, assetId, assetType, quantity, source: ownerFinId, timestamp, operationType: 'redeem' };
        }
        case 'Hold(string,string,string,string,bytes16)': {
          const { assetId, assetType, quantity, finId, operationId } = parsedLog.args as unknown as HoldEvent.OutputObject;
          return { id, assetId, assetType, quantity, source: finId, timestamp, operationType: 'hold', operationId };
        }
        case 'Release(string,string,string,string,string,bytes16)': {
          const { assetId, assetType, quantity, sourceFinId, destinationFinId, operationId } = parsedLog.args as unknown as ReleaseEvent.OutputObject;
          return { id, assetId, assetType, quantity, source: sourceFinId, destination: destinationFinId, timestamp,
            operationType: 'release', operationId };
        }
      }
    } catch (e) {
      // do nothing
    }
  }

  return null;
};

export const parseERC20Transfer = (receipt: TransactionReceipt,
                                   contractInterface: ERC20WithOperatorInterface): {  from: string, to: string, value: bigint } | undefined => {
  for (const log of receipt.logs) {
    try {
      const parsedLog = contractInterface.parseLog(log);
      if (parsedLog === null) {
        continue;
      }

      if (parsedLog.signature === 'Transfer(address,address,uint256)') {
        const { from, to, value } = parsedLog.args as unknown as ERC20TransferEvent.OutputObject;
        return { from, to, value };
      }
    } catch (e) {
      // do nothing
    }
  }
}

export const isEthereumAddress = (address: string): boolean => {
  return isAddress(address);
};

export const finIdToEthereumAddress = (finId: string): string => {
  return "0x" + keccak256(`0x${finId}`).slice(-40);
}

const undefinedIfEmpty = (value: string): string | undefined => {
  return value === '' ? undefined : value;
}