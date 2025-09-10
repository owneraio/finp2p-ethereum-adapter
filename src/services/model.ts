import { EIP712LoanTerms, OperationParams, Term } from "../../finp2p-contracts/src/contracts";

export type EIP712Params = {
  buyerFinId: string,
  sellerFinId: string,
  asset: Term,
  settlement: Term,
  loan: EIP712LoanTerms,
  params: OperationParams
};

export type AssetCreationPolicy = | { type: "deploy-new-token"; decimals: number } | {
  type: "reuse-existing-token";
  tokenAddress: string
} | { type: "no-deployment" };

export class RequestValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}
