import {ethers, JsonRpcProvider, Wallet} from "ethers";
import Finp2pERC20 from "./Finp2pERC20.json";

export class FinP2PContract {

  provider: JsonRpcProvider
  wallet: Wallet
  contract: ethers.Contract

  constructor(rpcURL: string, privateKey: string, finP2PContractAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcURL)
    this.wallet = new ethers.Wallet(privateKey, this.provider)
    this.contract = new ethers.Contract(finP2PContractAddress, Finp2pERC20.abi, this.wallet.connect(this.provider))
  }

  issue() {
    // this.contract.
  }

}