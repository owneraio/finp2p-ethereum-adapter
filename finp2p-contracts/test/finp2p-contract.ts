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
  sign, stringToByte16,
  enumAssetTypeIndexByName
} from "./utils";

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

  async function createAccount() {
    const account = ethers.Wallet.createRandom();
    return {
      address: account.address,
      privateKey: account.privateKey,
      finId: privateKeyToFinId(account.privateKey)
    };
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
      const opId = stringToByte16("")
      await contract.redeem(opId, redeeemNonce, assetId, seller.finId, redeemAmount, redeemSttlHash, redeemHash, redeeemSignature, { from: operator });

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(0);
      expect(await contract.getBalance(assetId, buyer.finId)).to.equal(transferAmount);
    });

    it("hold/redeem operation", async function() {
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
        
      const opNum = 1;
      const operationId = stringToByte16(`${opNum}`);
      const holdAmount = 50;
      const expiry = currentTimeUnix() + 24 * 60 * 60;
      const astHash = randomHash();
      const sttlHash = settlementHash("fiat", assetId, "finId", seller.finId, "finId", buyer.finId, holdAmount, expiry);
      const hash = combineHashes([astHash, sttlHash]);
      const signature = sign(seller.privateKey, hash);

      await contract.hold(operationId, assetId, seller.finId, buyer.finId, holdAmount, expiry, astHash, enumAssetTypeIndexByName("fiat"), hash, signature, { from: operator });
      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset - holdAmount);

      // -----------------------------
      const redeemAmountW = holdAmount + 10;
      const redeemNonceW = generateNonce();
      const redeemAstHashW = assetHash(redeemNonceW, "redeem", "finp2p", assetId, "finId", seller.finId, "", "", redeemAmountW);
      const redeemSttlHashW = randomHash();
      const redeemHashW = combineHashes([redeemAstHashW, redeemSttlHashW]);
      const redeemSignatureW = sign(seller.privateKey, redeemHashW);

      await expect(contract.redeem(operationId, redeemNonceW, assetId, seller.finId, redeemAmountW, redeemSttlHashW, redeemHashW, redeemSignatureW, { from: operator })).to.be.revertedWith(/Amount to redeem is not equal to locked amount for this operationId/)
      
      // -------------------
      const redeemAmount = holdAmount;
      const redeeemNonce = generateNonce();
      const redeemAstHash = assetHash(redeeemNonce, "redeem", "finp2p", assetId, "finId", seller.finId, "", "", redeemAmount);
      const redeemSttlHash = randomHash();
      const redeemHash = combineHashes([redeemAstHash, redeemSttlHash]);
      const redeemSignature = sign(seller.privateKey, redeemHash);

      const operationIdW = stringToByte16(`${opNum+3}`)
      await expect(contract.redeem(operationIdW, redeeemNonce, assetId, seller.finId, redeemAmount, redeemSttlHash, redeemHash, redeemSignature, { from: operator })).to.be.revertedWith(/Contract does not exists/);

      await contract.redeem(operationId, redeeemNonce, assetId, seller.finId, redeemAmount, redeemSttlHash, redeemHash, redeemSignature, { from: operator });
      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset - redeemAmount);
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

      await contract.hold(operationId, assetId, seller.finId, buyer.finId, transferAmount, expiry, astHash, enumAssetTypeIndexByName("fiat"), hash, signature, { from: operator });

      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset - transferAmount);

      // -----------------------------

      await contract.release(operationId, buyer.finId, { from: operator });

      expect(await contract.getBalance(assetId, buyer.finId)).to.equal(transferAmount);
      expect(await contract.getBalance(assetId, seller.finId)).to.equal(issueAmountAsset - transferAmount);
    });

  });

});
