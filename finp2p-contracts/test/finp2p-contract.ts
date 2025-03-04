import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuidv4, v4 as uuid } from "uuid";
import { generateNonce } from "./utils";
import { getFinId } from "../src/contracts/utils";
import { Signer, Wallet } from "ethers";
import {
  BUYING_TYPES,
  finId,
  Leg, newBuyingMessage,
  newPrimarySaleMessage,
  newRedemptionMessage,
  newSellingMessage,
  PRIMARY_SALE_TYPES,
  PrimaryType,
  REDEMPTION_TYPES,
  SELLING_TYPES,
  sign,
  term
} from "../src/contracts/eip712";
import type { FINP2POperatorERC20 } from "../typechain-types";


describe("FinP2P proxy contract test", function() {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployERC20(name: string, symbol: string, decimals: number, operatorAddress: string) {
    const deployer = await ethers.getContractFactory("ERC20WithOperator");
    const contract = await deployer.deploy(name, symbol, decimals, operatorAddress);
    return contract.getAddress();
  }

  async function deployFinP2PProxyFixture() {
    const deployer = await ethers.getContractFactory("FINP2POperatorERC20");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }


  describe("FinP2PProxy operations", () => {

    let operator: Signer;
    let contract: FINP2POperatorERC20;
    let finP2PAddress: string;
    let chainId: bigint;
    let verifyingContract: string;

    before(async () => {
      [operator] = await ethers.getSigners();
      ({ contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture));
      ({ chainId, verifyingContract } = await contract.eip712Domain());
    });

    const testCases: [number, number, number, PrimaryType, Leg][] = [ // [decimals, issueAmount, transferAmount, redeemAmount]
      [0, 10, 5, PrimaryType.PrimarySale, Leg.Settlement],
      [0, 10, 5, PrimaryType.PrimarySale, Leg.Asset],
      [2, 10.13, 2.13, PrimaryType.Selling, Leg.Settlement],
      [4, 10.0001, 10.0001, PrimaryType.Buying, Leg.Settlement],
      [18, 1.01, 0.6, PrimaryType.Selling, Leg.Settlement]
    ];
    testCases.forEach(([decimals, issueAmount, transferAmount, primaryType, leg]) => {
      it(`issue/transfer operations (decimals: ${decimals}, issue amount: ${issueAmount}, transfer amount: ${transferAmount}`, async () => {

        const assetId = `bank-us:102:${uuid()}`;
        const settlementAsset = "USD";

        const erc20Address = await deployERC20('Tokenized asset owned by bank-us', 'AST', decimals, finP2PAddress);
        await contract.associateAsset(assetId, erc20Address, { from: operator });

        const issuer = Wallet.createRandom();
        const issuerFinId = getFinId(issuer);

        const issueBuyer = Wallet.createRandom();
        const issueBuyerFinId = getFinId(issueBuyer);

        // ----------------------------------------------------------

        expect(await contract.getBalance(assetId, issuerFinId)).to.equal(`${(0).toFixed(decimals)}`);
        expect(await contract.getBalance(assetId, issueBuyerFinId)).to.equal(`${(0).toFixed(decimals)}`);

        await contract.issue(issuerFinId, term(assetId, 'finp2p', `${issueAmount.toFixed(decimals)}`), { from: operator });

        expect(await contract.getBalance(assetId, issueBuyerFinId)).to.equal(`${(0).toFixed(decimals)}`);
        expect(await contract.getBalance(assetId, issuerFinId)).to.equal(`${issueAmount.toFixed(decimals)}`);

        // ----------------------------------------------------------

        const seller = issuer;
        const sellerFinId = issuerFinId;
        const buyer = Wallet.createRandom();
        const buyerFinId = getFinId(buyer);

        const transferSettlementAmount = 450;
        const transferNonce = `${generateNonce().toString('hex')}`;

        const asset = term(assetId, 'finp2p', `${transferAmount.toFixed(decimals)}`);
        const settlement = term(settlementAsset, 'fiat', `${transferSettlementAmount.toFixed(decimals)}`);

        const transferSignature = await sign(chainId, verifyingContract, SELLING_TYPES,
          newSellingMessage(transferNonce, finId(buyerFinId), finId(sellerFinId), asset, settlement), seller);

        await contract.transfer(transferNonce, sellerFinId, buyerFinId, asset, settlement, Leg.Asset, PrimaryType.Selling, transferSignature, { from: operator });
        expect(await contract.getBalance(assetId, sellerFinId)).to.equal(`${(issueAmount - transferAmount).toFixed(decimals)}`);
        expect(await contract.getBalance(assetId, buyerFinId)).to.equal(`${transferAmount.toFixed(decimals)}`);
      });

      it(`hold/release operations (decimals: ${decimals}, issue amount: ${issueAmount}, transfer amount: ${transferAmount}, primaryType: ${primaryType}, leg: ${leg})`, async () => {
        const [operator] = await ethers.getSigners();
        const { contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture);

        const { chainId, verifyingContract } = await contract.eip712Domain();

        const assetId = `bank-us:102:${uuid()}`;
        const settlementAsset = 'USD';

        const issuer = Wallet.createRandom();
        const issuerFinId = getFinId(issuer);

        const buyer = issuer;
        const buyerFinId = issuerFinId;
        const seller = Wallet.createRandom();
        const sellerFinId = getFinId(seller);

        const operationId = `0x${uuidv4().replaceAll('-', '')}`;
        const assetAmount = 50;
        const nonce = `${generateNonce().toString('hex')}`;
        const asset = term(assetId, 'finp2p', `${assetAmount.toFixed(decimals)}`);
        const settlement = term(settlementAsset, 'fiat', `${transferAmount.toFixed(decimals)}`);

        let signer: Signer;
        switch (leg) {
          case Leg.Asset:
            signer = seller;
            await contract.associateAsset(assetId, await deployERC20('Asset coin', 'USDT', decimals, finP2PAddress), { from: operator });
            expect(await contract.getBalance(assetId, sellerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            await contract.issue(sellerFinId, term(assetId, 'finp2p',  `${assetAmount.toFixed(decimals)}`), { from: operator });
            expect(await contract.getBalance(assetId, sellerFinId)).to.equal(`${assetAmount.toFixed(decimals)}`);
            break
          case Leg.Settlement:
            signer = buyer;
            await contract.associateAsset(settlementAsset, await deployERC20('Payment stable coin', 'USDT', decimals, finP2PAddress), { from: operator });
            expect(await contract.getBalance(settlementAsset, issuerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            await contract.issue(issuerFinId, term(settlementAsset, 'fiat',  `${issueAmount.toFixed(decimals)}`), { from: operator });
            expect(await contract.getBalance(settlementAsset, issuerFinId)).to.equal(`${issueAmount.toFixed(decimals)}`);
            break
          default:
            throw new Error('Invalid leg')
        }

        let signature: string;
        switch (primaryType) {
          case PrimaryType.PrimarySale:
            signature = await sign(chainId, verifyingContract, PRIMARY_SALE_TYPES,
              newPrimarySaleMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement), signer);
            break
          case PrimaryType.Buying:
            signature = await sign(chainId, verifyingContract, BUYING_TYPES,
              newBuyingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement), signer);
            break
          case PrimaryType.Selling:
            signature = await sign(chainId, verifyingContract, SELLING_TYPES,
              newSellingMessage(nonce, finId(buyerFinId), finId(sellerFinId), asset, settlement), signer);
            break
          default:
            throw new Error('Invalid primary type')
        }

        await contract.hold(operationId, nonce, sellerFinId, buyerFinId, asset, settlement, leg, primaryType, signature, { from: operator });

        switch (leg) {
          case Leg.Asset: {
            expect(await contract.getBalance(assetId, sellerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            const lock = await contract.getLockInfo(operationId);
            expect(lock[0]).to.equal(assetId);
            expect(lock[1]).to.equal('finp2p');
            expect(lock[2]).to.equal(sellerFinId);
            expect(lock[3]).to.equal(`${assetAmount.toFixed(decimals)}`);
            break
          }
          case Leg.Settlement: {
            expect(await contract.getBalance(settlementAsset, buyerFinId)).to.equal(`${(issueAmount - transferAmount).toFixed(decimals)}`);
            const lock = await contract.getLockInfo(operationId);
            expect(lock[0]).to.equal(settlementAsset);
            expect(lock[1]).to.equal('fiat');
            expect(lock[2]).to.equal(buyerFinId);
            expect(lock[3]).to.equal(`${transferAmount.toFixed(decimals)}`);
            break
          }
        }


        // -----------------------------

        await contract.release(operationId, sellerFinId, `${transferAmount.toFixed(decimals)}`, { from: operator });
        switch (leg) {
          case Leg.Asset: {
            expect(await contract.getBalance(assetId, sellerFinId)).to.equal(`${assetAmount.toFixed(decimals)}`);
            expect(await contract.getBalance(assetId, buyerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            break
          }
          case Leg.Settlement: {
            expect(await contract.getBalance(settlementAsset, sellerFinId)).to.equal(`${transferAmount.toFixed(decimals)}`);
            expect(await contract.getBalance(settlementAsset, buyerFinId)).to.equal(`${(issueAmount - transferAmount).toFixed(decimals)}`);
            break
          }
        }
        // await expect(contract.getLockInfo(operationId)).to.be.revertedWith('Lock not found'); // TODO update chai

      });

      it(`hold/redeem operations (decimals: ${decimals}, issue amount: ${issueAmount}, transfer amount: ${transferAmount})`, async () => {
        const assetId = `bank-us:102:${uuid()}`;

        const erc20Address = await deployERC20('Digital asset', assetId, decimals, finP2PAddress);
        await contract.associateAsset(assetId, erc20Address, { from: operator });

        const issuer = Wallet.createRandom();
        const issuerFinId = getFinId(issuer);

        const investor = Wallet.createRandom();
        const investorFinId = getFinId(investor);

        // ----------------------------------------------------------

        expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
        await contract.issue(investorFinId, term(assetId, 'finp2p', `${issueAmount.toFixed(decimals)}`), { from: operator });
        expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${issueAmount.toFixed(decimals)}`);

        // -----------------------------

        const operationId = `0x${uuidv4().replaceAll('-', '')}`;
        const redeemAmount = transferAmount;
        const redeemSettlementAmount = 50;
        const redeemNonce = `${generateNonce().toString('hex')}`;
        const asset = term(assetId, 'finp2p', `${redeemAmount.toFixed(decimals)}`);
        const settlement = term('USD', 'fiat', `${redeemSettlementAmount.toFixed(decimals)}`);
        const redemptionSignature = await sign(chainId, verifyingContract, REDEMPTION_TYPES,
          newRedemptionMessage(redeemNonce, finId(issuerFinId), finId(investorFinId), asset, settlement), investor);

        await contract.hold(operationId, redeemNonce, investorFinId, issuerFinId,
          asset, settlement, Leg.Asset, PrimaryType.Redemption, redemptionSignature, { from: operator });
        const lock = await contract.getLockInfo(operationId);
        expect(lock[0]).to.equal(assetId);
        expect(lock[1]).to.equal('finp2p');
        expect(lock[2]).to.equal(investorFinId);
        expect(lock[3]).to.equal(`${transferAmount.toFixed(decimals)}`);
        expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(issueAmount - redeemAmount).toFixed(decimals)}`);

        // -----------------------------
        await contract.redeem(operationId, investorFinId, `${redeemAmount.toFixed(decimals)}`, { from: operator });
        expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(issueAmount - redeemAmount).toFixed(decimals)}`);
        // await expect(contract.getLockInfo(operationId)).to.be.revertedWith('Lock not found'); // TODO update chai
      });

    });
  });

});
