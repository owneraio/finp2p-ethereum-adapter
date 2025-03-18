export type OssAsset = {
  id: string,
  name: string,
  type: string,
  organizationId: string,
  denomination: {
    code: string
  },
  issuerId: string,
  config: string,
  allowedIntents: string[],
  regulationVerifiers: {
    id: string,
    name: string,
    provider: string
  }[]
  policies: {
    proof: Proof
  }
  certificates: {
    nodes: {
      id: string,
      profileId: string,
      type: string,
      data: string,
      expiry: number
    }[]
  }
  ledgerAssetInfo: {
    tokenId: string
  }
};

export type OssAssetNodes = {
  assets: {
    nodes: OssAsset[]
  }
};

export type OssOwner = {
  id: string,
  name: string,
  finIds: string[]
  organizationId: string,
  certificates: {
    nodes: {
      id: string,
      profileId: string,
      type: string,
      data: string,
      expiry: number
    }[]
  }
  holdings:  {
    nodes: {
      assetType: string,
      asset: { resourceId: string },
      // asset: { symbol: string } | { code: string } | { resourceId: string },
      balance: string,
    }[]
  }
  metadata: {
    acl: string[]
  }
};

export type OssOwnerNodes = {
  users: {
    nodes: OssOwner[]
  }
};

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
      return null
    }

    const obj: Record<string, unknown> = {};

    for (const key in rawObject) {
      if (Object.prototype.hasOwnProperty.call(rawObject, key)) {
        obj[key.toLowerCase()] = (rawObject as any)[key];
      }
    }

    const verifyingContract = obj["verifyingcontract"] as string;
    let chainId: number
    const chainIdVal = obj["chainid"];
    if (!verifyingContract || !chainIdVal) {
      return null;
    }
    if (typeof chainIdVal !== "number") {
      chainId = parseInt(chainIdVal as string);
    } else {
      chainId = chainIdVal;
    }
    return {
      chainId,
      verifyingContract,
    };
}