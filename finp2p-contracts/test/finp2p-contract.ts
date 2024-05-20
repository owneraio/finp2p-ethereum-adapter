import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import {
  privateKeyToFinId,
  combineHashes,
  assetHash,
  settlementHash,
  randomHash,
  generateNonce,
  sign, stringToByte16
} from "./utils";
import { createAccount } from "../src/contracts/utils";

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



  function currentTimeUnix() {
    return Math.floor(new Date().getTime() / 1000);
  }

  describe("FinP2PProxy operations", function() {

    it("issue/transfer/redeem operations", async function() {
      const [operator] = await ethers.getSigners();
      const { contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture);

      const assetId = `bank-us:102:${uuid()}`;

      const erc20Address = await deployERC20("Tokenized asset owned by bank-us", "AST", finP2PAddress);
      await contract.associateAsset(assetId, erc20Address, { from: operator });

      const buyer = await createAccount();
      const seller = await createAccount();

      // -----------------------------

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(0);

      const issueAmountAsset = 1000;
      await contract.issue(assetId, seller.finId, issueAmountAsset, { from: operator });

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset);

      // -----------------------------

      const transferAmount = 50;
      const transferNonce = generateNonce();
      const transferAstHash = assetHash(transferNonce, "transfer", "finp2p", assetId, "finId", seller.finId, "finId", buyer.finId, transferAmount);
      const transferSttlHash = randomHash();
      const transferHash = combineHashes([transferAstHash, transferSttlHash]);
      const transferSignature = sign(seller.privateKey, transferHash);

      await contract.transfer(transferNonce, assetId, seller.finId, buyer.finId, transferAmount, transferSttlHash, transferHash, transferSignature, { from: operator });

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset - transferAmount);
      expect(await contract.getBalance(assetId, buyer.finId)).to.equal(transferAmount);

      // -----------------------------

      const redeemAmount = issueAmountAsset - transferAmount;
      const redeeemNonce = generateNonce();
      const redeemAstHash = assetHash(redeeemNonce, "redeem", "finp2p", assetId, "finId", seller.finId, "", "", redeemAmount);
      const redeemSttlHash = randomHash();
      const redeemHash = combineHashes([redeemAstHash, redeemSttlHash]);
      const redeeemSignature = sign(seller.privateKey, redeemHash);
      await contract.redeem(redeeemNonce, assetId, seller.finId, redeemAmount, redeemSttlHash, redeemHash, redeeemSignature, { from: operator });

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(0);
      expect(await contract.getBalance(assetId, buyer.finId)).to.equal(transferAmount);
    });

    it("hold/release/rollback operations", async function() {
      const [operator] = await ethers.getSigners();
      const { contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture);

      const assetId = "USDT";
      const erc20Address = await deployERC20("Payment stable coin", "USDT", finP2PAddress);
      await contract.associateAsset(assetId, erc20Address, { from: operator });

      const buyer = await createAccount();
      const seller = await createAccount();

      // -----------------------------

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(0);

      const issueAmountAsset = 1000;
      await contract.issue(assetId, seller.finId, issueAmountAsset, { from: operator });

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset);

      // -----------------------------

      const opNum = 1;
      const operationId = stringToByte16(`${opNum}`);
      const transferAmount = 50;
      const expiry = currentTimeUnix() + 24 * 60 * 60;

      const astHash = randomHash();
      const sttlHash = settlementHash("fiat", assetId, "finId", seller.finId, "finId", buyer.finId, transferAmount, expiry);
      const hash = combineHashes([astHash, sttlHash]);
      const signature = sign(seller.privateKey, hash);

      await contract.hold(operationId, assetId, seller.finId, buyer.finId, transferAmount, expiry, astHash, hash, signature, { from: operator });

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset - transferAmount);

      // -----------------------------

      await contract.release(operationId, buyer.finId, { from: operator });

      expect(await contract.getBalance(assetId, buyer.finId)).to.equal(transferAmount);
      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset - transferAmount);
    });

  });

});
