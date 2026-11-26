import winston from "winston";
import { AllowanceSwapVenue } from "@owneraio/finp2p-ethereum-allowance-swap";
import { Permit2SwapVenue } from "@owneraio/finp2p-ethereum-permit2-swap";
import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";
import { CustodyTokenService } from "../src/services/custody/token-service";
import { checksOwnDeadline } from "../src/swap-venues";

const A_ADDRESS = "0x" + "11".repeat(20);
const B_ADDRESS = "0x" + "22".repeat(20);
const A_FINID = "02" + "aa".repeat(32);
const B_FINID = "02" + "bb".repeat(32);
const SWAP_ADDRESS = "0x" + "dd".repeat(20);
const TOKEN = "0x" + "99".repeat(20);
const CHAIN_ID = 31337n;

const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
const wallet = (address: string) => ({ signer: { getAddress: async () => address } }) as any;
const executed = { status: "executed", transactionId: "0xtx", blockNumber: 1, timestamp: 1 } as const;

const PAST = Math.floor(Date.now() / 1000) - 3600;
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

const leg = (assetId: string, from: string, to: string) =>
  ({ asset: { assetId, assetType: "finp2p" }, quantity: "1", source: { finId: from }, destination: { finId: to }, signature: {} }) as any;
const asset = leg("a:1", A_FINID, B_FINID);
const settlement = leg("s:1", B_FINID, A_FINID);

const permit2Venue = () => {
  const venue = new Permit2SwapVenue(SWAP_ADDRESS);
  const swap = jest.spyOn(venue, "swap").mockResolvedValue(executed);
  return { venue, swap };
};
const allowanceVenue = () => {
  const venue = new AllowanceSwapVenue(SWAP_ADDRESS);
  const swap = jest.spyOn(venue, "swap").mockResolvedValue(executed);
  return { venue, swap };
};
const named = (venue: any) => [{ name: "Desk", listedAddress: SWAP_ADDRESS, venue }];

const custody = (venue: any) => {
  const addresses: Record<string, string> = { [A_FINID]: A_ADDRESS, [B_FINID]: B_ADDRESS };
  return new CustodyTokenService(
    logger,
    { resolveWallet: async (address: string) => wallet(address) } as any,
    undefined, { getNetwork: async () => ({ chainId: CHAIN_ID }) } as any,
    { resolveAccount: async (finId: string) => addresses[finId] } as any,
    { getAsset: async () => ({ contract_address: TOKEN, decimals: 2, token_standard: "ERC20" }), saveAsset: async () => {} } as any,
    undefined, named(venue),
  );
};

const onchain = (venue: any) => {
  const addresses: Record<string, string> = { [A_FINID]: A_ADDRESS, [B_FINID]: B_ADDRESS };
  const contract = {
    provider: { getNetwork: async () => ({ chainId: CHAIN_ID }) },
    signer: { reset: jest.fn(), increment: jest.fn(), getNonce: jest.fn() },
    finP2PContractAddress: "0x" + "aa".repeat(20),
    getCredentialAddress: async (finId: string) => addresses[finId],
  };
  const svc = new OnChainTokenService(contract as any, undefined, new InMemoryExecDetailsStore(), undefined, undefined, "ERC20", named(venue));
  jest.spyOn(svc as any, "toSwapIntent").mockImplementation(async (operationId: any, _a: any, _s: any, deadline: any) => ({
    operationId,
    give: { token: TOKEN, party: A_ADDRESS, amount: 100n },
    take: { token: TOKEN, party: B_ADDRESS, amount: 100n },
    deadline: deadline || undefined,
  }));
  return svc;
};

type Case = [string, (venue: any) => { swap: (receipts: number, deadline: number) => Promise<any> }];
const services: Case[] = [
  ["custody", (venue) => { const svc = custody(venue); return { swap: (r, d) => svc.swap("ik", "n", "op", asset, settlement, r, d, undefined) as Promise<any> }; }],
  ["on-chain", (venue) => { const svc = onchain(venue); return { swap: (r, d) => svc.swap("ik", "n", "op", asset, settlement, r, d, undefined) as Promise<any> }; }],
];

describe("checksOwnDeadline", () => {
  test.each([
    ["a Permit2 venue", new Permit2SwapVenue(SWAP_ADDRESS), true],
    ["an allowance venue", new AllowanceSwapVenue(SWAP_ADDRESS), false],
    ["no venue", undefined, false],
  ])("%s", (_name, venue, expected) => {
    expect(checksOwnDeadline(venue as any)).toBe(expected);
  });
});

describe.each(services)("%s swap after the deadline", (_service, build) => {
  describe.each([[1], [2]])("with %d receipt(s)", (receipts) => {
    test("a Permit2 venue is still called, so a settled swap reports success", async () => {
      const { venue, swap } = permit2Venue();

      const result = await build(venue).swap(receipts, PAST);

      expect(result.type).toBe("success");
      expect(swap).toHaveBeenCalledTimes(receipts);
      expect(swap.mock.calls[0][1].deadline).toBe(PAST);
    });

    test("a Permit2 venue that refuses the expired swap fails it with the venue's reason", async () => {
      const { venue, swap } = permit2Venue();
      swap.mockResolvedValue({ status: "failure", reason: "deadline passed before the leg was submitted" });

      const result = await build(venue).swap(receipts, PAST);

      expect(result.type).toBe("failure");
      expect(JSON.stringify(result)).toContain("deadline passed before the leg was submitted");
    });

    test("an allowance venue is not called: the service refuses the expired swap", async () => {
      const { venue, swap } = allowanceVenue();

      const result = await build(venue).swap(receipts, PAST);

      expect(result.type).toBe("failure");
      expect(JSON.stringify(result)).toContain(`swap deadline ${PAST} has already passed`);
      expect(swap).not.toHaveBeenCalled();
    });

    test("an allowance venue runs a swap whose deadline is ahead", async () => {
      const { venue, swap } = allowanceVenue();

      const result = await build(venue).swap(receipts, FUTURE);

      expect(result.type).toBe("success");
      expect(swap).toHaveBeenCalledTimes(receipts);
    });
  });
});
