
export type ProofDomain = {
  chainId: number,
  verifyingContract: string
}

export type Proof = {
  type: 'NoProofPolicy'
} | {
  type: 'SignatureProofPolicy',
  verifyingKey: string,
  signatureTemplate: string,
}

export type ProofPolicy = {
  type: 'NoProofPolicy'
} | {
  type: 'SignatureProofPolicy',
  verifyingKey: string,
  signatureTemplate: string,
  domain: ProofDomain | null
}


export const parseProofDomain = (jsonString: string): ProofDomain | null => {
    const rawObject: unknown = JSON.parse(jsonString);

    if (typeof rawObject !== "object" || rawObject === null) {
      throw new Error("Invalid JSON structure");
    }

    const obj: Record<string, unknown> = {};

    for (const key in rawObject) {
      if (Object.prototype.hasOwnProperty.call(rawObject, key)) {
        obj[key.toLowerCase()] = (rawObject as any)[key];
      }
    }

    if (
      typeof obj["chainid"] !== "number" ||
      typeof obj["verifyingcontract"] !== "string"
    ) {
      throw new Error("Missing or invalid fields");
    }

    return {
      chainId: obj["chainid"],
      verifyingContract: obj["verifyingcontract"],
    };
}