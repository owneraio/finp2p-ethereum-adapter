import * as fs from "fs";

export type EthereumConfig = {
  rpcURL: string;
  deployerPrivateKey: string;
  operatorAddress: string;
  signerPrivateKey: string;
  finP2PContractAddress: string;
}


export const readEthereumConfig = async (configPath: string): Promise<EthereumConfig> => {
  return new Promise((resolve, reject) => {
    fs.readFile(configPath, "utf8", (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(JSON.parse(data));
    });
  });
};

export const writeEthereumConfig = async (configPath: string, config: EthereumConfig): Promise<void> => {
  return new Promise((resolve, reject) => {
    fs.writeFile(configPath, JSON.stringify(config, null, 2), (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
};