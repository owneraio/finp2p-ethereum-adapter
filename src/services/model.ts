
export type SrvAsset = {
  assetId: string
  assetType: "finp2p" | "fiat" | "cryptocurrency"
}

export type Source = {}

export type Destination = {}

export type Signature = {
  signature: string;
  template: SignatureTemplate;
}

export type EIP712Template = {
  type: "EIP712"
  primaryType: string;
  message: EIP722Message;
};

export type SignatureTemplate = EIP712Template


export type EIP722Message = {
  [name: string]: EIP712TypedValue;
}

export type EIP712TypeArray = EIP712TypedValue[];
export type EIP712TypeBool = boolean;
export type EIP712TypeByte = string;
export type EIP712TypeInteger = number;

export interface EIP712TypeObject {
  [name: string]: EIP712TypedValue;
}

export type EIP712TypeString = string;

export type EIP712TypedValue =
  EIP712TypeString
  | EIP712TypeInteger
  | EIP712TypeBool
  | EIP712TypeByte
  | EIP712TypeObject
  | EIP712TypeArray;

export type ExecutionContext = {
  planId: string
  sequence: number
}

export type AssetCreationResult = {
  type: "success";
  tokenId: string;
  tokenAddress: string;
  finp2pTokenAddress: string;
} | {
  type: "failure";
  error: {
    code: number;
    message: string;
  }
}

export const failedAssetCreation = (code: number, message: string): AssetCreationResult => ({
  type: "failure",
  error: { code, message }
});

export const successfulAssetCreation = (tokenId: string, tokenAddress: string, finp2pTokenAddress: string): AssetCreationResult => ({
  type: "success",
  tokenId,
  tokenAddress,
  finp2pTokenAddress
});

export type TransactionResult = {
  type: "success";
  txHash: string;
} | {
  type: "failure";
  error: {
    code: number;
    message: string;
  }
}

export const failedTransaction = (code: number, message: string): TransactionResult => ({
  type: "failure",
  error: { code, message }
});

export const successfulTransaction = (txHash: string): TransactionResult => ({
  type: "success",
  txHash
});

