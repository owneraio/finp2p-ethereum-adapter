import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuidv4, v4 as uuid } from "uuid";
import { generateNonce, toFixedDecimals } from "./utils";
import { getFinId } from "../src/contracts/utils";
import { Signer, Wallet } from "ethers";
import {
  finId,
  Leg, newInvestmentMessage,
  newRedemptionMessage,
  PrimaryType,
  REDEMPTION_TYPES,
  sign, Term,
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

  function generateAssetId(): string {
    return `bank-us:102:${uuid()}`;
  }

  describe("FinP2PProxy operations", () => {

    let operator: Signer;
    let contract: FINP2POperatorERC20;
    let finP2PAddress: string;
    let chainId: bigint;
    let verifyingContract: string;

    const primaryTypes = [PrimaryType.PrimarySale, PrimaryType.Buying, PrimaryType.Selling]
    const legs = [Leg.Asset, Leg.Settlement]
    const terms: {asset: Term, settlement: Term, decimals: number}[] = [
      {asset: term(generateAssetId(), 'finp2p', '10'), settlement: term('USD', 'fiat', '100'), decimals: 0},
      {asset: term(generateAssetId(), 'finp2p', '10.13'), settlement: term('GBP', 'fiat', '10.13'), decimals: 2},
      {asset: term(generateAssetId(), 'finp2p', '10.0001'), settlement: term(generateAssetId(), 'finp2p', '10'), decimals: 4},
      {asset: term(generateAssetId(), 'finp2p', '1.01'), settlement: term('EUR', 'fiat', '10000'), decimals: 18},
    ];

    before(async () => {
      [operator] = await ethers.getSigners();
      ({ contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture));
      ({ chainId, verifyingContract } = await contract.eip712Domain());
      for (const term of terms) {
        let asset = await deployERC20(term.asset.assetId, term.asset.assetId, term.decimals, finP2PAddress);
        await contract.associateAsset(term.asset.assetId,
          asset, { from: operator });

        let setlement = await deployERC20(term.settlement.assetId, term.settlement.assetId, term.decimals, finP2PAddress);
        await contract.associateAsset(term.settlement.assetId,
          setlement, { from: operator });
      }

    });


    primaryTypes.forEach((primaryType) => {
      legs.forEach((leg) => {
        terms.forEach(({decimals, asset, settlement}) => {
          it(`issue/transfer/redeem operations (decimals: ${decimals}, asset: ${asset}, settlement ${settlement}`, async () => {

            const { assetId, amount } = asset;
            const issuer = Wallet.createRandom();
            const issuerFinId = getFinId(issuer);

            const issueBuyer = Wallet.createRandom();
            const issueBuyerFinId = getFinId(issueBuyer);

            // ----------------------------------------------------------

            expect(await contract.getBalance(assetId, issuerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            expect(await contract.getBalance(assetId, issueBuyerFinId)).to.equal(`${(0).toFixed(decimals)}`);

            await contract.issue(issuerFinId, asset, { from: operator });

            expect(await contract.getBalance(assetId, issueBuyerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            expect(await contract.getBalance(assetId, issuerFinId)).to.equal(toFixedDecimals(amount, decimals));

            // ----------------------------------------------------------


            expect(await contract.getBalance(assetId, issueBuyerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            expect(await contract.getBalance(assetId, issuerFinId)).to.equal(toFixedDecimals(amount, decimals));

            const seller = issuer;
            const sellerFinId = issuerFinId;
            const buyer = Wallet.createRandom();
            const buyerFinId = getFinId(buyer);

            const nonce = `${generateNonce().toString('hex')}`;

            const { types, message } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement);
            const signature = await sign(chainId, verifyingContract, types, message, seller);

            await contract.transfer(nonce, sellerFinId, buyerFinId, asset, settlement, Leg.Asset, primaryType, signature, { from: operator });
            expect(await contract.getBalance(assetId, sellerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            expect(await contract.getBalance(assetId, buyerFinId)).to.equal(toFixedDecimals(amount, decimals));

            // ----------------------------------------------------------

            await contract.redeem(buyerFinId, asset, { from: operator });
            expect(await contract.getBalance(assetId, buyerFinId)).to.equal(`${(0).toFixed(decimals)}`);
          });


          it(`hold/release operations (decimals: ${decimals}, asset: ${asset}, settlement ${settlement} primaryType: ${primaryType}, leg: ${leg})`, async () => {
            const buyer =  Wallet.createRandom();
            const buyerFinId = getFinId(buyer);
            const seller = Wallet.createRandom();
            const sellerFinId = getFinId(seller);

            let assetId: string, assetType: string, amount: string;
            let investorFinId: string
            let signer: Signer;
            switch (leg) {
              case Leg.Asset:
                ({assetId, assetType, amount} = asset);
                signer = seller;
                investorFinId = sellerFinId;
                break
              case Leg.Settlement:
                ({assetId, assetType, amount} = settlement);
                signer = buyer;
                investorFinId = buyerFinId;
                break
              default:
                throw new Error('Invalid leg')
            }

            const operationId = `0x${uuidv4().replaceAll('-', '')}`;
            const nonce = `${generateNonce().toString('hex')}`;

            expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
            await contract.issue(investorFinId, term(assetId, assetType, amount), { from: operator });
            expect(await contract.getBalance(assetId, investorFinId)).to.equal(toFixedDecimals(amount, decimals));

            const { types, message } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement);
            const signature = await sign(chainId, verifyingContract, types, message, signer);
            await contract.hold(operationId, nonce, sellerFinId, buyerFinId, asset, settlement, leg, primaryType, signature, { from: operator });

            expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
            const lock = await contract.getLockInfo(operationId);
            expect(lock[0]).to.equal(assetId);
            expect(lock[1]).to.equal(assetType);
            expect(lock[2]).to.equal(investorFinId);
            expect(lock[3]).to.equal(amount);

            // -----------------------------

            await contract.release(operationId, sellerFinId, toFixedDecimals(amount, decimals), { from: operator });

            expect(await contract.getBalance(assetId, sellerFinId)).to.equal(toFixedDecimals(amount, decimals));
            expect(await contract.getBalance(assetId, buyerFinId)).to.equal(`${(0).toFixed(decimals)}`);
            // await expect(contract.getLockInfo(operationId)).to.be.revertedWith('Lock not found'); // TODO update chai

          });

          // it(`hold/redeem operations (decimals: ${decimals}, assetAmount: ${assetAmount}, settlementAmount: ${settlementAmount})`, async () => {
          //   const assetId = `bank-us:102:${uuid()}`;
          //
          //
          //   const issuer = Wallet.createRandom();
          //   const issuerFinId = getFinId(issuer);
          //
          //   const investor = Wallet.createRandom();
          //   const investorFinId = getFinId(investor);
          //
          //   // ----------------------------------------------------------
          //
          //   expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
          //   await contract.issue(investorFinId, term(assetId, 'finp2p', `${assetAmount.toFixed(decimals)}`), { from: operator });
          //   expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${assetAmount.toFixed(decimals)}`);
          //
          //   // -----------------------------
          //
          //   const operationId = `0x${uuidv4().replaceAll('-', '')}`;
          //   const redeemAmount = assetAmount;
          //   const redeemSettlementAmount = 50;
          //   const redeemNonce = `${generateNonce().toString('hex')}`;
          //   const asset = term(assetId, 'finp2p', `${redeemAmount.toFixed(decimals)}`);
          //   const settlement = term('USD', 'fiat', `${redeemSettlementAmount.toFixed(decimals)}`);
          //   const redemptionSignature = await sign(chainId, verifyingContract, REDEMPTION_TYPES,
          //     newRedemptionMessage(redeemNonce, finId(issuerFinId), finId(investorFinId), asset, settlement), investor);
          //
          //   await contract.hold(operationId, redeemNonce, investorFinId, issuerFinId,
          //     asset, settlement, Leg.Asset, PrimaryType.Redemption, redemptionSignature, { from: operator });
          //   const lock = await contract.getLockInfo(operationId);
          //   expect(lock[0]).to.equal(assetId);
          //   expect(lock[1]).to.equal('finp2p');
          //   expect(lock[2]).to.equal(investorFinId);
          //   expect(lock[3]).to.equal(`${assetAmount.toFixed(decimals)}`);
          //   expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
          //
          //   // -----------------------------
          //   await contract.withholdRedeem(operationId, investorFinId, `${redeemAmount.toFixed(decimals)}`, { from: operator });
          //   expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
          //   // await expect(contract.getLockInfo(operationId)).to.be.revertedWith('Lock not found'); // TODO update chai
          // });

        });
      });
    });
  });


});
