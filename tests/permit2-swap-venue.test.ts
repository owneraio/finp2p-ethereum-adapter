import { ERC20__factory } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { Logger, mirrored, SwapIntent } from "@owneraio/finp2p-ethereum-adapter-contract";
import {
  PERMIT2_ADDRESS,
  Permit2Swap,
  setupLocal,
} from "@owneraio/finp2p-ethereum-permit2-swap";
import { Contract, hexlify, JsonRpcProvider, NonceManager, parseUnits, randomBytes, Signer, TypedDataDomain, Wallet } from "ethers";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import { Permit2SwapVenue } from "../src/permit2-swap-venue";
import { HardhatLogExtractor } from "./utils/log-extractors";

const OPERATOR_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DECIMALS = 2;
const TEN = parseUnits("10", DECIMALS);
const FIVE = parseUnits("5", DECIMALS);

const PERMIT2_ABI = [
  "function permit(address owner, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes signature)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
];

const PERMIT_TYPES = {
  PermitDetails: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
    { name: "nonce", type: "uint48" },
  ],
  PermitSingle: [
    { name: "details", type: "PermitDetails" },
    { name: "spender", type: "address" },
    { name: "sigDeadline", type: "uint256" },
  ],
};

const logs: string[] = [];
const logger: Logger = {
  info: (m: string) => logs.push(m),
  warn: (m: string) => logs.push(`WARN ${m}`),
  error: (m: string) => logs.push(`ERROR ${m}`),
  debug: () => undefined,
} as Logger;

