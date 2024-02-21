import { HardhatUserConfig } from "hardhat/types";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.4",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 1337,
      gasPrice: 0,
      hardfork: "berlin",
      blockGasLimit: 10000000
    },
  }
}

export default config;