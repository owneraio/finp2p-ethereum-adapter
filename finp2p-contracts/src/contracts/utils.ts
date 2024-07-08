import { Interface, TransactionReceipt, Wallet } from 'ethers';
import { FinP2PReceipt } from './model';
import * as secp256k1 from 'secp256k1';

export const privateKeyToFinId = (privateKey: string): string => {
  const privKeyBuffer = Buffer.from(privateKey.replace('0x', ''), 'hex');
  const pubKeyUInt8Array = secp256k1.publicKeyCreate(privKeyBuffer, true);
  return Buffer.from(pubKeyUInt8Array).toString('hex');
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
            assetType: 'finp2p',
            amount: parsedLog.args.quantity,
            destination: parsedLog.args.issuerFinId,
            timestamp: timestamp,
            operationType: 'issue',
          };
        case 'Transfer':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: 'finp2p',
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
            assetType: 'finp2p',
            amount: parsedLog.args.quantity,
            source: parsedLog.args.issuerFinId,
            timestamp: timestamp,
            operationType: 'redeem',
          };
        case 'Hold':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: 'fiat',
            amount: parsedLog.args.quantity,
            source: parsedLog.args.finId,
            timestamp: timestamp,
            operationType: 'hold',
          };
        case 'Release':
          return {
            id: id,
            assetId: parsedLog.args.assetId,
            assetType: 'fiat',
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


export const stringToByte16 = (str: string): string => {
  return '0x' + Buffer.from(str).slice(0, 16).toString('hex').padEnd(32, '0');
};


