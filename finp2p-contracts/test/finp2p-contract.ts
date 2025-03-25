import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
// @ts-ignore
import { ethers } from "hardhat";
import { v4 as uuid } from "uuid";
import { generateNonce, toFixedDecimals } from "./utils";
import { getFinId } from "../src/contracts/utils";
import { Signer, Wallet } from "ethers";
import {
  EIP712LoanTerms,
  emptyLoanTerms,
  LegType,
  loanTerms,
  newInvestmentMessage,
  PrimaryType,
  sign
} from "../src/contracts/eip712";
import type { ExecutionContextManager, FINP2POperatorERC20, FinP2PSignatureVerifier } from "../typechain-types";
import {
  AssetType,
  emptyTerm, InstructionExecutor,
  operationParams, OperationType,
  Phase,
  ReleaseType,
  term,
  Term,
  termToEIP712
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
    let contract: FINP2POperatorERC20;
    let finP2PAddress: string;
    let chainId: bigint;
    let verifyingContract: string;


    before(async () => {
      [operator] = await ethers.getSigners();
      ({
        finp2POperatorERC20: contract,
        finp2POperatorERC20Address: finP2PAddress,
        exCtxManager
      } = await loadFixture(deployFinP2PProxyFixture));
      ({ chainId, verifyingContract } = await exCtxManager.eip712Domain());

    });

    it(`test`, async () => {
      const decimals = 2;
      const domain = { chainId, verifyingContract };
      const primaryType = PrimaryType.PrimarySale;

      const asset = term(generateAssetId(), AssetType.FinP2P, "10");
      const settlement = term(generateAssetId(), AssetType.Fiat, "100");
      const loan = emptyLoanTerms()

      const assetERC20Address = await deployERC20(asset.assetId, asset.assetId, decimals, finP2PAddress);
      await contract.associateAsset(asset.assetId, assetERC20Address, { from: operator });
      const settlementERC20Address = await deployERC20(settlement.assetId, settlement.assetId, decimals, finP2PAddress);
      await contract.associateAsset(settlement.assetId, settlementERC20Address, { from: operator });

      const buyer = generateInvestor();
      const seller = generateInvestor();

      const planId = `${uuid()}`;
      await exCtxManager.createExecutionContext(planId, { from: operator });
      await exCtxManager.addInstructionToExecution({planId, sequence: 1}, OperationType.HOLD, settlement.assetId, settlement.assetType, buyer.finId, seller.finId, settlement.amount, InstructionExecutor.THIS_CONTRACT, "", { from: operator });
      await exCtxManager.addInstructionToExecution({planId, sequence: 1}, OperationType.ISSUE, asset.assetId, asset.assetType, seller.finId, buyer.finId, asset.amount, InstructionExecutor.THIS_CONTRACT, "", { from: operator });
      await exCtxManager.addInstructionToExecution({planId, sequence: 1}, OperationType.RELEASE, settlement.assetId, settlement.assetType, buyer.finId, seller.finId, settlement.amount, InstructionExecutor.THIS_CONTRACT, "", { from: operator });

      const nonce = `${generateNonce().toString("hex")}`;
      const { types, message } = newInvestmentMessage(primaryType, nonce, buyer.finId, seller.finId, termToEIP712(asset), termToEIP712(settlement), loan);
      const buyerSignature = await sign(chainId, verifyingContract, types, message, buyer.signer);
      await exCtxManager.provideInvestorSignature({planId, sequence: 1}, domain, nonce, buyer.finId, seller.finId, asset, settlement, loan, buyerSignature, { from: operator });



      // expect(await contract.getBalance(asset, from)).to.equal(`${(0).toFixed(decimals)}`);
      // await expect(contract.issue(from, term(assetId, assetType, amount), { from: operator }))
      //   .to.emit(contract, "Issue").withArgs(assetId, assetType, from, amount);
      // expect(await contract.getBalance(assetId, from)).to.equal(toFixedDecimals(amount, decimals));
      //
      // await expect(contract.transfer(nonce, seller.finId, buyer.finId, asset, settlement, loan, operationParams({
      //   chainId,
      //   verifyingContract
      // }, primaryType, leg, phase), signature, { from: operator }))
      //   .to.emit(contract, "Transfer").withArgs(assetId, assetType, from, to, amount);
      //
      // expect(await contract.getBalance(assetId, from)).to.equal(`${(0).toFixed(decimals)}`);
      // expect(await contract.getBalance(assetId, to)).to.equal(toFixedDecimals(amount, decimals));
      //
      // await contract.redeem(to, term(assetId, assetType, amount), { from: operator });
      // expect(await contract.getBalance(assetId, to)).to.equal(`${(0).toFixed(decimals)}`);

    });
  });

});
