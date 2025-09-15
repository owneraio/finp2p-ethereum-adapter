import { Destination, Source } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { EIP712Params, RequestValidationError } from "./model";
import { LegType, Phase, PrimaryType } from "../../finp2p-contracts/src";


export const validateRequest = (source: Source, destination: Destination | undefined, quantity: string, eip712Params: EIP712Params): void => {
  const {
    buyerFinId,
    sellerFinId,
    asset,
    settlement,
    loan,
    params: { eip712PrimaryType, phase, leg }
  } = eip712Params;
  if (eip712PrimaryType === PrimaryType.Loan) {
    switch (phase) {
      case Phase.Initiate:
        switch (leg) {
          case LegType.Asset:
            if (destination && buyerFinId !== destination.finId) {
              throw new RequestValidationError(`Buyer FinId in the signature does not match the destination FinId`);
            }
            if (sellerFinId !== source.finId) {
              throw new RequestValidationError(`Seller FinId in the signature does not match the source FinId`);
            }
            if (quantity !== asset.amount) {
              throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
            }
            break;
          case LegType.Settlement:
            if (destination && sellerFinId !== destination.finId) {
              throw new RequestValidationError(`Seller FinId in the signature does not match the destination FinId`);
            }
            if (buyerFinId !== source.finId) {
              throw new RequestValidationError(`Buyer FinId in the signature does not match the source FinId`);
            }
            if (quantity !== loan.borrowedMoneyAmount) {
              throw new RequestValidationError(`BorrowedMoneyAmount in the signature does not match the requested quantity`);
            }
            break;
        }
        break;
      case Phase.Close:
        switch (leg) {
          case LegType.Asset:
            if (destination && sellerFinId !== destination.finId) {
              throw new RequestValidationError(`Seller FinId in the signature does not match the destination FinId`);
            }
            if (buyerFinId !== source.finId) {
              throw new RequestValidationError(`Buyer FinId in the signature does not match the source FinId`);
            }
            if (quantity !== asset.amount) {
              throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
            }
            break;
          case LegType.Settlement:
            if (destination && buyerFinId !== destination.finId) {
              throw new RequestValidationError(`Buyer FinId in the signature does not match the destination FinId`);
            }
            if (sellerFinId !== source.finId) {
              throw new RequestValidationError(`Seller FinId in the signature does not match the source FinId`);
            }
            if (quantity !== loan.returnedMoneyAmount) {
              throw new RequestValidationError(`ReturnedMoneyAmount in the signature does not match the requested quantity`);
            }
            break;
        }
    }
  } else {
    switch (leg) {
      case LegType.Asset:
        if (destination && buyerFinId !== destination.finId) {
          throw new RequestValidationError(`Buyer FinId in the signature does not match the destination FinId`);
        }
        if (sellerFinId !== source.finId) {
          throw new RequestValidationError(`Seller FinId in the signature does not match the source FinId`);
        }
        if (quantity !== asset.amount) {
          throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
        }
        break;
      case LegType.Settlement:
        if (destination && sellerFinId !== destination.finId) {
          throw new RequestValidationError(`Seller FinId in the signature does not match the destination FinId`);
        }
        if (buyerFinId !== source.finId) {
          throw new RequestValidationError(`Buyer FinId in the signature does not match the source FinId`);
        }
        if (quantity !== settlement.amount) {
          throw new RequestValidationError(`Quantity in the signature does not match the requested quantity`);
        }
        break;
    }
  }


};
