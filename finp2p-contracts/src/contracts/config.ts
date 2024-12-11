import * as fs from 'fs';
import { FireblocksProviderConfig } from "@fireblocks/fireblocks-web3-provider/dist/src/types";
import { FireblocksWeb3Provider } from "@fireblocks/fireblocks-web3-provider";
import { BrowserProvider, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import type { Provider } from "ethers/src.ts/providers/provider";
import type { Signer } from "ethers/src.ts/providers/signer";


export const readConfig = async <T>(configPath: string): Promise<T> => {
  return new Promise((resolve, reject) => {
    fs.readFile(configPath, 'utf8', (err, data) => {
      if (err) {
        reject(err);
        return;
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