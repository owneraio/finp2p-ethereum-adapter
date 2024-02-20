import { FinP2PReceipt } from '../contracts/model';
import Receipt = Components.Schemas.Receipt;



const finIdSource = (finId?: string): Components.Schemas.Source | undefined => {
  if (!finId) {
    return undefined;
  }
  return {
    finId: finId,
    account: {
      type: 'finId',
      finId: finId,
    },
  };
};
const finIdDestination = (finId?: string): Components.Schemas.Destination | undefined => {
  if (!finId) {
    return undefined;
  }
  return {
    finId: finId,
    account: {
      type: 'finId',
      finId: finId,
    },
  };
};

export const receiptToAPI = (receipt: FinP2PReceipt): Receipt => {
  return {
    id: receipt.id,
    asset: {
      type: 'finp2p',
      resourceId: receipt.assetId,
    },
    quantity: `${receipt.amount}`,
    source: finIdSource(receipt.source),
    destination: finIdDestination(receipt.destination),
    transactionDetails: {
      transactionId: receipt.id,
    },
    timestamp: receipt.timestamp,
  };
};