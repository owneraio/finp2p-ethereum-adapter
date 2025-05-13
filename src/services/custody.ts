import { Wallet } from "ethers";
import { privateKeyToFinId } from "../../finp2p-contracts/src/contracts/utils";


export class CustodyService {

  private keyMap: Map<string, string>;

  constructor(privateKeysString: string) {
    const keyMap = new Map<string, string>();
    privateKeysString.split(",")
      .map(v => v.trim())
      .map(v => Buffer.from(v, "base64").toString("hex"))
      .forEach(pk => keyMap.set(privateKeyToFinId(pk), pk));
    this.keyMap = keyMap;
  }

  createWalletByFinId(finId: string): Wallet {
    const privateKey = this.keyMap.get(finId);
    if (!privateKey) {
      throw new Error(`No private key found for finId ${finId}`);
    }
    return new Wallet(privateKey);
  }

}