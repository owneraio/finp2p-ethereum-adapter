import { Destination, Source, LegType, PrimaryType, ValidationError } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { BusinessContract } from "./model";
import { Phase } from "@owneraio/finp2p-contracts";


export const validateRequest = (source: Source, destination: Destination | undefined, quantity: string, businessDetails: BusinessContract): void => {
  const {
    buyerFinId,
    sellerFinId,
    asset,
    settlement,
    loan,
    params: { eip712PrimaryType, phase, leg }
  } = businessDetails;
  if (eip712PrimaryType === PrimaryType.Loan) {
    switch (phase) {
      case Phase.Initiate:
        switch (leg) {
          case LegType.Asset:
            if (destination && buyerFinId !== destination.finId) {
              throw new ValidationError(`Buyer FinId in the signature does not match the destination FinId`);
            }
            if (sellerFinId !== source.finId) {
              throw new ValidationError(`Seller FinId in the signature does not match the source FinId`);
            }
            if (quantity !== asset.amount) {
              throw new ValidationError(`Quantity in the signature does not match the requested quantity`);
            }
            break;
          case LegType.Settlement:
            if (destination && sellerFinId !== destination.finId) {
              throw new ValidationError(`Seller FinId in the signature does not match the destination FinId`);
            }
            if (buyerFinId !== source.finId) {
              throw new ValidationError(`Buyer FinId in the signature does not match the source FinId`);
            }
            if (quantity !== loan.borrowedMoneyAmount) {
              throw new ValidationError(`BorrowedMoneyAmount in the signature does not match the requested quantity`);
            }
            break;
        }
        break;
      case Phase.Close:
        switch (leg) {
          case LegType.Asset:
            if (destination && sellerFinId !== destination.finId) {
              throw new ValidationError(`Seller FinId in the signature does not match the destination FinId`);
            }
            if (buyerFinId !== source.finId) {
              throw new ValidationError(`Buyer FinId in the signature does not match the source FinId`);
            }
            if (quantity !== asset.amount) {
              throw new ValidationError(`Quantity in the signature does not match the requested quantity`);
            }
            break;
          case LegType.Settlement:
            if (destination && buyerFinId !== destination.finId) {
              throw new ValidationError(`Buyer FinId in the signature does not match the destination FinId`);
            }
            if (sellerFinId !== source.finId) {
              throw new ValidationError(`Seller FinId in the signature does not match the source FinId`);
            }
            if (quantity !== loan.returnedMoneyAmount) {
              throw new ValidationError(`ReturnedMoneyAmount in the signature does not match the requested quantity`);
            }
            break;
        }
    }
  } else {
    switch (leg) {
      case LegType.Asset:
        if (destination && buyerFinId !== destination.finId) {
          throw new ValidationError(`Buyer FinId in the signature does not match the destination FinId`);
        }
        if (sellerFinId !== source.finId) {
          throw new ValidationError(`Seller FinId in the signature does not match the source FinId`);
        }
        if (quantity !== asset.amount) {
          throw new ValidationError(`Quantity in the signature does not match the requested quantity`);
        }
        break;
      case LegType.Settlement:
        if (destination && sellerFinId !== destination.finId) {
          throw new ValidationError(`Seller FinId in the signature does not match the destination FinId`);
        }
        if (buyerFinId !== source.finId) {
          throw new ValidationError(`Buyer FinId in the signature does not match the source FinId`);
        }
        if (quantity !== settlement.amount) {
          throw new ValidationError(`Quantity in the signature does not match the requested quantity`);
        }
        break;
    }
  }


};
