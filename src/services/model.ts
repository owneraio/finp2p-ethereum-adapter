import { EIP712LoanTerms, OperationParams, Term } from "../../finp2p-contracts";

export type EIP712Params = {
  buyerFinId: string,
  sellerFinId: string,
  asset: Term,
  settlement: Term,
  loan: EIP712LoanTerms,
  params: OperationParams
};

export class RequestValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}
