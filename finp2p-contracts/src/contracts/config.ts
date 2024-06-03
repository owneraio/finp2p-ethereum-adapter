import * as fs from "fs";

export type ContractManagerConfig = {
  rpcURL: string;
  signerPrivateKey: string;
};

export type FinP2PDeployerConfig = {
  rpcURL?: string;
  deployerPrivateKey?: string;
  signerPrivateKey?: string
  operatorAddress?: string;
};

export type FinP2PContractConfig = ContractManagerConfig & {
  finP2PContractAddress: string;
};


export const readConfig = async <T>(configPath: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    fs.readFile(configPath, "utf8", (err, data) => {
      if (err) {
        reject(err);
        return
      }
      resolve(JSON.parse(data));
    });
  });
};

export const writeConfig = async <T>(config: T, configPath: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    fs.writeFile(configPath, JSON.stringify(config, null, 2), (err) => {
      if (err) {
        reject(err);
      }
      resolve();
    });
  });
};
