import {
  loadFixture
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuidv4, v4 as uuid } from "uuid";
import {
  generateNonce,
} from './utils';
import {
  eip712Sign,
  EIP721_ISSUANCE_TYPES,
  EIP721_TRANSFER_TYPES,
  EIP721_REDEEM_TYPES,
  EIP721IssuanceMessage,
  EIP721TransferMessage,
  EIP721RedeemMessage
} from "../src/contracts/eip721";
import { getFinId } from "../src/contracts/utils";
import { Wallet } from "ethers";

const HashTypeHashList = 1;
const HashTypeEIP712 = 2;
const hashType = HashTypeEIP712;


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
    const contract = await deployer.deploy(hashType);
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
      const issueSettlementAmount = 10000;
      const issueNonce = `${generateNonce().toString('hex')}`;
      const issueSignature = await eip712Sign(chainId, verifyingContract, EIP721_ISSUANCE_TYPES, {
        nonce: issueNonce,
        buyer: { idkey: issueBuyerFinId },
        issuer: { idkey: issuerFinId },
        asset: {
          assetId,
          assetType: 'finp2p',
          amount: `${issueAmount}`
        },
        settlement: {
          assetId: settlementAsset,
          assetType: 'fiat',
          amount: `${issueSettlementAmount}`
        }
      } as EIP721IssuanceMessage, issueBuyer);
      await contract.issue(issueNonce, assetId, issueBuyerFinId, issuerFinId, issueAmount,
        settlementAsset, issueSettlementAmount, issueSignature, { from: operator });

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
      const transferSignature = await eip712Sign(chainId, verifyingContract, EIP721_TRANSFER_TYPES,{
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
      } as EIP721TransferMessage, seller);

      await contract.transfer(transferNonce, assetId, sellerFinId, buyerFinId, transferAmount,
        settlementAsset, transferSettlementAmount, transferSignature, { from: operator });

      expect(await contract.getBalance(assetId, sellerFinId)).to.equal(issueAmount - transferAmount);
      expect(await contract.getBalance(assetId, buyerFinId)).to.equal(transferAmount);

      // ----------------------------------------------------------

      const owner = buyer;
      const ownerFinId = buyerFinId;
      const redeemBuyer = Wallet.createRandom();
      const redeemBuyerFinId = getFinId(redeemBuyer);

      const redeemAmount = transferAmount;
      const redeemSettlementAmount = transferSettlementAmount;
      const redeemNonce = `${generateNonce().toString("hex")}`;
      const redeemSignature = await eip712Sign(chainId, verifyingContract, EIP721_REDEEM_TYPES,{
        nonce: redeemNonce,
        owner: { idkey: ownerFinId },
        buyer: { idkey: redeemBuyerFinId },
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
      } as EIP721RedeemMessage, owner);
      await contract.redeem(redeemNonce, assetId, ownerFinId, redeemBuyerFinId,
        redeemAmount, settlementAsset, redeemSettlementAmount, redeemSignature, { from: operator });

      expect(await contract.getBalance(assetId, ownerFinId)).to.equal(0);
      expect(await contract.getBalance(assetId, redeemBuyerFinId)).to.equal(0);
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
      await contract.issueWithoutSignature(settlementAsset, issuerFinId, issueSettlementAmount, { from: operator });
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
      const transferSignature = await eip712Sign(chainId, verifyingContract, EIP721_TRANSFER_TYPES, {
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
      } as EIP721TransferMessage, buyer);

      await contract.hold(operationId, transferNonce, assetId, sellerFinId,
        buyerFinId, transferAmount, settlementAsset, transferSettlementAmount, transferSignature, { from: operator });

      expect(await contract.getBalance(settlementAsset, buyerFinId)).to.equal(issueSettlementAmount - transferSettlementAmount);

      // -----------------------------

      await contract.release(operationId, sellerFinId, { from: operator });

      expect(await contract.getBalance(settlementAsset, sellerFinId)).to.equal(transferSettlementAmount);
      expect(await contract.getBalance(settlementAsset, buyerFinId)).to.equal(issueSettlementAmount - transferSettlementAmount);
    });

  });

});
