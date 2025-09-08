import { OperationParams, Term } from "../../../finp2p-contracts/src/contracts/model";
import { EIP712LoanTerms } from "../../../finp2p-contracts/src/contracts/eip712";


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
