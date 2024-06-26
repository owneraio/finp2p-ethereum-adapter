import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import {
  createCrypto,
  EIP721IssuanceMessage,
  generateNonce, hashEIP721Issuance,
  signEIP721Issuance,
  termHash,
  verifyEIP721Issuance
} from "./utils";
import { v4 as uuidv4 } from "uuid";

describe("EIP-721 signing test", function() {
  async function deployFinP2PTypedVerifier() {
    const deployer = await ethers.getContractFactory("FinP2PTypedVerifier");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  // it("sign2", async function() {
  //   const domain = {
  //     chainId: 1337,
  //     name: "FinP2P",
  //     verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  //     version: "1"
  //   };
  //   const mes = {
  //     "asset": {
  //       "fields": {
  //         "amount": 64,
  //         "assetId": "bank-us:102:a92458df-f5e7-4a88-9e60-63b5f9c1505a",
  //         "assetType": "finp2p"
  //       }
  //     },
  //     "buyer": {
  //       "fields": {
  //         "key": "02335153e47543810544bbcff240ca49ce488638f5dd8544d022ff8a7868589b1e"
  //       }
  //     },
  //     "issuer": {
  //       "fields": {
  //         "key": "02c029c6bbfaf31c5aa50c3133b7fabf4ebfe96b188fca22f84f64e23728c83b36"
  //       }
  //     },
  //     "nonce": "0x9d6a613b0984d24e5a3d5e642f98e26b5e198e4cc7fc92f500000000667bfd5f",
  //     "settlement": {
  //       "fields": {
  //         "amount": 640,
  //         "assetId": "USD",
  //         "assetType": "fiat"
  //       }
  //     }
  //   };
  //
  //   const message = {
  //     nonce: mes.nonce,
  //     buyer: { ... mes.buyer.fields },
  //     issuer: { ... mes.issuer.fields },
  //     asset: { ... mes.asset.fields },
  //     settlement: { ... mes.settlement.fields },
  //   } as EIP721IssuanceMessage;
  //   const hash = hashEIP721Issuance(1337, "0x5FbDB2315678afecb367f032d93F642f64180aa3", message);
  //   console.log(`hash: ${hash}`);
  // });

  it("sign", async function() {
    const [signer] = await ethers.getSigners();
    const { contract: verifier } = await loadFixture(deployFinP2PTypedVerifier);

    const { name, version, chainId, verifyingContract } = await verifier.eip712Domain();
    console.log(`domain: ${name}, ${version}, ${chainId}, ${verifyingContract}`);
    const { public: buyerPublic } = createCrypto();
    const { public: issuerPublic } = createCrypto();

    // const nonce = `0x${generateNonce().toString("hex")}`;
    // const buyer = `${buyerPublic.toString("hex")}`;
    // const issuer = `${issuerPublic.toString("hex")}`;
    // const amount = getRandomNumber(1, 100);
    // const assetId = `bank-us:102:${uuidv4()}`;
    // const settlementAsset = "USD";
    // const settlementAmount = getRandomNumber(1, 100);

    //         domain:  {
    //   chainId: 1337,
    //   name: 'FinP2P',
    //   verifyingContract: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    //   version: '1'
    // }
    //         types:  {
    //   definitions: [
    //     { fields: [Array], name: 'EIP712Domain' },
    //     { fields: [Array], name: 'FinId' },
    //     { fields: [Array], name: 'Term' },
    //     { fields: [Array], name: 'PrimarySale' }
    //   ]
    // }
    //         primaryType:  PrimarySale
    //         message:  {
    //   asset: {
    //     fields: {
    //       amount: 64,
    //       assetId: 'bank-us:102:88c1f5dd-94b2-4202-8e80-50448f8185b9',
    //       assetType: 'finp2p'
    //     }
    //   },
    //   buyer: {
    //     fields: {
    //       key: '025def5fdb3071b6cdc04214d31cc07dc362f9f629caff5f151247848b61e15e93'
    //     }
    //   },
    //   issuer: {
    //     fields: {
    //       key: '03132e4fda45777519ada6909a941a7e1b4594fe14979e48a4eb0420fa3d03f766'
    //     }
    //   },
    //   nonce: '9RGN+pOaE8LpZgQsuxvUV9/ufvkfKBhOAAAAAGZ8A6A=',
    //   settlement: { fields: { amount: 640, assetId: 'USD', assetType: 'fiat' } }
    // }
    //         hash:  0x0ffec9cfadab3f23e5578e513cf01f8e78b0db4bdc4163d290088fa8ef6f4202
    const nonce = `0x${Buffer.from("9RGN+pOaE8LpZgQsuxvUV9/ufvkfKBhOAAAAAGZ8A6A=", "base64").toString("hex")}`;
    const buyer = "025def5fdb3071b6cdc04214d31cc07dc362f9f629caff5f151247848b61e15e93";
    const issuer = "03132e4fda45777519ada6909a941a7e1b4594fe14979e48a4eb0420fa3d03f766";
    const amount = 64;
    const assetId = "bank-us:102:88c1f5dd-94b2-4202-8e80-50448f8185b9";
    const settlementAsset = "USD";
    const settlementAmount = 640;

    const message = {
      nonce,
      buyer: { key: buyer },
      issuer: { key: issuer },
      asset: {
        assetId,
        assetType: "finp2p",
        amount
      },
      settlement: {
        assetId: settlementAsset,
        assetType: "fiat",
        amount: settlementAmount
      }
    } as EIP721IssuanceMessage;

    const signature = await signEIP721Issuance(chainId, verifyingContract, message, signer);
    const settlementHash = termHash(settlementAsset, "fiat", settlementAmount);
    const hash = hashEIP721Issuance(chainId, verifyingContract, message);
    console.log(`hash: ${hash}`);
    const signerAddress = await signer.getAddress();
    expect(verifyEIP721Issuance(chainId, verifyingContract, message, signerAddress, signature)).to.equal(true);

    const verified = await verifier.verifyIssueSignature(nonce, buyer, issuer, assetId, amount, settlementHash,
      signerAddress, signature);
    expect(verified).to.equal(true);
  });


});

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}