describe("Permit2SwapVenue on a hardhat node", () => {
  let container: StartedTestContainer;
  let provider: JsonRpcProvider;
  let nonceManager: NonceManager;
  let operator: Signer;
  let swapAddress: string;
  let permit2: Contract;
  let domain: TypedDataDomain;
  let venue: Permit2SwapVenue;
  let wallet: { provider: JsonRpcProvider; signer: Signer };

  const funded = async (): Promise<Wallet> => {
    const account = new Wallet(Wallet.createRandom().privateKey, provider);
    await provider.send("hardhat_setBalance", [account.address, "0x56bc75e2d63100000"]);
    return account;
  };

  const newSwap = async () => {
    const [alice, bob] = [await funded(), await funded()];
    const tokenFactory = new ERC20__factory(operator);
    const operatorAddress = await operator.getAddress();
    const tokenX = await tokenFactory.deploy("Token X", "TKX", DECIMALS, operatorAddress);
    const tokenY = await tokenFactory.deploy("Token Y", "TKY", DECIMALS, operatorAddress);
    await (await tokenX.mint(alice.address, parseUnits("100", DECIMALS))).wait();
    await (await tokenY.mint(bob.address, parseUnits("50", DECIMALS))).wait();
    await (await tokenX.connect(alice).approve(PERMIT2_ADDRESS, parseUnits("1000", DECIMALS))).wait();
    await (await tokenY.connect(bob).approve(PERMIT2_ADDRESS, parseUnits("1000", DECIMALS))).wait();
    const intent: SwapIntent = {
      operationId: hexlify(randomBytes(16)),
      give: { token: await tokenX.getAddress(), party: alice.address, amount: TEN },
      take: { token: await tokenY.getAddress(), party: bob.address, amount: FIVE },
    };
    return { alice, bob, tokenX, tokenY, intent };
  };

  // Signs a PermitSingle for the swap contract and submits it to Permit2
  const grant = async (owner: Wallet, token: string, amount: bigint) => {
    const [, , nonce] = await permit2.allowance(owner.address, token, swapAddress);
    const now = (await provider.getBlock("latest"))!.timestamp;
    const permitSingle = {
      details: { token, amount, expiration: now + 3600, nonce },
      spender: swapAddress,
      sigDeadline: now + 3600,
    };
    const signature = await owner.signTypedData(domain, PERMIT_TYPES, permitSingle);
    await (await (permit2.connect(operator) as Contract).permit(owner.address, permitSingle, signature)).wait();
  };

  beforeAll(async () => {
    const extractor = new HardhatLogExtractor();
    container = await new GenericContainer("ghcr.io/owneraio/hardhat:task-fix-docker-build")
      .withLogConsumer((stream) => extractor.consume(stream))
      .withExposedPorts(8545)
      .start();
    await extractor.started();
    // no read cache: the nonce lookups after a reset must see the chain
    provider = new JsonRpcProvider(`http://${container.getHost()}:${container.getMappedPort(8545)}`, undefined, { cacheTimeout: -1 });
    nonceManager = new NonceManager(new Wallet(OPERATOR_KEY)).connect(provider) as NonceManager;
    operator = nonceManager;

    // the same path an ops deploy job runs on a local chain
    const result = await setupLocal(provider, await funded());
    swapAddress = result.permit2Swap;
    permit2 = new Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
    const { chainId } = await provider.getNetwork();
    domain = { name: "Permit2", chainId, verifyingContract: PERMIT2_ADDRESS };
    venue = new Permit2SwapVenue(swapAddress, PERMIT2_ADDRESS);
    wallet = { provider, signer: operator };
  });

  afterAll(async () => {
    provider?.destroy();
    await container?.stop();
  });

  beforeEach(() => {
    logs.length = 0;
  });

  // a reverted submission leaves the nonce manager one ahead of the chain
  afterEach(() => {
    nonceManager.reset();
  });

  test("the entry point is Permit2 and the swap contract is a separate address", () => {
    expect(venue.venueAddress).toBe(PERMIT2_ADDRESS);
    expect(venue.swapAddress).toBe(swapAddress);
    expect(swapAddress).not.toBe(PERMIT2_ADDRESS);
  });

  test("settles both legs from two signed Permit2 allowances and the mirrored side resumes from the event", async () => {
    const { alice, bob, tokenX, tokenY, intent } = await newSwap();
    await grant(alice, intent.give.token, intent.give.amount);
    await grant(bob, intent.take.token, intent.take.amount);

    const first = await venue.swap(wallet, intent, logger);
    expect(first.status).toBe("executed");
    expect(await tokenX.balanceOf(bob.address)).toBe(TEN);
    expect(await tokenY.balanceOf(alice.address)).toBe(FIVE);

    logs.length = 0;
    const second = await venue.swap(wallet, mirrored(intent), logger);
    expect(second).toEqual(first);
    expect(logs.some((m) => m.includes("already executed"))).toBe(true);
    expect(logs.some((m) => m.startsWith("WARN") && m.includes("relays for"))).toBe(false);
  });

  test("both sides calling at once end in one transaction", async () => {
    const { alice, bob, intent } = await newSwap();
    await grant(alice, intent.give.token, intent.give.amount);
    await grant(bob, intent.take.token, intent.take.amount);

    const [a, b] = await Promise.all([
      venue.swap(wallet, intent, logger),
      venue.swap(wallet, mirrored(intent), logger),
    ]);
    expect(a.status).toBe("executed");
    expect(b).toEqual(a);
  });

  test("resumes without sending a transaction when the swap already executed", async () => {
    const { alice, bob, intent } = await newSwap();
    await grant(alice, intent.give.token, intent.give.amount);
    await grant(bob, intent.take.token, intent.take.amount);
    const contract = new Permit2Swap(swapAddress, operator);
    const direct = await contract.executeSwap(intent.operationId, {
      token: intent.give.token, party: intent.give.party, amount: intent.give.amount,
      counterToken: intent.take.token, counterParty: intent.take.party, counterAmount: intent.take.amount,
    });
    const nonceBefore = await provider.getTransactionCount(await operator.getAddress());

    const result = await venue.swap(wallet, intent, logger);
    expect(result).toEqual({
      status: "executed", transactionId: direct.transactionHash,
      blockNumber: direct.blockNumber, timestamp: direct.timestamp,
    });
    expect(await provider.getTransactionCount(await operator.getAddress())).toBe(nonceBefore);
  });

  test("a revert after losing the race resumes with the winning transaction", async () => {
    const { alice, bob, intent } = await newSwap();
    await grant(alice, intent.give.token, intent.give.amount);
    await grant(bob, intent.take.token, intent.take.amount);
    const winner = await venue.swap(wallet, intent, logger);

    // the pre-check still sees an unexecuted swap, so the submission reverts
    const precheck = jest.spyOn(Permit2Swap.prototype, "isExecuted").mockResolvedValueOnce(false);
    const result = await venue.swap(wallet, mirrored(intent), logger);
    precheck.mockRestore();

    expect(result).toEqual(winner);
    expect(logs.some((m) => m.includes("lost the race"))).toBe(true);
  });

  test("fails with the revert reason and moves nothing when no allowance was submitted", async () => {
    const { alice, bob, tokenX, tokenY, intent } = await newSwap();

    const result = await venue.swap(wallet, intent, logger);
    expect(result.status).toBe("failure");
    expect(JSON.stringify(result)).toContain(`permit2-swap ${intent.operationId}: submission failed`);
    expect(await tokenX.balanceOf(alice.address)).toBe(parseUnits("100", DECIMALS));
    expect(await tokenY.balanceOf(bob.address)).toBe(parseUnits("50", DECIMALS));
  });

  test("warns that the operator relays for the party", async () => {
    const { intent } = await newSwap();
    await venue.swap(wallet, intent, logger);
    expect(logs.some((m) => m.startsWith("WARN") && m.includes(`relays for ${intent.give.party}`))).toBe(true);
  });
});
