import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuidv4, v4 as uuid } from "uuid";
import { generateNonce, toFixedDecimals } from "./utils";
import { getFinId } from "../src/contracts/utils";
import { Signer, Wallet } from "ethers";
import { Leg, newInvestmentMessage, PrimaryType, sign, Term, term } from "../src/contracts/eip712";
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

  function generateInvestor(): {
    signer: Signer, finId: string
  } {
    const signer =  Wallet.createRandom();
    const finId = getFinId(signer);
    return { signer, finId }
  }

  function extractInvestors(buyer: { signer: Signer, finId: string}, seller: { signer: Signer, finId: string},  leg: Leg):
    { from: string, to: string, signer: Signer }
  {
    switch (leg) {
      case Leg.Asset:
        return { from: seller.finId, to: buyer.finId, signer: seller.signer }
      case Leg.Settlement:
        return { from: buyer.finId, to: seller.finId, signer: buyer.signer }
      default:
        throw new Error('Invalid leg')
    }
  }

  function extractAsset(asset: Term, settlement: Term, leg: Leg): Term {
    switch (leg) {
      case Leg.Asset:
       return asset
      case Leg.Settlement:
        return settlement
      default:
        throw new Error('Invalid leg')
    }
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
        const asset = await deployERC20(term.asset.assetId, term.asset.assetId, term.decimals, finP2PAddress);
        await contract.associateAsset(term.asset.assetId, asset, { from: operator });

        const settlement = await deployERC20(term.settlement.assetId, term.settlement.assetId, term.decimals, finP2PAddress);
        await contract.associateAsset(term.settlement.assetId, settlement, { from: operator });
      }
    });


    terms.forEach(({decimals, asset, settlement}) => {
      legs.forEach((leg) => {

        primaryTypes.forEach((primaryType) => {
          it(`issue/transfer/redeem operations (asset: ${asset}, settlement ${settlement}, primaryType: ${primaryType}, leg: ${leg}, decimals: ${decimals}`, async () => {
            const buyer = generateInvestor();
            const seller = generateInvestor();
            const { from, to, signer } = extractInvestors(buyer, seller, leg)
            const { assetId, assetType, amount } = extractAsset(asset, settlement, leg);

            expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
            await contract.issue(from, term(assetId, assetType, amount), { from: operator });
            expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));

            const nonce = `${generateNonce().toString('hex')}`;
            const { types, message } = newInvestmentMessage(primaryType, nonce, buyer.finId, seller.finId, asset, settlement);
            const signature = await sign(chainId, verifyingContract, types, message, signer);
            await contract.transfer(nonce, seller.finId, buyer.finId, asset, settlement, leg, primaryType, signature, { from: operator });

            expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
            expect(await contract.getBalance(assetId, to)).to.equal(toFixedDecimals(amount, decimals));

            await contract.redeem(to, term(assetId, assetType, amount), { from: operator });
            expect(await contract.getBalance(assetId, to)).to.equal(`${(0).toFixed(decimals)}`);
          });

          it(`hold/release operations (asset: ${asset}, settlement ${settlement}, primaryType: ${primaryType}, leg: ${leg}, decimals: ${decimals})`, async () => {
            const buyer = generateInvestor();
            const seller = generateInvestor();
            const { from, to, signer } = extractInvestors(buyer, seller, leg)
            const { assetId, assetType, amount } = extractAsset(asset, settlement, leg);

            expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
            await contract.issue(from, term(assetId, assetType, amount), { from: operator });
            expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));

            const operationId = `0x${uuidv4().replaceAll('-', '')}`;
            const nonce = `${generateNonce().toString('hex')}`;
            const { types, message } = newInvestmentMessage(primaryType, nonce, buyer.finId, seller.finId, asset, settlement);
            const signature = await sign(chainId, verifyingContract, types, message, signer);
            await contract.hold(operationId, nonce, seller.finId, buyer.finId, asset, settlement, leg, primaryType, signature, { from: operator });

            expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
            const lock = await contract.getLockInfo(operationId);
            expect(lock[0]).to.equal(assetId);
            expect(lock[1]).to.equal(assetType);
            expect(lock[2]).to.equal(from);
            expect(lock[3]).to.equal(amount);

            await contract.release(operationId, to, toFixedDecimals(amount, decimals), { from: operator });

            expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
            expect(await contract.getBalance(assetId, to)).to.equal(toFixedDecimals(amount, decimals));
            // await expect(contract.getLockInfo(operationId)).to.be.revertedWith('Lock not found'); // TODO update chai

          });

          it(`hold/rollback operations (asset: ${asset}, settlement ${settlement}, primaryType: ${primaryType}, leg: ${leg}, decimals: ${decimals})`, async () => {
            const buyer =  Wallet.createRandom();
            const buyerFinId = getFinId(buyer);
            const seller = Wallet.createRandom();
            const sellerFinId = getFinId(seller);

            let assetId: string, assetType: string, amount: string;
            let from: string, to: string
            let signer: Signer;
            switch (leg) {
              case Leg.Asset:
                ({assetId, assetType, amount} = asset);
                signer = seller;
                from = sellerFinId;
                to = buyerFinId;
                break
              case Leg.Settlement:
                ({assetId, assetType, amount} = settlement);
                signer = buyer;
                from = buyerFinId;
                to = sellerFinId;
                break
              default:
                throw new Error('Invalid leg')
            }

            expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
            await contract.issue(from, term(assetId, assetType, amount), { from: operator });
            expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));

            const operationId = `0x${uuidv4().replaceAll('-', '')}`;
            const nonce = `${generateNonce().toString('hex')}`;
            const { types, message } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, asset, settlement);
            const signature = await sign(chainId, verifyingContract, types, message, signer);
            await contract.hold(operationId, nonce, sellerFinId, buyerFinId, asset, settlement, leg, primaryType, signature, { from: operator });

            expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
            const lock = await contract.getLockInfo(operationId);
            expect(lock[0]).to.equal(assetId);
            expect(lock[1]).to.equal(assetType);
            expect(lock[2]).to.equal(from);
            expect(lock[3]).to.equal(amount);

            await contract.rollback(operationId, { from: operator });

            expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));
            expect(await contract.getBalance(assetId, to)).to.equal(`${(0).toFixed(decimals)}`);
            // await expect(contract.getLockInfo(operationId)).to.be.revertedWith('Lock not found'); // TODO update chai

          });
        });

        it(`hold/redeem operations (asset: ${asset}, settlement ${settlement}, leg: ${leg}, decimals: ${decimals})`, async () => {
          const issuer = Wallet.createRandom();
          const issuerFinId = getFinId(issuer);

          const owner = Wallet.createRandom();
          const ownerFinId = getFinId(owner);

          let assetId: string, assetType: string, amount: string;
          let investorFinId: string
          let signer: Signer;
          switch (leg) {
            case Leg.Asset:
              ({assetId, assetType, amount} = asset);
              signer = owner;
              investorFinId = ownerFinId;
              break
            case Leg.Settlement:
              ({assetId, assetType, amount} = settlement);
              signer = issuer
              investorFinId = issuerFinId;
              break
            default:
              throw new Error('Invalid leg')
          }

          // ----------------------------------------------------------

          expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
          await contract.issue(investorFinId, term(assetId, assetType, toFixedDecimals(amount, decimals)), { from: operator });
          expect(await contract.getBalance(assetId, investorFinId)).to.equal(toFixedDecimals(amount, decimals));

          // -----------------------------

          const operationId = `0x${uuidv4().replaceAll('-', '')}`;
          const nonce = `${generateNonce().toString('hex')}`;
          const { types, message } = newInvestmentMessage(PrimaryType.Redemption, nonce, issuerFinId, investorFinId, asset, settlement);
          const signature = await sign(chainId, verifyingContract, types, message, signer);

          await contract.hold(operationId, nonce, investorFinId, issuerFinId, asset, settlement, leg, PrimaryType.Redemption, signature, { from: operator });
          const lock = await contract.getLockInfo(operationId);
          expect(lock[0]).to.equal(assetId);
          expect(lock[1]).to.equal(assetType);
          expect(lock[2]).to.equal(investorFinId);
          expect(lock[3]).to.equal(amount);
          expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);

          // -----------------------------
          await contract.withholdRedeem(operationId, investorFinId, amount, { from: operator });
          expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
          // await expect(contract.getLockInfo(operationId)).to.be.revertedWith('Lock not found'); // TODO update chai
        });
      });
    });
  });


});
