import { HardhatUserConfig } from "hardhat/types";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true, runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337, gasPrice: 0, hardfork: "berlin", blockGasLimit: 10000000
    }
  }
};

export default config;
