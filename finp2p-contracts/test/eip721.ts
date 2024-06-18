import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";


describe("EIP-721 signing test", function() {
  // async function deployERC20(name: string, symbol: string, operatorAddress: string) {
  //   const deployer = await ethers.getContractFactory("ERC20WithOperator");
  //   const contract = await deployer.deploy(name, symbol, operatorAddress);
  //   return contract.getAddress();
  // }
  //
  // async function deployFinP2PProxyFixture() {
  //   const deployer = await ethers.getContractFactory("FINP2POperatorERC20");
  //   const contract = await deployer.deploy();
  //   const address = await contract.getAddress();
  //   return { contract, address };
  // }




  it("sign", async function() {
    const signers = await ethers.getSigners()
    const signer = signers[0]

    const domain = {
      name: "MyDomain",
      version: "1",
      chainId: 1, // Change to your network's chain ID
      verifyingContract: "0xb780F1284664D9A49D090f6f92a10431EBeD9eF5"
    };

    const types = {
      MyMessage: [
        { name: "from", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" }
      ]
    };

    const message = {
      from: await signer.getAddress(),
      amount: 100,
      nonce: 0
    }

    const signature = await signer.signTypedData(domain, types, message)
    console.log(`signature: ${signature}`)
  });


});
