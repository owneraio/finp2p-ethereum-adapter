import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { getFinId } from "../src/contracts/utils";
import { AddressLike, parseUnits, Signer, Wallet, ZeroAddress } from "ethers";
import {
  FinP2PCollateralBasket,
  FINP2POperatorERC20Collateral, IAssetCollateralAccount
} from "../typechain-types";
import { AssetType, CollateralBasketState, operationParams, Phase, term, termToEIP712 } from "../src/contracts/model";
import { expect } from "chai";
import { generateNonce, toFixedDecimals } from "./utils";
import { LegType, loanTerms, newInvestmentMessage, PrimaryType, sign } from "../src/contracts/eip712";


describe("Collateral contract test", function() {

  async function deployERC20(name: string, symbol: string, decimals: number, operatorAddress: string) {
    const deployer = await ethers.getContractFactory("ERC20WithOperator");
    const contract = await deployer.deploy(name, symbol, decimals, operatorAddress);
    const address = await contract.getAddress();
    return { contract, address };
  }

  async function deployAccountFactory() {
    const deployer = await ethers.getContractFactory("AccountFactoryMock");
    const contract = await deployer.deploy();
    const address = contract.getAddress();
    return { contract, address };
  }

  async function deployFinP2PCollateralBasket() {
    const deployer = await ethers.getContractFactory("FinP2PCollateralBasket");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  async function deployFinP2OperatorFixture() {
    const deployer = await ethers.getContractFactory("FINP2POperatorERC20Collateral");
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
    const signer = Wallet.createRandom().connect(ethers.provider);
    const finId = getFinId(signer);
    return { signer, finId };
  }


  describe("FinP2PProxy operations", () => {

    let finP2P: FINP2POperatorERC20Collateral;
    let collateralBasket: FinP2PCollateralBasket;
    let finP2PAddress, collateralBasketAddress: string;

    let chainId: bigint;
    let verifyingContract: string;


    it(`Collateral asset open and close via escrow`, async () => {
      const { address: accountFactoryAddress } = await loadFixture(deployAccountFactory);
      ({
        contract: collateralBasket,
        address: collateralBasketAddress
      } = await loadFixture(deployFinP2PCollateralBasket));
      ({ contract: finP2P, address: finP2PAddress } = await loadFixture(deployFinP2OperatorFixture));
      ({ chainId, verifyingContract } = await finP2P.eip712Domain());

      await collateralBasket.setAccountFactoryAddress(accountFactoryAddress);
      await finP2P.setCollateralAssetManagerAddress(collateralBasketAddress);
      await collateralBasket.grantBasketManagerRole(finP2PAddress);

      const borrower = generateInvestor();
      const lender = generateInvestor();

      const assetDecimals = 18;
      const assetId = generateAssetId();
      const {
        contract: erc20Token,
        address: erc20TokenAddress
      } = await deployERC20(assetId, assetId, assetDecimals, finP2PAddress);
      await finP2P.associateAsset(assetId, erc20TokenAddress);

      const initialAmount = 1000;
      await finP2P.issue(borrower.finId, term(assetId, AssetType.FinP2P, initialAmount.toFixed(assetDecimals)));

      expect(await finP2P.getBalance(assetId, borrower.finId)).to.equal(toFixedDecimals(initialAmount.toFixed(assetDecimals), assetDecimals));

      const borrowedAmount = 750; //10 ** assetDecimals;

      const name = "Asset Collateral Account";
      const description = "Description of Asset Collateral Account";
      const tokenAddressList = [erc20TokenAddress];
      const amountList = [borrowedAmount.toFixed(assetDecimals)];

      const haircutContext = ZeroAddress;
      const priceService = ZeroAddress;
      const pricedInToken = ZeroAddress;
      const liabilityAmount = 1000;
      const controller = finP2PAddress;

      const basketId = uuid();
      await collateralBasket.createCollateralAsset(
        name, description, basketId, tokenAddressList, amountList, borrower.finId, lender.finId,
        {
          haircutContext, priceService, pricedInToken, liabilityAmount, controller
        }
      );

      expect(await collateralBasket.getBasketState(basketId)).to.equal(CollateralBasketState.CREATED);
      expect((await collateralBasket.getBasketTokens(basketId))[0]).to.equal(erc20TokenAddress);
      const escrowBorrower = await collateralBasket.getEscrowBorrower();
      const escrowLender = await collateralBasket.getEscrowLender();

      const collateralAssetId = generateAssetId();
      await finP2P.associateCollateralAsset(collateralAssetId, basketId);

      expect(await finP2P.getBalance(collateralAssetId, borrower.finId)).to.equal("1");
      expect(await finP2P.getBalance(collateralAssetId, lender.finId)).to.equal("0");
      expect(await erc20Token.balanceOf(escrowBorrower)).to.equal(0n);
      expect(await erc20Token.balanceOf(escrowLender)).to.equal(0n);


      // await erc20Token.connect(borrower);
      // await erc20Token.approve(collateralAddress, 100000000);
      // const allowance = await erc20Token.allowance(await borrower.signer.getAddress(), collateralAddress); //TODO: that does not work
      // console.log(allowance);


      const collateralAmount = "1.00";
      const asset = term(collateralAssetId, AssetType.FinP2P, collateralAmount);
      const settlementAssetCode = "USDT";
      const settlement = term(settlementAssetCode, AssetType.FinP2P, "100000000.00");
      const borrowedMoneyAmount = "10000000.00";
      const returnedMoneyAmount = "10000030.00";
      const openTime = "2025-02-01";
      const closeTime = "2025-02-01";
      const loan = loanTerms(openTime, closeTime, borrowedMoneyAmount, returnedMoneyAmount);

      const borrowerNonce = `${generateNonce().toString("hex")}`;
      const borrowerMessage = newInvestmentMessage(PrimaryType.Loan, borrowerNonce, lender.finId, borrower.finId,
        termToEIP712(asset), termToEIP712(settlement), loan);
      const borrowerSignature = await sign(chainId, verifyingContract, borrowerMessage.types, borrowerMessage.message, borrower.signer);

      const lenderNonce = `${generateNonce().toString("hex")}`;
      const lenderMessage = newInvestmentMessage(PrimaryType.Loan, lenderNonce, lender.finId, borrower.finId,
        termToEIP712(asset), termToEIP712(settlement), loan);
      const lenderSignature = await sign(chainId, verifyingContract, lenderMessage.types, lenderMessage.message, lender.signer);

      const dvp1 = uuid();
      await expect(finP2P.hold(borrowerNonce, borrower.finId, lender.finId, asset, settlement, loan,
        operationParams({ chainId, verifyingContract }, PrimaryType.Loan, LegType.Asset, Phase.Initiate, dvp1),
        borrowerSignature)).to.emit(finP2P, "Hold").withArgs(collateralAssetId, AssetType.FinP2P, borrower.finId, collateralAmount, dvp1);

      expect(await finP2P.getBalance(collateralAssetId, borrower.finId)).to.equal("0");
      expect(await finP2P.getBalance(collateralAssetId, lender.finId)).to.equal("0");
      expect(await finP2P.getBalance(assetId, borrower.finId)).to.equal(`${(initialAmount - borrowedAmount).toFixed(assetDecimals)}`);
      expect(await finP2P.getBalance(assetId, lender.finId)).to.equal(`${(0).toFixed(assetDecimals)}`);
      expect(await erc20Token.balanceOf(escrowBorrower)).to.equal(parseUnits(`${borrowedAmount}`, assetDecimals));
      expect(await erc20Token.balanceOf(escrowLender)).to.equal(0n);

      await expect(finP2P.releaseTo(dvp1, lender.finId, collateralAmount))
        .to.emit(finP2P, "Release").withArgs(collateralAssetId, AssetType.FinP2P, borrower.finId, lender.finId, collateralAmount, dvp1);

      expect(await finP2P.getBalance(collateralAssetId, borrower.finId)).to.equal("0");
      expect(await finP2P.getBalance(collateralAssetId, lender.finId)).to.equal("1");
      expect(await finP2P.getBalance(assetId, borrower.finId)).to.equal(`${(initialAmount - borrowedAmount).toFixed(assetDecimals)}`);
      expect(await finP2P.getBalance(assetId, lender.finId)).to.equal(`${(0).toFixed(assetDecimals)}`);
      expect(await erc20Token.balanceOf(escrowBorrower)).to.equal(0n);
      expect(await erc20Token.balanceOf(escrowLender)).to.equal(0n);

      // ----------------------------------------

      const dvp2 = uuid();
      await expect(finP2P.hold(lenderNonce, borrower.finId, lender.finId, asset, settlement, loan,
        operationParams({ chainId, verifyingContract }, PrimaryType.Loan, LegType.Asset, Phase.Close, dvp2),
        lenderSignature)).to.emit(finP2P, "Hold").withArgs(collateralAssetId, AssetType.FinP2P, lender.finId, collateralAmount, dvp2);

      expect(await finP2P.getBalance(collateralAssetId, borrower.finId)).to.equal("0");
      expect(await finP2P.getBalance(collateralAssetId, lender.finId)).to.equal("0");
      expect(await finP2P.getBalance(assetId, borrower.finId)).to.equal(`${(initialAmount - borrowedAmount).toFixed(assetDecimals)}`);
      expect(await finP2P.getBalance(assetId, lender.finId)).to.equal(`${(0).toFixed(assetDecimals)}`);
      expect(await erc20Token.balanceOf(escrowBorrower)).to.equal(parseUnits(`${borrowedAmount}`, assetDecimals));
      expect(await erc20Token.balanceOf(escrowLender)).to.equal(0n);

      await expect(finP2P.releaseTo(dvp2, borrower.finId, collateralAmount))
        .to.emit(finP2P, "Release").withArgs(collateralAssetId, AssetType.FinP2P, lender.finId, borrower.finId, collateralAmount, dvp2);

      expect(await finP2P.getBalance(collateralAssetId, borrower.finId)).to.equal("0");
      expect(await finP2P.getBalance(collateralAssetId, lender.finId)).to.equal("0");
      expect(await finP2P.getBalance(assetId, borrower.finId)).to.equal(`${(initialAmount).toFixed(assetDecimals)}`);
      expect(await finP2P.getBalance(assetId, lender.finId)).to.equal(`${(0).toFixed(assetDecimals)}`);
      expect(await erc20Token.balanceOf(escrowBorrower)).to.equal(0n);
      expect(await erc20Token.balanceOf(escrowLender)).to.equal(0n);
    });

  });
});
