import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { generateNonce, toFixedDecimals } from "./utils";
import {
  eip712Term,
  emptyLoanTerms,
  LegType,
  newInvestmentMessage,
  PrimaryType
} from "@owneraio/finp2p-adapter-models";
import { Signer, Wallet } from "ethers";
import {
  AssetType,
  assetTypeToEIP712,
  ERC20_STANDARD_ID,
  executionContext,
  getFinId,
  InstructionExecutor,
  InstructionType,
  operationParams,
  Phase,
  ReleaseType,
  signEIP712,
  Term
} from "../src";
import { ExecutionContextManager, FINP2POperator } from "../typechain-types";


describe("FinP2P proxy contract test", function() {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployERC20(name: string, symbol: string, decimals: number, operatorAddress: string) {
    const deployer = await ethers.getContractFactory("ERC20WithOperator");
    const contract = await deployer.deploy(name, symbol, decimals, operatorAddress);
    return contract.getAddress();
  }

  async function deployAssetRegistry() {
    const deployer = await ethers.getContractFactory("AssetRegistry");
    const contract = await deployer.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  async function deployERC20Standard(executor: string) {
    const deployer = await ethers.getContractFactory("ERC20Standard");
    const contract = await deployer.deploy(executor);
    const address = await contract.getAddress();
    return { contract, address };
  }


  async function deployFinP2PProxyFixture() {
    const [admin] = await ethers.getSigners();

    const finP2PLib = await ethers.getContractFactory("FinP2P");
    const finP2PLibAddress = await finP2PLib.deploy();

    const { contract: ar, address: assetRegistry } = await deployAssetRegistry();

    const exCtxManagerFactory = await ethers.getContractFactory("ExecutionContextManager", {
      libraries: {
        FinP2P: finP2PLibAddress
      }
    });
    const exCtxManager = await exCtxManagerFactory.deploy();
    const finP2PContractFactory = await ethers.getContractFactory("FINP2POperator", {
      // libraries: {
      //   FinP2P: finP2PLibAddress
      // }
    });
    const exCtxManagerAddress = await exCtxManager.getAddress();
    const finP2PContract = await finP2PContractFactory.deploy(admin, assetRegistry, exCtxManagerAddress);
    const finP2POperatorERC20Address = await finP2PContract.getAddress();
    return {
      exCtxManager,
      exCtxManagerAddress,
      finP2POperatorERC20: finP2PContract,
      finP2POperatorERC20Address: finP2POperatorERC20Address
    };
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
    let exCtxManager: ExecutionContextManager;
    let finp2p: FINP2POperator;
    let finP2PAddress: string;
    let chainId: bigint;
    let verifyingContract: string;


    before(async () => {
      [operator] = await ethers.getSigners();
      ({
        finP2POperatorERC20: finp2p,
        finP2POperatorERC20Address: finP2PAddress,
        exCtxManager
      } = await loadFixture(deployFinP2PProxyFixture));
      ({ chainId, verifyingContract } = await exCtxManager.eip712Domain());

    });

    it(`Primary sale`, async () => {

      const decimals = 2;
      const primaryType = PrimaryType.PrimarySale;
      const phase = Phase.Initiate;

      const asset: Term = { assetId: generateAssetId(), assetType: AssetType.FinP2P, amount: "10" };
      const settlement: Term = { assetId: generateAssetId(), assetType: AssetType.Fiat, amount: "100" };
      const loan = emptyLoanTerms();

      const assetERC20Address = await deployERC20(asset.assetId, asset.assetId, decimals, finP2PAddress);
      await finp2p.associateAsset(asset.assetId, assetERC20Address, ERC20_STANDARD_ID, { from: operator });
      const settlementERC20Address = await deployERC20(settlement.assetId, settlement.assetId, decimals, finP2PAddress);
      await finp2p.associateAsset(settlement.assetId, settlementERC20Address, ERC20_STANDARD_ID, { from: operator });

      const buyer = generateInvestor();
      const seller = generateInvestor();

      const planId = `${uuid()}`;
      await exCtxManager.createExecutionPlan(planId, finP2PAddress, { from: operator });
      await exCtxManager.addInstructionToExecution(executionContext(planId, 1), InstructionType.HOLD, settlement.assetId, settlement.assetType, buyer.finId, seller.finId, settlement.amount, InstructionExecutor.THIS_CONTRACT, "", { from: operator });
      await exCtxManager.addInstructionToExecution(executionContext(planId, 2), InstructionType.ISSUE, asset.assetId, asset.assetType, "", buyer.finId, asset.amount, InstructionExecutor.THIS_CONTRACT, "", { from: operator });
      await exCtxManager.addInstructionToExecution(executionContext(planId, 3), InstructionType.RELEASE, settlement.assetId, settlement.assetType, buyer.finId, seller.finId, settlement.amount, InstructionExecutor.THIS_CONTRACT, "", { from: operator });

      const nonce = `${generateNonce().toString("hex")}`;
      const {
        types,
        message
      } = newInvestmentMessage(primaryType, nonce, buyer.finId, seller.finId,
        eip712Term(asset.assetId, assetTypeToEIP712(asset.assetType), asset.amount),
        eip712Term(settlement.assetId, assetTypeToEIP712(settlement.assetType), settlement.amount),
        loan);
      const buyerSignature = await signEIP712(chainId, verifyingContract, types, message, buyer.signer);

      await exCtxManager.provideInvestorSignature(
        executionContext(planId, 1), nonce, buyer.finId, seller.finId, asset, settlement, loan, buyerSignature, { from: operator });

      expect(await finp2p.getBalance(asset.assetId, buyer.finId)).to.equal(`${(0).toFixed(decimals)}`);
      expect(await finp2p.getBalance(asset.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      await expect(finp2p.issue(buyer.finId, settlement, operationParams(LegType.Asset, primaryType, phase), { from: operator }))
        .to.emit(finp2p, "Issue").withArgs(settlement.assetId, settlement.assetType, buyer.finId, settlement.amount, ["", 0]);
      expect(await finp2p.getBalance(settlement.assetId, buyer.finId)).to.equal(toFixedDecimals(settlement.amount, decimals));
      expect(await finp2p.getBalance(settlement.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      // ------------------------

      const operationId = uuid();
      await expect(finp2p.hold(buyer.finId, seller.finId, settlement,
        operationParams(LegType.Settlement, primaryType, phase, operationId, ReleaseType.Release, executionContext(planId, 1)), { from: operator }))
        .to.emit(finp2p, "Hold").withArgs(settlement.assetId, settlement.assetType, buyer.finId, settlement.amount, operationId, [planId, 1]);
      expect(await finp2p.getBalance(settlement.assetId, buyer.finId)).to.equal(`${(0).toFixed(decimals)}`);
      expect(await finp2p.getBalance(settlement.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      await expect(finp2p.issue(buyer.finId, asset,
        operationParams(LegType.Asset, primaryType, phase, '', ReleaseType.Release, executionContext(planId, 2)), { from: operator }))
        .to.emit(finp2p, "Issue").withArgs(asset.assetId, asset.assetType, buyer.finId, asset.amount, [planId, 2]);
      expect(await finp2p.getBalance(asset.assetId, buyer.finId)).to.equal(toFixedDecimals(asset.amount, decimals));
      expect(await finp2p.getBalance(asset.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      await expect(finp2p.releaseTo(
        buyer.finId, seller.finId, settlement,
        operationParams(LegType.Settlement, primaryType, phase, operationId, ReleaseType.Release, executionContext(planId, 3)), { from: operator }))
        .to.emit(finp2p, "Release").withArgs(settlement.assetId, settlement.assetType, buyer.finId, seller.finId, settlement.amount, operationId, [planId, 3]);
      expect(await finp2p.getBalance(settlement.assetId, buyer.finId)).to.equal(`${(0).toFixed(decimals)}`);
      expect(await finp2p.getBalance(settlement.assetId, seller.finId)).to.equal(toFixedDecimals(settlement.amount, decimals));

    });
  });

});
