import { LedgerAPIClient } from "@owneraio/adapter-tests/dist/api/api";
import { TestHelpers } from "@owneraio/adapter-tests/dist/utils/test-assertions";
import { randomBytes } from "crypto";

const dummySignature = {
  signature: "00".repeat(64),
  template: {
    type: "hashList" as const,
    hash: "00".repeat(32),
    hashGroups: [],
  },
  hashFunc: "keccak-256",
};

declare const global: {
  serverAddress: string;
  vaultFinId: string;
  vaultAddress: string;
  destFinId: string;
};

const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

function source(finId: string) {
  return {
    finId,
    account: { type: "finId" as const, finId },
  };
}

describe("Dfns USDC Test", () => {
  let client: LedgerAPIClient;
  let vaultFinId: string;
  let destFinId: string;
  const asset = { type: "finp2p" as const, resourceId: "bank-id:102:usdc-sepolia" };

  beforeAll(async () => {
    client = new LedgerAPIClient(global.serverAddress);
    vaultFinId = global.vaultFinId as string;
    destFinId = global.destFinId as string;

    // Register USDC as a bound asset via adapter API (binds to existing token, no new ERC20 deploy)
    await TestHelpers.createAssetAndWait(client, {
      asset,
      ledgerAssetBinding: {
        type: "tokenId",
        tokenId: USDC_SEPOLIA,
      },
    });
  });

  it("should have USDC balance for wallet", async () => {
    const balance = await client.common.getBalance({
      asset,
      owner: source(vaultFinId),
    });
    console.log("USDC Balance:", balance.balance);
    expect(parseFloat(balance.balance)).toBeGreaterThan(0);
  });

  it("should transfer USDC to another wallet", async () => {
    const amount = "1";

    const initialBalance = await client.common.getBalance({
      asset,
      owner: source(vaultFinId),
    });
    console.log("Initial source balance:", initialBalance.balance);

    const receipt = await TestHelpers.transferAndGetReceipt(client, {
      nonce: randomBytes(16).toString("hex"),
      source: source(vaultFinId),
      destination: source(destFinId),
      quantity: amount,
      asset,
      settlementRef: "",
      signature: dummySignature as any,
    });

    console.log("Transfer receipt:", receipt.id);
    expect(receipt.operationType).toBe("transfer");

    const finalBalance = await client.common.getBalance({
      asset,
      owner: source(vaultFinId),
    });
    console.log("Final source balance:", finalBalance.balance);

    expect(parseFloat(finalBalance.balance)).toBe(
      parseFloat(initialBalance.balance) - parseFloat(amount)
    );

    const destBalance = await client.common.getBalance({
      asset,
      owner: source(destFinId),
    });
    console.log("Destination balance:", destBalance.balance);
    expect(parseFloat(destBalance.balance)).toBe(parseFloat(amount));
  });
});
