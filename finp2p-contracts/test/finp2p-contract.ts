import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import {
  generateNonce,
  stringToByte16,
} from './utils';
import {
  signMessage,
  EIP721IssuanceMessage, EIP721_ISSUANCE_TYPES, verifyMessage, hashMessage, EIP721_TRANSFER_TYPES, EIP721_REDEEM_TYPES
} from "./eip721";
import { getFinId } from "../src/contracts/utils";
import { Wallet } from "ethers";

describe("FinP2P proxy contract test", function() {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployERC20(name: string, symbol: string, operatorAddress: string) {
    const deployer = await ethers.getContractFactory("ERC20WithOperator");
    const contract = await deployer.deploy(name, symbol, operatorAddress);
    return contract.getAddress();
  }

  async function deployFinP2PProxyFixture() {
    const deployer = await ethers.getContractFactory("FINP2POperatorERC20");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  describe("FinP2PProxy operations", function() {

    it("issue/transfer/redeem operations", async function() {
      const [operator] = await ethers.getSigners();
      const { contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture);
      const { chainId, verifyingContract } = contract.eip712Domain();

      const assetId = `bank-us:102:${uuid()}`;
      const settlementAsset = "USD";
      const settlementAmount = 10000;

      const erc20Address = await deployERC20("Tokenized asset owned by bank-us", "AST", finP2PAddress);
      await contract.associateAsset(assetId, erc20Address, { from: operator });

      const buyer = Wallet.createRandom();
      const seller = Wallet.createRandom();
      const buyerFinId = getFinId(buyer);
      const sellerFinId = getFinId(seller);

      // ----------------------------------------------------------

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(0);

      const issueAmountAsset = 1000;
      let nonce = `0x${generateNonce().toString("hex")}`;
      let message = {
        nonce,
        buyer: { key: buyerFinId },
        issuer: { key: sellerFinId },
        asset: {
          assetId,
          assetType: "finp2p",
          amount: issueAmountAsset
        },
        settlement: {
          assetId: settlementAsset,
          assetType: "fiat",
          amount: settlementAmount
        }
      }  as EIP721IssuanceMessage;
      let signature = await signMessage(chainId, verifyingContract, EIP721_ISSUANCE_TYPES, message, buyer);

      expect(verifyMessage(chainId, verifyingContract, EIP721_ISSUANCE_TYPES, message, buyer.address, signature)).to.equal(true);

      const offChainSignature = hashMessage(chainId, verifyingContract, EIP721_ISSUANCE_TYPES, message)
      console.log("off-chain hash", offChainSignature);

      const onChainHash = await contract.hashIssue(nonce, buyerFinId, sellerFinId, assetId, issueAmountAsset, settlementAsset, settlementAmount);
      console.log("on-chain hash", onChainHash);

      await contract.issue(nonce, assetId, buyerFinId, sellerFinId, issueAmountAsset, settlementAsset, settlementAmount, signature, { from: operator });

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(issueAmountAsset);

      // ----------------------------------------------------------

      const transferAmount = 50;
      nonce = `0x${generateNonce().toString("hex")}`;
      signature = await signMessage(chainId, verifyingContract, EIP721_TRANSFER_TYPES,{
        nonce,
        buyer: { key: buyerFinId },
        seller: { key: sellerFinId },
        asset: {
          assetId,
          assetType: "finp2p",
          amount: issueAmountAsset
        },
        settlement: {
          assetId: settlementAsset,
          assetType: "fiat",
          amount: settlementAmount
        }
      }, buyer);
      await contract.transfer(nonce, assetId, sellerFinId, buyerFinId, transferAmount, settlementAsset, settlementAmount, signature, { from: operator });

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(issueAmountAsset - transferAmount);
      expect(await contract.getBalance(assetId, buyerFinId)).to.equal(transferAmount);

      // ----------------------------------------------------------

      const redeemAmount = issueAmountAsset - transferAmount;
      nonce = `0x${generateNonce().toString("hex")}`;
      signature = await signMessage(chainId, verifyingContract, EIP721_REDEEM_TYPES,{
        nonce,
        buyer: { key: buyerFinId },
        issuer: { key: sellerFinId },
        asset: {
          assetId,
          assetType: "finp2p",
          amount: issueAmountAsset
        },
        settlement: {
          assetId: settlementAsset,
          assetType: "fiat",
          amount: settlementAmount
        }
      }, buyer);
      await contract.redeem(nonce, assetId, sellerFinId, redeemAmount, settlementAsset, settlementAmount, signature, { from: operator });

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(0);
      expect(await contract.getBalance(assetId, buyerFinId)).to.equal(transferAmount);
    });

    it("hold/release/rollback operations", async function() {
      const [operator] = await ethers.getSigners();
      const { contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture);

      const { chainId, verifyingContract } = contract.eip712Domain();

      const assetId = `bank-us:102:${uuid()}`;
      const settlementAsset = "USD";
      const assetAmount = 1000;
      const settlementAmount = 10000;

      const erc20Address = await deployERC20("Payment stable coin", "USDT", finP2PAddress);
      await contract.associateAsset(assetId, erc20Address, { from: operator });

      const buyer = Wallet.createRandom();
      const seller = Wallet.createRandom();
      const buyerFinId = getFinId(buyer);
      const sellerFinId = getFinId(seller);

      // ----------------------------------------------------------

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(0);

      const issueAmountAsset = 1000;
      let nonce = `0x${generateNonce().toString("hex")}`;
      let signature = await signMessage(chainId, verifyingContract,  EIP721_ISSUANCE_TYPES,{
        nonce,
        buyer: { key: buyerFinId },
        issuer: { key: sellerFinId },
        asset: {
          assetId,
          assetType: "finp2p",
          amount: issueAmountAsset
        },
        settlement: {
          assetId: settlementAsset,
          assetType: "fiat",
          amount: settlementAmount
        }
      }, buyer);
      await contract.issue(nonce, assetId, buyerFinId, sellerFinId, issueAmountAsset, settlementAsset, settlementAmount, signature, { from: operator });

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(issueAmountAsset);

      // -----------------------------

      const opNum = 1;
      const operationId = stringToByte16(`${opNum}`);
      const transferAmount = 50;

      nonce = `0x${generateNonce().toString("hex")}`;
      signature = await signMessage(chainId, verifyingContract,  EIP721_TRANSFER_TYPES,{
        nonce,
        buyer: { key: buyerFinId },
        seller: { key: sellerFinId },
        asset: {
          assetId,
          assetType: "finp2p",
          amount: issueAmountAsset
        },
        settlement: {
          assetId: settlementAsset,
          assetType: "fiat",
          amount: settlementAmount
        }
      }, buyer);

      await contract.hold(operationId, assetId, sellerFinId, buyerFinId, transferAmount, settlementAsset, settlementAmount, signature, { from: operator });

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(issueAmountAsset - transferAmount);

      // -----------------------------

      await contract.release(operationId, buyerFinId, { from: operator });

      expect(await contract.getBalance(assetId, buyerFinId)).to.equal(transferAmount);
      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(issueAmountAsset - transferAmount);
    });

  });

});
