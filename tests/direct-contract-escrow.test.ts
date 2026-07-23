import { GenericContainer, StartedTestContainer } from "testcontainers";
import { HardhatLogExtractor } from "./utils/log-extractors";
import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import winston, { format, transports } from "winston";
import { ContractsManager, EscrowContract } from "@owneraio/finp2p-ethereum-orchestrator";
import { ContractEscrow } from "../src/services/onchain";
import { CustodyWallet } from "../src/services/custody/custody-provider";

let RPC_URL = "";
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const logger = winston.createLogger({
  level: "error",
  transports: [new transports.Console()],
  format: format.json()
});

const ERC20_ABI = [
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function grantOperatorTo(address account)"
];

jest.setTimeout(180_000);

describe("direct-mode contract escrow (integration)", () => {

  let node: StartedTestContainer;
  let contractEscrow: ContractEscrow;
  let escrowAddress: string;
  let token: Contract;
  let tokenAddress: string;
  let investorWallet: CustodyWallet;
  let investorAddress: string;

  const buyer = Wallet.createRandom();

  beforeAll(async () => {
    const logExtractor = new HardhatLogExtractor();
    node = await new GenericContainer("ghcr.io/owneraio/hardhat:task-fix-docker-build")
      .withLogConsumer((stream) => logExtractor.consume(stream))
      .withExposedPorts(8545)
      .start();
    await logExtractor.started();
    RPC_URL = `http://${node.getHost()}:${node.getMappedPort(8545)}`;

    // cacheTimeout -1: ethers' 250ms response cache returns stale transaction
    // counts against an instant-mining hardhat node, breaking nonce assignment
    // for the raw (non-retrying) approve txs
    const provider = new JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
    const signer = new NonceManager(new Wallet(DEPLOYER_PK)).connect(provider);
    const manager = new ContractsManager(provider, signer, logger);
    // deployer keeps ESCROW_OPERATOR (plays the adapter's escrow-operator wallet)
    escrowAddress = await manager.deployEscrowContract();
    tokenAddress = await manager.deployERC20("Test", "TST", 2, await signer.getAddress());
    token = new Contract(tokenAddress, ERC20_ABI, signer);

    const investorSigner = Wallet.createRandom().connect(provider);
    investorAddress = await investorSigner.getAddress();
    investorWallet = { provider, signer: investorSigner };
    await (await token.mint(investorAddress, 10000)).wait();
    // stand-in for the gas station: fund the investor wallet for approve/deposit
    // txs (sent through the shared NonceManager signer to keep its nonce state consistent)
    const gasTx = await signer.sendTransaction({ to: investorAddress, value: 10n ** 18n });
    await gasTx.wait();

    const escrowContract = new EscrowContract(provider, signer, escrowAddress, logger);
    contractEscrow = new ContractEscrow(escrowContract, logger);
  });

  afterAll(async () => {
    await node?.stop();
  });

  test("hold performs approve + deposit from the investor wallet", async () => {
    const result = await contractEscrow.hold(investorWallet, investorAddress, buyer.address, tokenAddress, "op-1", 3000n);
    expect(result.status === "success" ? "success" : (result as any).reason).toBe("success");
    expect(await token.balanceOf(escrowAddress)).toBe(3000n);
    expect(await token.balanceOf(investorAddress)).toBe(7000n);
  });

  test("double hold under the same operationId fails", async () => {
    const result = await contractEscrow.hold(investorWallet, investorAddress, buyer.address, tokenAddress, "op-1", 1000n);
    expect(result.status).toBe("failure");
  });

  test("release refuses a request whose amount differs from the hold", async () => {
    const result = await contractEscrow.release("op-1", buyer.address, { token: tokenAddress, amount: 1n, source: investorAddress });
    expect(result.status).toBe("failure");
    expect((result as any).reason).toMatch(/is for 3000 token units, not 1/);
    expect(await token.balanceOf(escrowAddress)).toBe(3000n);
  });

  test("release refuses a request for a different token", async () => {
    const result = await contractEscrow.release("op-1", buyer.address, { token: buyer.address, amount: 3000n, source: investorAddress });
    expect(result.status).toBe("failure");
    expect((result as any).reason).toMatch(/is for token/);
  });

  test("release refuses a request from a different source", async () => {
    const stranger = Wallet.createRandom();
    const result = await contractEscrow.release("op-1", buyer.address, { token: tokenAddress, amount: 3000n, source: stranger.address });
    expect(result.status).toBe("failure");
    expect((result as any).reason).toMatch(/source is/);
  });

  test("release pays the pinned destination", async () => {
    const result = await contractEscrow.release("op-1", buyer.address, { token: tokenAddress, amount: 3000n, source: investorAddress });
    expect(result.status === "success" ? "success" : (result as any).reason).toBe("success");
    expect(await token.balanceOf(buyer.address)).toBe(3000n);
    expect(await token.balanceOf(escrowAddress)).toBe(0n);
  });

  test("release to a different destination fails", async () => {
    await contractEscrow.hold(investorWallet, investorAddress, buyer.address, tokenAddress, "op-2", 1000n);
    const stranger = Wallet.createRandom();
    const wrong = await contractEscrow.release("op-2", stranger.address, { token: tokenAddress, amount: 1000n, source: investorAddress });
    expect(wrong.status).toBe("failure");
  });

  test("rollback refuses a request from a different source", async () => {
    const stranger = Wallet.createRandom();
    const result = await contractEscrow.rollback("op-2", { token: tokenAddress, amount: 1000n, source: stranger.address });
    expect(result.status).toBe("failure");
    expect((result as any).reason).toMatch(/source is/);
  });

  test("rollback returns funds to the source", async () => {
    const result = await contractEscrow.rollback("op-2", { token: tokenAddress, amount: 1000n, source: investorAddress });
    expect(result.status === "success" ? "success" : (result as any).reason).toBe("success");
    expect(await token.balanceOf(investorAddress)).toBe(7000n);
  });

  test("pre-approved allowance is reused without a second approve", async () => {
    const erc20AsInvestor = new Contract(tokenAddress, ["function approve(address spender, uint256 amount)"], investorWallet.signer);
    await (await erc20AsInvestor.approve(escrowAddress, 5000n)).wait();
    const result = await contractEscrow.hold(investorWallet, investorAddress, buyer.address, tokenAddress, "op-3", 2000n);
    expect(result.status === "success" ? "success" : (result as any).reason).toBe("success");
    // allowance decreased by exactly the deposit — no re-approve happened
    expect(await token.allowance(investorAddress, escrowAddress)).toBe(3000n);
  });

  test("releaseAndBurn refuses a mismatched amount", async () => {
    const result = await contractEscrow.releaseAndBurn("op-3", { token: tokenAddress, amount: 5n, source: investorAddress });
    expect(result.status).toBe("failure");
  });

  test("releaseAndBurn refuses a request from a different source", async () => {
    const stranger = Wallet.createRandom();
    const result = await contractEscrow.releaseAndBurn("op-3", { token: tokenAddress, amount: 2000n, source: stranger.address });
    expect(result.status).toBe("failure");
    expect((result as any).reason).toMatch(/source is/);
  });

  test("releaseAndBurn burns the held amount", async () => {
    const supplyBefore = await token.totalSupply();
    const result = await contractEscrow.releaseAndBurn("op-3", { token: tokenAddress, amount: 2000n, source: investorAddress });
    expect(result.status === "success" ? "success" : (result as any).reason).toBe("success");
    expect(await token.totalSupply()).toBe(supplyBefore - 2000n);
  });

  test("a destinationless hold cannot be released, only burned or rolled back", async () => {
    const result = await contractEscrow.hold(investorWallet, investorAddress, undefined, tokenAddress, "op-4", 500n);
    expect(result.status === "success" ? "success" : (result as any).reason).toBe("success");

    const release = await contractEscrow.release("op-4", buyer.address, { token: tokenAddress, amount: 500n, source: investorAddress });
    expect(release.status).toBe("failure");
    expect((release as any).reason).toMatch(/no destination/);

    const rollback = await contractEscrow.rollback("op-4", { token: tokenAddress, amount: 500n, source: investorAddress });
    expect(rollback.status === "success" ? "success" : (rollback as any).reason).toBe("success");
  });

  test("terminal ops refuse an unknown hold", async () => {
    const result = await contractEscrow.rollback("no-such-op", { token: tokenAddress, amount: 1n });
    expect(result.status).toBe("failure");
    expect((result as any).reason).toMatch(/not found|not active/);
  });
});
