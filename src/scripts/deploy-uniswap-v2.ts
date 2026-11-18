#!/usr/bin/env node
import { ContractFactory, JsonRpcProvider, Wallet, getCreateAddress } from "ethers";
import factoryArtifact from "@uniswap/v2-core/build/UniswapV2Factory.json";
import routerArtifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";
import wethArtifact from "@uniswap/v2-periphery/build/WETH9.json";

type Artifact = { abi: any[]; bytecode: string };

export type UniswapV2Addresses = {
  weth: string;
  factory: string;
  router: string;
};

const withPrefix = (hex: string) => (hex.startsWith("0x") ? hex : `0x${hex}`);

/**
 * Deploys WETH9, UniswapV2Factory and UniswapV2Router02 from the deployer's
 * first three nonces. A contract that already has code at its expected
 * address is skipped. An unexpected nonce with no code there means the
 * account was used by someone else, which fails the run.
 */
export const deployUniswapV2 = async (
  deployer: Wallet,
  log: (msg: string) => void = console.log,
): Promise<UniswapV2Addresses> => {
  const provider = deployer.provider;
  if (!provider) {
    throw new Error("deployer wallet has no provider");
  }
  const from = await deployer.getAddress();
  const expected = [0, 1, 2].map((nonce) => getCreateAddress({ from, nonce }));
  const steps: { name: string; artifact: Artifact; args: (prev: string[]) => any[] }[] = [
    { name: "WETH9", artifact: wethArtifact, args: () => [] },
    { name: "UniswapV2Factory", artifact: factoryArtifact, args: () => [from] },
    { name: "UniswapV2Router02", artifact: routerArtifact, args: (prev) => [prev[1], prev[0]] },
  ];

  for (const [i, step] of steps.entries()) {
    const address = expected[i];
    if ((await provider.getCode(address)) !== "0x") {
      log(`${step.name} already deployed at ${address}`);
      continue;
    }
    const nonce = await provider.getTransactionCount(from, "latest");
    if (nonce !== i) {
      throw new Error(
        `${step.name}: deployer ${from} is at nonce ${nonce}, expected ${i} with no code at ${address}; the account was used elsewhere`,
      );
    }
    log(`Deploying ${step.name}...`);
    const factory = new ContractFactory(step.artifact.abi, withPrefix(step.artifact.bytecode), deployer);
    const contract = await factory.deploy(...step.args(expected));
    await contract.waitForDeployment();
    const deployed = await contract.getAddress();
    if (deployed !== address) {
      throw new Error(`${step.name} deployed at ${deployed}, expected ${address}`);
    }
    log(`${step.name} deployed at ${deployed}`);
  }

  const [weth, factory, router] = expected;
  return { weth, factory, router };
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
};

// cacheTimeout -1: the nonce check must see each mined deployment.
export const NO_CACHE = { cacheTimeout: -1 };

const main = async () => {
  const provider = new JsonRpcProvider(requireEnv("RPC_URL"), undefined, NO_CACHE);
  const deployer = new Wallet(requireEnv("DEPLOYER_PRIVATE_KEY"), provider);
  const { weth, factory, router } = await deployUniswapV2(deployer);
  console.log(`WETH9: ${weth}`);
  console.log(`UniswapV2Factory: ${factory}`);
  console.log(`UniswapV2Router02: ${router}`);
  console.log("OK");
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
