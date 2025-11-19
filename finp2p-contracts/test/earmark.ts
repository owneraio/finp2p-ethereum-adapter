// @ts-ignore
import { ethers } from "hardhat";
import { expect } from "chai";
import { EarmarkEscrow, ERC20WithOperator } from "../typechain-types";
import { v4 as uuid } from "uuid";
import { HDNodeWallet, Signer, Wallet } from "ethers";
import { getFinId } from "../src";

//   enum AssetType {
//         FINP2P,
//         FIAT,
//         CRYPTOCURRENCY
//     }
//    struct Earmark {
//         ReceiptOperationType operationType;
//         string assetId;
//         AssetType assetType;
//         string amount;
//         string source;
//         string destination;
//     }
//
//     enum ReceiptOperationType {
//         ISSUE,
//         TRANSFER,
//         HOLD,
//         RELEASE,
//         REDEEM
//     }

const OPERATION_TYPE_ISSUE = 0;
const OPERATION_TYPE_TRANSFER = 1;
const OPERATION_TYPE_HOLD = 2;
const OPERATION_TYPE_RELEASE = 3;
const OPERATION_TYPE_REDEEM = 4;

const ASSET_TYPE_FINP2P = 0;
const ASSET_TYPE_FIAT = 1;
const ASSET_TYPE_CRYPTOCURRENCY = 2;

type Earmark = {
  operationType: number;
  assetId: string;
  assetType: number;
  amount: string;
  source: string;
  destination: string;
  proofSignerFinId: string;
}

const erc20Decimals = 4;


describe("Earmark escrow test", function() {

  let operator: Signer;
  let tokenAddress: string;
  let investorWallet: HDNodeWallet;
  let proofProviderWallet: HDNodeWallet;
  let erc20: ERC20WithOperator;
  let earmarkEscrowAddress: string;

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
    proofProviderWallet = Wallet.createRandom();
    ({
      contract: erc20,
      address: tokenAddress
    } = await deployERC20("Test Token", "TST", erc20Decimals, operatorAddress));
    const initialBalance = "10000";
    await erc20.mint(await investorWallet.getAddress(), ethers.parseUnits(initialBalance, erc20Decimals));
    expect(await erc20.balanceOf(await investorWallet.getAddress())).to.equal(ethers.parseUnits(initialBalance, erc20Decimals));

    await operator.sendTransaction({
      to: await investorWallet.getAddress(),
      value: ethers.parseEther("1.0")  // send 1 ETH
    });
    ({ address: earmarkEscrowAddress } = await deployEarmarkEscrow(investorWallet.connect(operator.provider)));

  });

  it("Should deploy EarmarkEscrow contract", async function() {

    const decimals = await erc20.decimals();
    const depositAmount = "300";
    const depositAmountUnits = ethers.parseUnits(depositAmount, decimals);


    // represents a token transaction on other ledger
    const earmark: Earmark = {
      operationType: OPERATION_TYPE_ISSUE,
      assetId: `bank-us:102:${uuid()}`,
      assetType: ASSET_TYPE_FINP2P,
      amount: "1000",
      source: "031670bf8da27e4333b03aebf827eaa226220223fbd6a7e04554fc9b00719cd64d",
      destination: getFinId(investorWallet),
      proofSignerFinId: getFinId(proofProviderWallet)
    };

    expect(await erc20.balanceOf(earmarkEscrowAddress)).to.equal(0);


    const erc20Inv = erc20.connect(investorWallet.connect(operator.provider));
    await erc20Inv.approve(earmarkEscrowAddress, depositAmountUnits);

    const lockId = "123";
    const earmarkEscrowInv = await getEarmarkEscrow(earmarkEscrowAddress, investorWallet.connect(operator.provider));
    await earmarkEscrowInv.deposit(lockId, tokenAddress, depositAmountUnits, earmark);

    expect(await erc20.balanceOf(earmarkEscrowAddress)).to.equal(depositAmountUnits);

    const earmarkEscrow = await getEarmarkEscrow(earmarkEscrowAddress, operator);

    const storedEarmark = await earmarkEscrow.getEarmark(lockId);
    expect(storedEarmark.operationType).to.equal(earmark.operationType);
    expect(storedEarmark.assetId).to.equal(earmark.assetId);
    expect(storedEarmark.assetType).to.equal(earmark.assetType);
    expect(storedEarmark.amount).to.equal(earmark.amount);
    expect(storedEarmark.source).to.equal(earmark.source);
    expect(storedEarmark.destination).to.equal(earmark.destination);


    // await earmarkEscrow.release(depositAmount);

  });


});
