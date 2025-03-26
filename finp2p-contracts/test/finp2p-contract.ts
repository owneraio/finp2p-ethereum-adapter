import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { generateNonce, toFixedDecimals } from "./utils";
import { getFinId } from "../src/contracts/utils";
import { Signer, Wallet } from "ethers";
import {
  eip712Term,
  emptyLoanTerms,
  newInvestmentMessage,
  PrimaryType,
  sign
} from "../src/contracts/eip712";
import type { ExecutionContextManager, FINP2POperatorERC20 } from "../typechain-types";
import {
  AssetType, assetTypeToEIP712, executionContext,
  InstructionExecutor, InstructionType
} from "../src/contracts/model";


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
    const exCtxManagerFactory = await ethers.getContractFactory("ExecutionContextManager");
    const exCtxManager = await exCtxManagerFactory.deploy();
    const finp2POperatorERC20Factory = await ethers.getContractFactory("FINP2POperatorERC20");
    const exCtxManagerAddress = await exCtxManager.getAddress();
    const finp2POperatorERC20 = await finp2POperatorERC20Factory.deploy(exCtxManagerAddress);
    const finp2POperatorERC20Address = await finp2POperatorERC20.getAddress();
    return { exCtxManager, exCtxManagerAddress, finp2POperatorERC20, finp2POperatorERC20Address };
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
    let finp2p: FINP2POperatorERC20;
    let finP2PAddress: string;
    let chainId: bigint;
    let verifyingContract: string;


    before(async () => {
      [operator] = await ethers.getSigners();
      ({
        finp2POperatorERC20: finp2p,
        finp2POperatorERC20Address: finP2PAddress,
        exCtxManager
      } = await loadFixture(deployFinP2PProxyFixture));
      ({ chainId, verifyingContract } = await exCtxManager.eip712Domain());

    });

    it(`Primary sale`, async () => {
      const decimals = 2;
      const domain = { chainId, verifyingContract };
      const primaryType = PrimaryType.PrimarySale;

      const asset = { assetId: generateAssetId(), assetType: AssetType.FinP2P, amount: "10" };
      const settlement = { assetId: generateAssetId(), assetType: AssetType.Fiat, amount: "100" };
      const loan = emptyLoanTerms();

      const assetERC20Address = await deployERC20(asset.assetId, asset.assetId, decimals, finP2PAddress);
      await finp2p.associateAsset(asset.assetId, assetERC20Address, { from: operator });
      const settlementERC20Address = await deployERC20(settlement.assetId, settlement.assetId, decimals, finP2PAddress);
      await finp2p.associateAsset(settlement.assetId, settlementERC20Address, { from: operator });

      const buyer = generateInvestor();
      const seller = generateInvestor();

      const planId = `${uuid()}`;
      await exCtxManager.createExecutionPlan(planId, { from: operator });
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
      const buyerSignature = await sign(chainId, verifyingContract, types, message, buyer.signer);
      await exCtxManager.provideInvestorSignature(executionContext(planId, 1), domain, nonce, buyer.finId, seller.finId, asset, settlement, loan, buyerSignature, { from: operator });

      expect(await finp2p.getBalance(asset.assetId, buyer.finId)).to.equal(`${(0).toFixed(decimals)}`);
      expect(await finp2p.getBalance(asset.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      await expect(finp2p.issue(buyer.finId, settlement.assetId, settlement.assetType, settlement.amount, { from: operator }))
        .to.emit(finp2p, "Issue").withArgs(settlement.assetId, settlement.assetType, buyer.finId, settlement.amount);
      expect(await finp2p.getBalance(settlement.assetId, buyer.finId)).to.equal(toFixedDecimals(settlement.amount, decimals));
      expect(await finp2p.getBalance(settlement.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      // ------------------------

      const operationId = uuid();
      await expect(finp2p.holdWithContext(buyer.finId, seller.finId, settlement.assetId, settlement.assetType, settlement.amount, operationId, executionContext(planId, 1), { from: operator }))
        .to.emit(finp2p, "Hold").withArgs(settlement.assetId, settlement.assetType, buyer.finId, settlement.amount, operationId);
      expect(await finp2p.getBalance(settlement.assetId, buyer.finId)).to.equal(`${(0).toFixed(decimals)}`);
      expect(await finp2p.getBalance(settlement.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      await expect(finp2p.issueWithContext(buyer.finId, asset.assetId, asset.assetType, asset.amount, executionContext(planId, 2), { from: operator }))
        .to.emit(finp2p, "Issue").withArgs(asset.assetId, asset.assetType, buyer.finId, asset.amount);
      expect(await finp2p.getBalance(asset.assetId, buyer.finId)).to.equal(toFixedDecimals(asset.amount, decimals));
      expect(await finp2p.getBalance(asset.assetId, seller.finId)).to.equal(`${(0).toFixed(decimals)}`);

      await expect(finp2p.releaseToWithContext(buyer.finId, seller.finId, settlement.assetId, settlement.assetType, settlement.amount, operationId, executionContext(planId, 3), { from: operator }))
        .to.emit(finp2p, "Release").withArgs(settlement.assetId, settlement.assetType, buyer.finId, seller.finId, settlement.amount, operationId);
      expect(await finp2p.getBalance(settlement.assetId, buyer.finId)).to.equal(`${(0).toFixed(decimals)}`);
      expect(await finp2p.getBalance(settlement.assetId, seller.finId)).to.equal(toFixedDecimals(settlement.amount, decimals));

    });
  });

});
