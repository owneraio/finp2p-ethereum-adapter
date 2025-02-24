import { HDNodeWallet, Interface, TransactionReceipt, Wallet, isAddress, keccak256 } from 'ethers';
import { FinP2PReceipt } from './model';
import * as secp256k1 from 'secp256k1';

export const normalizeOperationId = (operationId: string): string => {
  // TODO: think about passing a string instead of bytes16 or a betting concatenation
  if (operationId.includes(':') && operationId.includes('_')) {
    return `0x${operationId.split(':')[2].split('_')[0].replaceAll('-', '')}`
  } else {
    return `0x${operationId.replaceAll('-', '')}`;
  }
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
  return  new Wallet(privateKey).address;
};


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
        case 'Issue':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: parsedLog.args.assetType,
            amount: parsedLog.args.quantity,
            destination: parsedLog.args.issuerFinId,
            timestamp: timestamp,
            operationType: 'issue',
          };
        case 'Transfer':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: parsedLog.args.assetType,
            amount: parsedLog.args.quantity,
            source: parsedLog.args.sourceFinId,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp,
            operationType: 'transfer',
          };
        case 'Redeem':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: parsedLog.args.assetType,
            amount: parsedLog.args.quantity,
            source: parsedLog.args.ownerFinId,
            timestamp: timestamp,
            operationType: 'redeem',
          };
        case 'Hold':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: parsedLog.args.assetType,
            amount: parsedLog.args.quantity,
            source: parsedLog.args.finId,
            timestamp: timestamp,
            operationType: 'hold',
          };
        case 'Release':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: parsedLog.args.assetType,
            amount: parsedLog.args.quantity,
            source: parsedLog.args.sourceFinId,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp,
            operationType: 'release',
          };
        case 'Rollback':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: 'fiat',
            amount: parsedLog.args.quantity,
            destination: parsedLog.args.destinationFinId,
            timestamp: timestamp,
            operationType: 'release',
          };
      }
    } catch (e) {
      // do nothing
    }
  }

  return null;
};


export const isEthereumAddress = (address: string): boolean => {
  return isAddress(address);
};

export const finIdToEthereumAddress = (finId: string): string => {
  return "0x" + keccak256(finId).slice(-40);
}