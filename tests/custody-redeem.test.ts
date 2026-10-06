import winston from "winston";
import { ZeroAddress } from "ethers";
import { ReleaseType, TokenStandard } from "@owneraio/finp2p-ethereum-adapter-contract";
import { tokenStandardRegistry } from "../src/integrations/token-standards/registry";
import { CustodyTokenService } from "../src/services/custody/token-service";

const ESCROW_ADDRESS = "0x" + "ee".repeat(20);
const INVESTOR_ADDRESS = "0x" + "11".repeat(20);
const INVESTOR_FINID = "02" + "aa".repeat(32);

const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });

const wallet = (address: string) => ({ signer: { getAddress: async () => address } }) as any;

const ok = { status: "success", transactionId: "0xtx", timestamp: 1 } as const;

type MockedStandard = TokenStandard & { burn: jest.Mock; release: jest.Mock };

function mockStandard(): MockedStandard {
  return {
    burn: jest.fn().mockResolvedValue(ok),
    release: jest.fn().mockResolvedValue(ok),
  } as unknown as MockedStandard;
}

const escrowStandard = mockStandard();
const holderStandard = mockStandard();
tokenStandardRegistry.register("REDEEM_TEST_ESCROW", escrowStandard);
tokenStandardRegistry.register("REDEEM_TEST_HOLDER", holderStandard, "holder-reservation");

function service(tokenStandard: string): CustodyTokenService {
  const assetStore = {
    getAsset: async () => ({ contract_address: "0x" + "cc".repeat(20), decimals: 2, token_standard: tokenStandard }),
    saveAsset: async () => {},
  } as any;
  const accountMapping = {
    resolveAccount: async (finId: string) => (finId === INVESTOR_FINID ? INVESTOR_ADDRESS : undefined),
  } as any;
  const custodyProvider = {
    resolveWallet: async (address: string) => (address === INVESTOR_ADDRESS ? wallet(INVESTOR_ADDRESS) : undefined),
  } as any;
  return new CustodyTokenService(logger, custodyProvider, wallet(ESCROW_ADDRESS), {} as any, accountMapping, assetStore, undefined);
}

const ASSET = { assetId: "bank-us:102:asset-1", assetType: "finp2p" } as any;
const SOURCE = { finId: INVESTOR_FINID } as any;
const EX_CTX = { planId: "bank-us:106:plan-1", sequence: 1 } as any;
const NO_SIGNATURE = undefined as any;

beforeEach(() => jest.clearAllMocks());

describe("CustodyTokenService.redeem — holder-reservation standard (hold stays on the investor's account)", () => {

  test("redeem with an operationId settles via release(ReleaseType.Redeem) authorized by the escrow wallet", async () => {
    const receipt = await service("REDEEM_TEST_HOLDER")
      .redeem("ik", "nonce", SOURCE, ASSET, "1.0", "op-1", NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("success");
    expect(holderStandard.burn).not.toHaveBeenCalled();
    expect(holderStandard.release).toHaveBeenCalledTimes(1);
    const [escrowWallet, , to, amount, , opCtx] = holderStandard.release.mock.calls[0];
    expect(await escrowWallet.signer.getAddress()).toBe(ESCROW_ADDRESS);
    expect(to).toBe(ZeroAddress);
    expect(amount).toBe(100n);
    expect(opCtx?.releaseType).toBe(ReleaseType.Redeem);
    expect(opCtx?.operationId).toBe("op-1");
  });

  test("redeem without an operationId still burns from the investor's own wallet", async () => {
    const receipt = await service("REDEEM_TEST_HOLDER")
      .redeem("ik", "nonce", SOURCE, ASSET, "1.0", undefined, NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("success");
    expect(holderStandard.release).not.toHaveBeenCalled();
    expect(holderStandard.burn).toHaveBeenCalledTimes(1);
    const [investorWallet, , from] = holderStandard.burn.mock.calls[0];
    expect(await investorWallet.signer.getAddress()).toBe(INVESTOR_ADDRESS);
    expect(from).toBe(INVESTOR_ADDRESS);
  });
});

describe("CustodyTokenService.redeem — escrow-transfer standard (hold moved the tokens into escrow)", () => {

  test("redeem with an operationId keeps burning from the escrow wallet", async () => {
    const receipt = await service("REDEEM_TEST_ESCROW")
      .redeem("ik", "nonce", SOURCE, ASSET, "1.0", "op-1", NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("success");
    expect(escrowStandard.release).not.toHaveBeenCalled();
    expect(escrowStandard.burn).toHaveBeenCalledTimes(1);
    const [escrowWallet, , from, amount, , opCtx] = escrowStandard.burn.mock.calls[0];
    expect(await escrowWallet.signer.getAddress()).toBe(ESCROW_ADDRESS);
    expect(from).toBe(ESCROW_ADDRESS);
    expect(amount).toBe(100n);
    expect(opCtx?.releaseType).toBe(ReleaseType.Redeem);
    expect(opCtx?.operationId).toBe("op-1");
  });

  test("redeem without an operationId burns from the investor's own wallet", async () => {
    const receipt = await service("REDEEM_TEST_ESCROW")
      .redeem("ik", "nonce", SOURCE, ASSET, "1.0", undefined, NO_SIGNATURE, EX_CTX);

    expect(receipt.type).toBe("success");
    expect(escrowStandard.release).not.toHaveBeenCalled();
    const [investorWallet, , from] = escrowStandard.burn.mock.calls[0];
    expect(await investorWallet.signer.getAddress()).toBe(INVESTOR_ADDRESS);
    expect(from).toBe(INVESTOR_ADDRESS);
  });
});

describe("tokenStandardRegistry hold model", () => {

  test("defaults to escrow-transfer and reports what was registered", () => {
    expect(tokenStandardRegistry.holdModel("REDEEM_TEST_ESCROW")).toBe("escrow-transfer");
    expect(tokenStandardRegistry.holdModel("REDEEM_TEST_HOLDER")).toBe("holder-reservation");
    expect(tokenStandardRegistry.holdModel("redeem_test_holder")).toBe("holder-reservation"); // case-insensitive
    expect(() => tokenStandardRegistry.holdModel("NEVER_REGISTERED")).toThrow(/Unknown token standard/);
  });
});
