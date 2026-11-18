import { Contract, ContractFactory, JsonRpcProvider, Wallet, parseEther } from "ethers";
import { GenericContainer, StartedTestContainer } from "testcontainers";
import erc20Artifact from "@uniswap/v2-core/build/ERC20.json";
import factoryArtifact from "@uniswap/v2-core/build/UniswapV2Factory.json";
import routerArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import { NO_CACHE, deployUniswapV2 } from "../src/scripts/deploy-uniswap-v2";
import { HardhatLogExtractor } from "./utils/log-extractors";

const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

describe("Uniswap v2 offline deploy", () => {
  let container: StartedTestContainer;
  let provider: JsonRpcProvider;
  const silent = () => {};

  beforeAll(async () => {
    const logExtractor = new HardhatLogExtractor();
    container = await new GenericContainer("ghcr.io/owneraio/hardhat:task-fix-docker-build")
      .withLogConsumer((stream) => logExtractor.consume(stream))
      .withExposedPorts(8545)
      .start();
    await logExtractor.started();
    provider = new JsonRpcProvider(`http://${container.getHost()}:${container.getMappedPort(8545)}`, undefined, NO_CACHE);
  });

  afterAll(async () => {
    provider?.destroy();
    await container?.stop();
  });

  const deployErc20 = async (signer: Wallet) => {
    const token = await new ContractFactory(erc20Artifact.abi, `0x${erc20Artifact.bytecode}`, signer).deploy(
      parseEther("1000000"),
    );
    await token.waitForDeployment();
    return token;
  };

  test("deploys WETH, factory and router, creates a pair and adds liquidity", async () => {
    const deployer = new Wallet(DEPLOYER_KEY, provider);
    const { weth, factory, router } = await deployUniswapV2(deployer, silent);

    for (const address of [weth, factory, router]) {
      expect(await provider.getCode(address)).not.toBe("0x");
    }
    const factoryContract = new Contract(factory, factoryArtifact.abi, provider);
    const routerContract = new Contract(router, routerArtifact.abi, deployer);
    expect(await factoryContract.feeToSetter()).toBe(deployer.address);
    expect(await routerContract.factory()).toBe(factory);
    expect(await routerContract.WETH()).toBe(weth);

    const tokenA = await deployErc20(deployer);
    const tokenB = await deployErc20(deployer);
    const [a, b] = [await tokenA.getAddress(), await tokenB.getAddress()];
    await (await factoryContract.connect(deployer).getFunction("createPair")(a, b)).wait();
    expect(await factoryContract.getPair(a, b)).not.toBe("0x0000000000000000000000000000000000000000");

    // addLiquidity resolves the pair through the router's hardcoded init code hash.
    const amount = parseEther("100");
    await (await tokenA.getFunction("approve")(router, amount)).wait();
    await (await tokenB.getFunction("approve")(router, amount)).wait();
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const tx = await routerContract.addLiquidity(a, b, amount, amount, 0, 0, deployer.address, deadline);
    await tx.wait();
  });

  test("second run is a no-op", async () => {
    const deployer = new Wallet(DEPLOYER_KEY, provider);
    const before = await provider.getTransactionCount(deployer.address);
    await deployUniswapV2(deployer, silent);
    expect(await provider.getTransactionCount(deployer.address)).toBe(before);
  });

  test("fails when the deployer account was already used", async () => {
    const other = new Wallet(OTHER_KEY, provider);
    await (await other.sendTransaction({ to: Wallet.createRandom().address, value: 1n })).wait();
    await expect(deployUniswapV2(other, silent)).rejects.toThrow(/used elsewhere/);
  });
});
