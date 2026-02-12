// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "chai";
import { EarmarkEscrow, ERC20WithOperator } from "../typechain-types";
import { v4 as uuidv4, v4 as uuid } from "uuid";
import { HDNodeWallet, Signer, Wallet } from "ethers";
import { Earmark, getFinId, ReceiptAssetType, ReceiptOperationType, ReceiptProof, signReceiptProof } from "../src";

const erc20Decimals = 4;

const generateReceiptProof = (lockId: string, earmark: Earmark) => {
  const id = uuidv4();
  const executionPlanId = `some-bank:106:${uuidv4()}`;
  const instructionSequenceNumber = 1;
  const receiptProof: ReceiptProof = {
    id,
    operation: earmark.operationType,
    source: {
      accountType: "finId",
      finId: earmark.source
    },
    destination: {
      accountType: "finId",
      finId: earmark.destination
    },
    asset: {
      assetType: ReceiptAssetType.FINP2P,
      assetId: earmark.assetId
    },
    tradeDetails: {
      executionContext: {
        executionPlanId,
        instructionSequenceNumber
      }
    },
    transactionDetails: {
      operationId: lockId,
      transactionId: id
    },
    quantity: earmark.amount,
    signature: ""
  };
  return receiptProof;
}

describe("Earmark escrow test", function() {

  let operator: Signer;
  let tokenAddress: string;
  let investorWallet: HDNodeWallet;
  let receiverWallet: HDNodeWallet;
  let proofProviderWallet: HDNodeWallet;
  let erc20: ERC20WithOperator;
  let earmarkEscrowAddress: string;

  const initialInvBalance = 10000;
  let initialInvBalanceUnits: number;

  async function deployERC20(name: string, symbol: string, decimals: number, operatorAddress: string) {
    const deployer = await ethers.getContractFactory("ERC20WithOperator");
    const contract = await deployer.deploy(name, symbol, decimals, operatorAddress);
    const address = await contract.getAddress();
    return { contract, address };
  }

  async function deployEarmarkEscrow(deployer: HDNodeWallet) {
    const factory = await ethers.getContractFactory("EarmarkEscrow", deployer);
    const contract = await factory.deploy();
    const address = await contract.getAddress();
    return { contract, address };
  }

  async function getEarmarkEscrow(address: string, signer: Signer) {
    return await ethers.getContractAt("EarmarkEscrow", address, signer) as EarmarkEscrow;
  }

  before(async () => {
    [operator] = await ethers.getSigners();
    const operatorAddress = await operator.getAddress();
    investorWallet = Wallet.createRandom();
    receiverWallet = Wallet.createRandom();
    proofProviderWallet = Wallet.createRandom();
    ({
      contract: erc20,
      address: tokenAddress
    } = await deployERC20("Test Token", "TST", erc20Decimals, operatorAddress));
    initialInvBalanceUnits = ethers.parseUnits(`${initialInvBalance}`, erc20Decimals);
    await erc20.mint(await investorWallet.getAddress(), initialInvBalanceUnits);

    await operator.sendTransaction({
      to: await investorWallet.getAddress(),
      value: ethers.parseEther("1.0")  // send 1 ETH
    });
    ({ address: earmarkEscrowAddress } = await deployEarmarkEscrow(investorWallet.connect(operator.provider)));

  });

  it("Should deposit and release funds once earmark proof provided", async function() {
    const investorAddress = await investorWallet.getAddress();
    const receiverAddress = await receiverWallet.getAddress();

    const decimals = await erc20.decimals();
    const depositAmount = "300";
    const depositAmountUnits = ethers.parseUnits(depositAmount, decimals);


    // represents a token transaction on other ledger
    const earmark: Earmark = {
      operationType: ReceiptOperationType.ISSUE,
      assetId: `bank-us:102:${uuid()}`,
      assetType: ReceiptAssetType.FINP2P,
      amount: "1000",
      source: getFinId(receiverWallet),
      destination: getFinId(investorWallet),
      proofSignerFinId: getFinId(proofProviderWallet)
    };

    expect(await erc20.balanceOf(earmarkEscrowAddress)).to.equal(0);


    const erc20Inv = erc20.connect(investorWallet.connect(operator.provider));
    await erc20Inv.approve(earmarkEscrowAddress, depositAmountUnits);

    expect(await erc20.balanceOf(investorAddress)).to.equal(initialInvBalanceUnits);
    expect(await erc20.balanceOf(earmarkEscrowAddress)).to.equal(0);
    expect(await erc20.balanceOf(receiverAddress)).to.equal(0);

    const lockId = "123";
    const earmarkEscrowInv = await getEarmarkEscrow(earmarkEscrowAddress, investorWallet.connect(operator.provider));
    await earmarkEscrowInv.deposit(lockId, tokenAddress, depositAmountUnits, earmark);

    expect(await erc20.balanceOf(investorAddress)).to.equal(initialInvBalanceUnits - depositAmountUnits);
    expect(await erc20.balanceOf(earmarkEscrowAddress)).to.equal(depositAmountUnits);
    expect(await erc20.balanceOf(receiverAddress)).to.equal(0);

    const earmarkEscrow = await getEarmarkEscrow(earmarkEscrowAddress, operator);

    const storedEarmark = await earmarkEscrow.getEarmark(lockId);
    expect(storedEarmark.operationType).to.equal(earmark.operationType);
    expect(storedEarmark.assetId).to.equal(earmark.assetId);
    expect(storedEarmark.assetType).to.equal(earmark.assetType);
    expect(storedEarmark.amount).to.equal(earmark.amount);
    expect(storedEarmark.source).to.equal(earmark.source);
    expect(storedEarmark.destination).to.equal(earmark.destination);

    await expect(earmarkEscrow.release(lockId, await receiverWallet.getAddress())).to.be.revertedWith("Earmark proof not provided");

    // ----- providing proof -----

    const receiptProof = generateReceiptProof(lockId, earmark)
    const { chainId, verifyingContract } = await earmarkEscrow.eip712Domain();
    receiptProof.signature = await signReceiptProof(chainId, verifyingContract, receiptProof, proofProviderWallet);

    await earmarkEscrow.provideEarmarkProof(lockId, receiptProof);

    await earmarkEscrow.release(lockId, await receiverWallet.getAddress());

    expect(await erc20.balanceOf(investorAddress)).to.equal(initialInvBalanceUnits - depositAmountUnits);
    expect(await erc20.balanceOf(earmarkEscrowAddress)).to.equal(0);
    expect(await erc20.balanceOf(receiverAddress)).to.equal(depositAmountUnits);

  });


});
