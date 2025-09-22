import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { generateNonce, toFixedDecimals, PrimaryType, LegType } from "./utils";
import { Signer, Wallet } from "ethers";
import {
  EIP712LoanTerms,
  emptyLoanTerms,
  loanTerms,
  newInvestmentMessage,
  signEIP712
} from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { FINP2POperatorERC20, FinP2PSignatureVerifier } from "../typechain-types";
import {
  AssetType,
  emptyTerm,
  operationParams,
  Phase,
  ReleaseType,
  term,
  Term,
  termToEIP712,
  getFinId
} from "../src";


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
    const signer = Wallet.createRandom();
    const finId = getFinId(signer);
    return { signer, finId };
  }

  function extractInvestors(
    buyer: { signer: Signer, finId: string },
    seller: { signer: Signer, finId: string },
    leg: LegType,
    phase: Phase
  ): { from: string, to: string, signer: Signer } {
    switch (leg) {
      case LegType.Asset:
        switch (phase) {
          case Phase.Initiate:
            return { from: seller.finId, to: buyer.finId, signer: seller.signer };
          case Phase.Close:
            return { from: buyer.finId, to: seller.finId, signer: buyer.signer };
          default:
            throw new Error("Invalid phase");
        }
      case LegType.Settlement:
        switch (phase) {
          case Phase.Initiate:
            return { from: buyer.finId, to: seller.finId, signer: buyer.signer };
          case Phase.Close:
            return { from: seller.finId, to: buyer.finId, signer: seller.signer };
          default:
            throw new Error("Invalid phase");
        }
      default:
        throw new Error("Invalid leg");
    }
  }

  function extractAsset(asset: Term, settlement: Term, loan: FinP2PSignatureVerifier.LoanTermStruct, primaryType: PrimaryType, leg: LegType, phase: Phase): Term {
    if (primaryType === PrimaryType.Loan && leg === LegType.Settlement) {
      switch (phase) {
        case Phase.Initiate:
          return term(settlement.assetId, settlement.assetType, loan.borrowedMoneyAmount);
        case Phase.Close:
          return term(settlement.assetId, settlement.assetType, loan.returnedMoneyAmount);
      }
    }
    switch (leg) {
      case LegType.Asset:
        return asset;
      case LegType.Settlement:
        return settlement;
      default:
        throw new Error("Invalid leg");
    }
  }

  describe("FinP2PProxy operations", () => {

    let operator: Signer;
    let contract: FINP2POperatorERC20;
    let finP2PAddress: string;
    let chainId: bigint;
    let verifyingContract: string;

    const testCases: {
      primaryTypes: PrimaryType[],
      legs: LegType[],
      phases: Phase[],
      asset: Term,
      settlement: Term,
      loan: EIP712LoanTerms,
      decimals: number
    }[] = [{
      primaryTypes: [PrimaryType.PrimarySale, PrimaryType.Buying, PrimaryType.Selling, PrimaryType.PrivateOffer],
      legs: [LegType.Asset, LegType.Settlement],
      phases: [Phase.Initiate],
      asset: term(generateAssetId(), AssetType.FinP2P, "10"),
      settlement: term("USD", AssetType.Fiat, "100"),
      loan: emptyLoanTerms(),
      decimals: 0
    }, {
      primaryTypes: [PrimaryType.PrimarySale, PrimaryType.Buying, PrimaryType.Selling, PrimaryType.PrivateOffer],
      legs: [LegType.Asset, LegType.Settlement],
      phases: [Phase.Initiate],
      asset: term(generateAssetId(), AssetType.FinP2P, "10.13"),
      settlement: term("GBP", AssetType.Fiat, "10.13"),
      loan: emptyLoanTerms(),
      decimals: 2
    }, {
      primaryTypes: [PrimaryType.PrimarySale, PrimaryType.Buying, PrimaryType.Selling, PrimaryType.PrivateOffer],
      legs: [LegType.Asset, LegType.Settlement],
      phases: [Phase.Initiate],
      asset: term(generateAssetId(), AssetType.FinP2P, "10.0001"),
      settlement: term(generateAssetId(), AssetType.FinP2P, "10"),
      loan: emptyLoanTerms(),
      decimals: 4
    }, {
      primaryTypes: [PrimaryType.Transfer],
      legs: [LegType.Asset],
      phases: [Phase.Initiate, Phase.Close],
      asset: term(generateAssetId(), AssetType.FinP2P, "30"),
      settlement: emptyTerm(),
      loan: emptyLoanTerms(),
      decimals: 2
    }, {
      primaryTypes: [PrimaryType.Redemption],
      legs: [LegType.Asset, LegType.Settlement],
      phases: [Phase.Initiate],
      asset: term(generateAssetId(), AssetType.FinP2P, "30"),
      settlement: term(generateAssetId(), AssetType.Fiat, "10"),
      loan: emptyLoanTerms(),
      decimals: 2
    }, {
      primaryTypes: [PrimaryType.Loan],
      legs: [LegType.Asset, LegType.Settlement],
      phases: [Phase.Initiate],
      asset: term(generateAssetId(), AssetType.FinP2P, "1.01"),
      settlement: term("EUR", AssetType.Fiat, "10000"),
      loan: loanTerms("2025-02-01", "2025-02-01", "10000000.00", "10000030.00"),
      decimals: 18
    }];

    before(async () => {
      [operator] = await ethers.getSigners();
      ({ contract, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture));
      ({ chainId, verifyingContract } = await contract.eip712Domain());
      for (const term of testCases) {
        const asset = await deployERC20(term.asset.assetId, term.asset.assetId, term.decimals, finP2PAddress);
        await contract.associateAsset(term.asset.assetId, asset, { from: operator });

        const settlement = await deployERC20(term.settlement.assetId, term.settlement.assetId, term.decimals, finP2PAddress);
        await contract.associateAsset(term.settlement.assetId, settlement, { from: operator });
      }
    });

    testCases.forEach(({ decimals, asset, settlement, loan, primaryTypes, legs, phases }) => {
      primaryTypes.forEach((primaryType) => {
        legs.forEach((leg) => {
          phases.forEach((phase) => {
            it(`issue/transfer/redeem operations (asset: ${asset}, settlement ${settlement}, primaryType: ${primaryType}, leg: ${leg}, phase: ${phase}, decimals: ${decimals}`, async () => {
              const buyer = generateInvestor();
              const seller = generateInvestor();
              const { from, to, signer } = extractInvestors(buyer, seller, leg, phase);
              const { assetId, assetType, amount } = extractAsset(asset, settlement, loan, primaryType, leg, phase);

              expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
              await expect(contract.issue(from, term(assetId, assetType, amount), { from: operator }))
                .to.emit(contract, "Issue").withArgs(assetId, assetType, from, amount);
              expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));

              const nonce = `${generateNonce().toString("hex")}`;
              const {
                types,
                message
              } = newInvestmentMessage(primaryType, nonce, buyer.finId, seller.finId, termToEIP712(asset), termToEIP712(settlement), loan);
              const signature = await signEIP712(chainId, verifyingContract, types, message, signer);
              await expect(contract.transfer(nonce, seller.finId, buyer.finId, asset, settlement, loan, operationParams(leg, primaryType, phase), signature, { from: operator }))
                .to.emit(contract, "Transfer").withArgs(assetId, assetType, from, to, amount);

              expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
              expect(await contract.getBalance(assetId, to)).to.equal(toFixedDecimals(amount, decimals));

              await contract.redeem(to, term(assetId, assetType, amount), { from: operator });
              expect(await contract.getBalance(assetId, to)).to.equal(`${(0).toFixed(decimals)}`);
            });

            it(`hold/release operations (asset: ${asset}, settlement ${settlement}, primaryType: ${primaryType}, leg: ${leg}, phase: ${phase},decimals: ${decimals})`, async () => {
              const buyer = generateInvestor();
              const seller = generateInvestor();
              const { from, to, signer } = extractInvestors(buyer, seller, leg, phase);
              const { assetId, assetType, amount } = extractAsset(asset, settlement, loan, primaryType, leg, phase);

              expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
              await expect(contract.issue(from, term(assetId, assetType, amount), { from: operator }))
                .to.emit(contract, "Issue").withArgs(assetId, assetType, from, amount);
              expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));

              const operationId = uuid();
              const nonce = `${generateNonce().toString("hex")}`;
              const {
                types,
                message
              } = newInvestmentMessage(primaryType, nonce, buyer.finId, seller.finId, termToEIP712(asset), termToEIP712(settlement), loan);
              const signature = await signEIP712(chainId, verifyingContract, types, message, signer);
              await expect(contract.hold(nonce, seller.finId, buyer.finId, asset, settlement, loan, operationParams(leg, primaryType, phase, operationId, ReleaseType.Release), signature, { from: operator }))
                .to.emit(contract, "Hold").withArgs(assetId, assetType, from, amount, operationId);

              expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
              const lock = await contract.getLockInfo(operationId);
              expect(lock[0]).to.equal(assetId);
              expect(lock[1]).to.equal(assetType);
              expect(lock[2]).to.equal(from);
              expect(lock[3]).to.equal(to);
              expect(lock[4]).to.equal(amount);

              await expect(contract.releaseTo(operationId, to, amount, { from: operator }))
                .to.emit(contract, "Release").withArgs(assetId, assetType, from, to, amount, operationId);

              expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
              expect(await contract.getBalance(assetId, to)).to.equal(toFixedDecimals(amount, decimals));
              await expect(contract.getLockInfo(operationId)).to.be.revertedWith("Contract not found"); // TODO update chai

            });

            it(`hold/rollback operations (asset: ${asset}, settlement ${settlement}, primaryType: ${primaryType}, leg: ${leg}, phase: ${phase},decimals: ${decimals})`, async () => {
              const buyer = Wallet.createRandom();
              const buyerFinId = getFinId(buyer);
              const seller = Wallet.createRandom();
              const sellerFinId = getFinId(seller);

              let assetId: string, assetType: AssetType, amount: string;
              let from: string, to: string;
              let signer: Signer;
              switch (leg) {
                case LegType.Asset:
                  ({ assetId, assetType, amount } = asset);
                  signer = seller;
                  from = sellerFinId;
                  to = buyerFinId;
                  break;
                case LegType.Settlement:
                  ({ assetId, assetType, amount } = settlement);
                  if (primaryType === PrimaryType.Loan) {
                    switch (phase) {
                      case Phase.Initiate:
                        amount = loan.borrowedMoneyAmount;
                        break;
                      case Phase.Close:
                        amount = loan.returnedMoneyAmount;
                        break;
                    }
                  }
                  signer = buyer;
                  from = buyerFinId;
                  to = sellerFinId;
                  break;
                default:
                  throw new Error("Invalid leg");
              }


              expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
              await expect(contract.issue(from, term(assetId, assetType, amount), { from: operator }))
                .to.emit(contract, "Issue").withArgs(assetId, assetType, from, amount);
              expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));

              const operationId = uuid();
              const nonce = `${generateNonce().toString("hex")}`;
              const {
                types,
                message
              } = newInvestmentMessage(primaryType, nonce, buyerFinId, sellerFinId, termToEIP712(asset), termToEIP712(settlement), loan);
              const signature = await signEIP712(chainId, verifyingContract, types, message, signer);
              await expect(contract.hold(nonce, sellerFinId, buyerFinId, asset, settlement, loan,
                operationParams(leg, primaryType, Phase.Initiate, operationId, ReleaseType.Release), signature, { from: operator }))
                .to.emit(contract, "Hold").withArgs(assetId, assetType, from, amount, operationId);

              expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
              const lock = await contract.getLockInfo(operationId);
              expect(lock[0]).to.equal(assetId);
              expect(lock[1]).to.equal(assetType);
              expect(lock[2]).to.equal(from);
              expect(lock[3]).to.equal(to);
              expect(lock[4]).to.equal(amount);

              await expect(contract.releaseBack(operationId, { from: operator }))
                .to.emit(contract, "Release").withArgs(assetId, assetType, from, "", amount, operationId);

              expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));
              expect(await contract.getBalance(assetId, to)).to.equal(`${(0).toFixed(decimals)}`);
              await expect(contract.getLockInfo(operationId)).to.be.revertedWith("Contract not found"); // TODO update chai
            });

            it(`hold/redeem operations (asset: ${asset}, settlement ${settlement}, leg: ${leg}, phase: ${phase}, decimals: ${decimals})`, async () => {
              if (primaryType !== PrimaryType.Redemption) {
                return;
              }
              const issuer = Wallet.createRandom();
              const issuerFinId = getFinId(issuer);

              const owner = Wallet.createRandom();
              const ownerFinId = getFinId(owner);

              let assetId: string, assetType: AssetType, amount: string;
              let investorFinId: string;
              let signer: Signer;
              switch (leg) {
                case LegType.Asset:
                  ({ assetId, assetType, amount } = asset);
                  signer = owner;
                  investorFinId = ownerFinId;
                  break;
                case LegType.Settlement:
                  ({ assetId, assetType, amount } = settlement);
                  signer = issuer;
                  investorFinId = issuerFinId;
                  break;
                default:
                  throw new Error("Invalid leg");
              }

              // ----------------------------------------------------------

              expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
              await expect(contract.issue(investorFinId, term(assetId, assetType, amount), { from: operator }))
                .to.emit(contract, "Issue").withArgs(assetId, assetType, investorFinId, amount);
              expect(await contract.getBalance(assetId, investorFinId)).to.equal(toFixedDecimals(amount, decimals));

              // -----------------------------

              const operationId = uuid();
              const nonce = `${generateNonce().toString("hex")}`;
              const {
                types,
                message
              } = newInvestmentMessage(PrimaryType.Redemption, nonce, issuerFinId, investorFinId, termToEIP712(asset), termToEIP712(settlement), loan);
              const signature = await signEIP712(chainId, verifyingContract, types, message, signer);

              await expect(contract.hold(nonce, investorFinId, issuerFinId, asset, settlement, loan, operationParams(leg, PrimaryType.Redemption, phase, operationId, ReleaseType.Redeem), signature, { from: operator }))
                .to.emit(contract, "Hold").withArgs(assetId, assetType, investorFinId, amount, operationId);
              const lock = await contract.getLockInfo(operationId);
              expect(lock[0]).to.equal(assetId);
              expect(lock[1]).to.equal(assetType);
              expect(lock[2]).to.equal(investorFinId);
              expect(lock[3]).to.equal("");
              expect(lock[4]).to.equal(amount);
              expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);

              // -----------------------------
              await expect(contract.releaseAndRedeem(operationId, investorFinId, amount, { from: operator }))
                .to.emit(contract, "Redeem").withArgs(assetId, assetType, investorFinId, amount, operationId);

              expect(await contract.getBalance(assetId, investorFinId)).to.equal(`${(0).toFixed(decimals)}`);
              await expect(contract.getLockInfo(operationId)).to.be.revertedWith("Contract not found");
            });
          });
        });

      });
    });
  });


});
