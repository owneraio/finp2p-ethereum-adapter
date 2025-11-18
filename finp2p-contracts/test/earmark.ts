// @ts-ignore
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";

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
}

describe("Earmark escrow test", function() {

  async function deployEarmarkEscrow(
    tokenAddress: string,
    earmark: Earmark,
    proofSignerFinId: string
  ) {
    const deployer = await ethers.getContractFactory("EarmarkEscrow");
    const contract = await deployer.deploy(tokenAddress, earmark, proofSignerFinId);
    const address = await contract.getAddress();
    return { contract, address };
  }

  it("Should deploy EarmarkEscrow contract", async function() {
    const tokenAddress = "0x000000000000000000000000000000000000000001";
    const earmark: Earmark = {
      operationType: OPERATION_TYPE_ISSUE,
      assetId: "asset-123",
      assetType: ASSET_TYPE_FINP2P,
      amount: "1000",
      source: "source-finid",
      destination: "destination-finid"
    };
    const proofSignerFinId = "signer-finid";

    const { contract, address } = await deployEarmarkEscrow(tokenAddress, earmark, proofSignerFinId);
    console.log(`Deployed EarmarkEscrow at address: ${address}`);

    const storedEarmark = await contract.getEarmark();
    expect(storedEarmark.operationType).to.equal(earmark.operationType);
    expect(storedEarmark.assetId).to.equal(earmark.assetId);
    expect(storedEarmark.assetType).to.equal(earmark.assetType);
    expect(storedEarmark.amount).to.equal(earmark.amount);
    expect(storedEarmark.source).to.equal(earmark.source);
    expect(storedEarmark.destination).to.equal(earmark.destination);
  });



})
