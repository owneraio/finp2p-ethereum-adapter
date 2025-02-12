import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuidv4, v4 as uuid } from "uuid";
import {
  generateNonce
} from "./utils";
import { getFinId } from "../src/contracts/utils";
import { Wallet } from "ethers";
import {  HashType } from "../src/contracts/model";
import {
  EIP712_PRIMARY_SALE_TYPES,
  EIP712_REDEMPTION_TYPES, EIP712_SELLING_TYPES,
  EIP712PrimarySaleMessage, EIP712PrimaryType,
  EIP712RedemptionMessage,
  EIP712SellingMessage,
  eip712Sign
} from "../src/contracts/eip712";



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
      const { chainId, verifyingContract } = await contract.eip712Domain();

      const assetId = `bank-us:102:${uuid()}`;
      const settlementAsset = "USD";

      const erc20Address = await deployERC20("Tokenized asset owned by bank-us", "AST", finP2PAddress);
      await contract.associateAsset(assetId, erc20Address, { from: operator });

      const issuer = Wallet.createRandom();
      const issuerFinId = getFinId(issuer);

      const issueBuyer = Wallet.createRandom();
      const issueBuyerFinId = getFinId(issueBuyer);

      // ----------------------------------------------------------

      expect(await contract.getBalance(assetId, issuerFinId)).to.equal(0);
      expect(await contract.getBalance(assetId, issueBuyerFinId)).to.equal(0);

      const issueAmount = 1000;
      // const issueSettlementAmount = 10000;
      // const issueNonce = `${generateNonce().toString('hex')}`;
      // const issueSignature = await eip712Sign(chainId, verifyingContract, EIP712_PRIMARY_SALE_TYPES, {
      //   nonce: issueNonce,
      //   buyer: { idkey: issueBuyerFinId },
      //   issuer: { idkey: issuerFinId },
      //   asset: {
      //     assetId,
      //     assetType: 'finp2p',
      //     amount: `${issueAmount}`
      //   },
      //   settlement: {
      //     assetId: settlementAsset,
      //     assetType: 'fiat',
      //     amount: `${issueSettlementAmount}`
      //   }
      // } as EIP712PrimarySaleMessage, issueBuyer);

      // await contract.issue(issueNonce, assetId, issueBuyerFinId, issuerFinId, issueAmount,
      //   settlementAsset, `${issueSettlementAmount}`, HashType.EIP712, issueSignature, { from: operator });a
      await contract.issue(assetId, issuerFinId, issueAmount, { from: operator });

      expect(await contract.getBalance(assetId, issueBuyerFinId)).to.equal(0);
      expect(await contract.getBalance(assetId, issuerFinId)).to.equal(issueAmount);

      // ----------------------------------------------------------

      const seller = issuer;
      const sellerFinId = issuerFinId;
      const buyer = Wallet.createRandom();
      const buyerFinId = getFinId(buyer);

      const transferAmount = 50;
      const transferSettlementAmount = 450;
      const transferNonce = `${generateNonce().toString('hex')}`;
      const transferSignature = await eip712Sign(chainId, verifyingContract, EIP712_SELLING_TYPES,{
        nonce: transferNonce,
        buyer: { idkey: buyerFinId },
        seller: { idkey: sellerFinId },
        asset: {
          assetId,
          assetType: 'finp2p',
          amount: `${transferAmount}`
        },
        settlement: {
          assetId: settlementAsset,
          assetType: 'fiat',
          amount: `${transferSettlementAmount}`
        }
      } as EIP712SellingMessage, seller);

      await contract.transfer(transferNonce, assetId, sellerFinId, buyerFinId, transferAmount,
        settlementAsset, `${transferSettlementAmount}`, HashType.EIP712, EIP712PrimaryType.Selling, transferSignature, { from: operator });

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(issueAmount - transferAmount);
      expect(await contract.getBalance(assetId, buyerFinId)).to.equal(transferAmount);

      // ----------------------------------------------------------

      const owner = buyer;
      const redeemSellerFinId = buyerFinId;
      const redeemBuyer = Wallet.createRandom();
      const redeemIssuerFinId = getFinId(redeemBuyer);

      const redeemAmount = transferAmount;
      const redeemSettlementAmount = transferSettlementAmount;
      const redeemNonce = `${generateNonce().toString("hex")}`;
      const redeemSignature = await eip712Sign(chainId, verifyingContract, EIP712_REDEMPTION_TYPES,{
        nonce: redeemNonce,
        seller: { idkey: redeemSellerFinId },
        issuer: { idkey: redeemIssuerFinId },
        asset: {
          assetId,
          assetType: 'finp2p',
          amount: `${redeemAmount}`
        },
        settlement: {
          assetId: settlementAsset,
          assetType: 'fiat',
          amount: `${redeemSettlementAmount}`
        }
      } as EIP712RedemptionMessage, owner);
      await contract.redeem(redeemNonce, assetId, redeemSellerFinId, redeemIssuerFinId,
        redeemAmount, settlementAsset, `${redeemSettlementAmount}`, HashType.EIP712, redeemSignature, { from: operator });

      expect(await contract.getBalance(assetId, redeemSellerFinId)).to.equal(0);
      expect(await contract.getBalance(assetId, redeemIssuerFinId)).to.equal(0);
    });

    it("hold/release/rollback operations", async function() {
      const [operator] = await ethers.getSigners();
      const { contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture);

      const { chainId, verifyingContract } = await contract.eip712Domain();

      const settlementAsset = "USD";

      const erc20Address = await deployERC20("Payment stable coin", "USDT", finP2PAddress);
      await contract.associateAsset(settlementAsset, erc20Address, { from: operator });

      const issuer = Wallet.createRandom();
      const issuerFinId = getFinId(issuer);

      // ----------------------------------------------------------

      expect(await contract.getBalance(settlementAsset, issuerFinId)).to.equal(0);
      const issueSettlementAmount = 1000;
      await contract.issue(settlementAsset, issuerFinId, issueSettlementAmount, { from: operator });
      expect(await contract.getBalance(settlementAsset, issuerFinId)).to.equal(issueSettlementAmount);

      // -----------------------------
      const buyer = issuer;
      const buyerFinId = issuerFinId;
      const seller = Wallet.createRandom();
      const sellerFinId = getFinId(seller);

      const operationId = `0x${uuidv4().replaceAll('-', '')}`;
      const assetId = `bank-us:102:${uuid()}`;
      const transferAmount = 50;
      const transferSettlementAmount = 450;
      const transferNonce = `${generateNonce().toString('hex')}`;
      const transferSignature = await eip712Sign(chainId, verifyingContract, EIP712_SELLING_TYPES, {
        nonce: transferNonce,
        seller: { idkey: sellerFinId },
        buyer: { idkey: buyerFinId },
        asset: {
          assetId,
          assetType: 'finp2p',
          amount: `${transferAmount}`
        },
        settlement: {
          assetId: settlementAsset,
          assetType: 'fiat',
          amount: `${transferSettlementAmount}`
        }
      } as EIP712SellingMessage, buyer);

      await contract.hold(operationId, transferNonce, assetId, sellerFinId,
        buyerFinId, `${transferAmount}`, settlementAsset, transferSettlementAmount, /*HashType.EIP712,*/ transferSignature, { from: operator });

      expect(await contract.getBalance(settlementAsset, buyerFinId)).to.equal(issueSettlementAmount - transferSettlementAmount);

      // -----------------------------

      await contract.release(operationId, sellerFinId, { from: operator });

      expect(await contract.getBalance(settlementAsset, sellerFinId)).to.equal(transferSettlementAmount);
      expect(await contract.getBalance(settlementAsset, buyerFinId)).to.equal(issueSettlementAmount - transferSettlementAmount);
    });

  });

});
