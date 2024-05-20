import * as fs from "fs";

export type ContractManagerConfig = {
  rpcURL: string;
  signerPrivateKey: string;
};

export type FinP2PDeployerConfig = {
  rpcURL: string;
  deployerPrivateKey: string;
  operatorAddress: string;
};

export type FinP2PContractConfig = ContractManagerConfig & {
  finP2PContractAddress: string;
};


export const readConfig = async <T>(configPath: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    fs.readFile(configPath, "utf8", (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(JSON.parse(data));
    });
  });
};

export const writeConfig = async <T>(configPath: string, config: T): Promise<void> => {
  return new Promise((resolve, reject) => {
    fs.writeFile(configPath, JSON.stringify(config, null, 2), (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
};