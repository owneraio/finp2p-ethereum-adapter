import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { getFinId, parseAFCreateAccount } from "../src/contracts/utils";
import { AbiCoder, ContractFactory, keccak256, Signer, toUtf8Bytes, Wallet } from "ethers";
import type { FINP2POperatorERC20Collateral, IAccountFactory, IAssetCollateralAccount } from "../typechain-types";
import { AssetType, term, TokenType } from "../src/contracts/model";
import { expect } from "chai";
import { toFixedDecimals } from "./utils";
import { CollectionType } from "fireblocks-sdk";


describe("Collateral contract test", function() {

  async function deployERC20(name: string, symbol: string, decimals: number, operatorAddress: string) {
    const deployer = await ethers.getContractFactory("ERC20WithOperator");
    const contract = await deployer.deploy(name, symbol, decimals, operatorAddress);
    const address = contract.getAddress();
    return { contract, address };
  }

  async function deployAccountFactory() {
    const deployer = await ethers.getContractFactory("AccountFactoryMock");
    const contract = await deployer.deploy();
    const address = contract.getAddress();
    return { contract, address };
  }

  async function deployFinP2PProxyFixture() {
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
    const signer = Wallet.createRandom();
    const finId = getFinId(signer);
    return { signer, finId };
  }


  describe("FinP2PProxy operations", () => {

    let operator: Signer;
    let finP2P: FINP2POperatorERC20Collateral;
    let accountFactory: IAccountFactory;
    let assetCollateral: IAssetCollateralAccount;
    let accountFactoryAddress: string;
    let finP2PAddress: string;
    let chainId: bigint;
    let verifyingContract: string;

    it(`Collateral`, async () => {
      [operator] = await ethers.getSigners();
      ({ contract: accountFactory, address: accountFactoryAddress } = await loadFixture(deployAccountFactory));
      ({ contract: finP2P, address: finP2PAddress } = await loadFixture(deployFinP2PProxyFixture));
      ({ chainId, verifyingContract } = await finP2P.eip712Domain());

      const borrower = generateInvestor();
      const lender = generateInvestor();

      const assetDecimals = 2;
      const assetId = generateAssetId();
      const { contract: erc20Token, address: erc20TokenAddress } = await deployERC20(assetId, assetId, assetDecimals, finP2PAddress);
      await finP2P.associateAsset(assetId, erc20TokenAddress, TokenType.ERC20, { from: operator });

      const initialAmount = "1000.00";
      await finP2P.issue(borrower.finId, term(assetId, AssetType.FinP2P, initialAmount), { from: operator });

      expect(await finP2P.getBalance(assetId, borrower.finId)).to.equal(toFixedDecimals(initialAmount, assetDecimals));

      const name = "Asset Collateral Account";
      const description = "Description of Asset Collateral Account";
      const source = await borrower.signer.getAddress();
      const destination = await lender.signer.getAddress();

      const strategyId = keccak256(toUtf8Bytes("Asset-Collateral-Account-Strategy"));
      const liabilityFactoryAddress = await accountFactory.getLiabilityFactory();
      const controller = await accountFactory.controller();

      const initParams = new AbiCoder().encode(
        ["uint8", "uint8", "uint256", "uint256"],
        [18, 1, 0, 0]
      );

      const strategyInput = {
        assetContextList: [],
        addressList: [source, destination, liabilityFactoryAddress],
        amountList: [],
        effectiveTimeList: [],
        liabilityDataList: []
      };
      const rsp = await accountFactory.createAccount(name, description, strategyId, controller, initParams, strategyInput, { from: operator });
      const receipt = await rsp.wait();
      if (!receipt) {
        throw new Error("Failed to get transaction receipt");
      }
      const account = parseAFCreateAccount(receipt, accountFactory.interface);
      if (!account) {
        throw new Error("Failed to parse account creation event");
      }
      const { address: collateralAddress } = account;

      const borrowedAmount = 10 ** assetDecimals;

      await erc20Token.approve(collateralAddress, borrowedAmount, { from: borrower.signer });

      const accountCollateral = await ethers.getContractAt("IAssetCollateralAccount", collateralAddress) as IAssetCollateralAccount;

      let val = await finP2P.getBalance(assetId, borrower.finId);
      console.log(`Balance before deposit: ${val}`);
      await accountCollateral.deposit({
        standard: 1,
        addr: erc20TokenAddress,
        tokenId: 0
      }, borrowedAmount, { from: operator });
      val = await finP2P.getBalance(assetId, borrower.finId);
      console.log(`Balance after deposit: ${val}`);

    });

  });
});
