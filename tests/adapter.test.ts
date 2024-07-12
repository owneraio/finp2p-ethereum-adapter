import { ASSET, createCrypto, generateNonce, randomResourceId, transferSignature } from "./utils/utils";
import { APIClient } from "./api/api";
import { v4 as uuidv4 } from "uuid";
import {
  EIP721_ISSUANCE_TYPES, EIP721_REDEEM_TYPES, EIP721_TRANSFER_TYPES,
  EIP721IssuanceMessage, EIP721RedeemMessage,
  EIP721TransferMessage,
} from "../finp2p-contracts/src/contracts/eip721";
import { Wallet } from "ethers";
import { getFinId } from "../finp2p-contracts/src/contracts/utils";
import {  buildEIP721Signature } from "./api/mapper";
import { set } from "dtsgenerator/dist/jsonPointer";


describe(`token service test`, () => {

  let client: APIClient;
  let orgId: string;
  let hashFunction: string;
  const chainId = 1337;
  const verifyingContract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

  beforeAll(async () => {
    // @ts-ignore
    client = new APIClient(global.serverAddress);
    // @ts-ignore
    orgId = global.orgId;
    // @ts-ignore
    hashFunction = global.hashFunction;
  });

  test(` Scenario: issue / transfer / redeem`, async () => {

    const assetId = randomResourceId(orgId, ASSET);
    const asset = {
      type: 'finp2p',
      resourceId: assetId
    } as Components.Schemas.Finp2pAsset;

    const issuer = Wallet.createRandom();
    const issuerFinId = getFinId(issuer);

    const issueBuyer = Wallet.createRandom();
    const issueBuyerFinId = getFinId(issueBuyer);
    const issuerSource = {
      finId: issuerFinId,
      account: {
        type: 'finId',
        finId: issuerFinId
      } as Components.Schemas.FinIdAccount
    } as Components.Schemas.Source;

    const assetStatus = await client.tokens.createAsset({ asset: asset });
    if (!assetStatus.isCompleted) {
      await client.common.waitForCompletion(assetStatus.cid);
    }

    await client.expectBalance(issuerSource, asset, 0);

    // --------------------------------------------------------------------------

    const settlementAsset = 'USD';
    const issueAmount = 1000;
    const issueSettlementAmount = 10000;

    const chainId = 1337;
    const verifyingContract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

    // --------------------------------------------------------------------------

    const issueNonce = generateNonce();
    const issueReceipt = await client.expectReceipt(await client.tokens.issue({
      nonce: issueNonce.toString("hex"),
      destination: issuerSource.account,
      quantity: `${issueAmount}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      signature: await buildEIP721Signature(chainId, verifyingContract,
        'PrimarySale', EIP721_ISSUANCE_TYPES, {
          nonce: `0x${issueNonce.toString('hex')}`,
          buyer: { key: issueBuyerFinId },
          issuer: { key: issuerFinId },
          asset: {
            assetId,
            assetType: 'finp2p',
            amount: issueAmount
          },
          settlement: {
            assetId: settlementAsset,
            assetType: 'fiat',
            amount: issueSettlementAmount
          }
        } as EIP721IssuanceMessage, issueBuyer)
    } as Paths.IssueAssets.RequestBody));
    expect(issueReceipt.asset).toStrictEqual(asset);
    expect(parseInt(issueReceipt.quantity)).toBe(issueAmount);
    expect(issueReceipt.destination?.finId).toBe(issuerFinId);
    expect(issueReceipt.operationType).toBe("issue");

    await client.expectBalance(issuerSource, asset, issueAmount);

    // --------------------------------------------------------------------------

    const seller = issuer;
    const sellerFinId = issuerFinId;
    const sellerSource = issuerSource;
    const buyer = Wallet.createRandom();
    const buyerFinId = getFinId(buyer);
    const buyerSource = {
      finId: buyerFinId,
      account: {
        type: 'finId',
        finId: buyerFinId
      } as Components.Schemas.FinIdAccount
    } as Components.Schemas.Source;

    const transferAmount = 600;
    const transferSettlementAmount = 6000;

    const transferNonce = generateNonce();
    const transferReceipt = await client.expectReceipt(await client.tokens.transfer({
      nonce: transferNonce.toString("hex"),
      source: sellerSource,
      destination: buyerSource,
      quantity: `${transferAmount}`,
      asset,
      signature: await buildEIP721Signature(chainId, verifyingContract,
        'SecondarySale', EIP721_TRANSFER_TYPES, {
          nonce: `0x${transferNonce.toString('hex')}`,
          seller: { key: sellerFinId },
          buyer: { key: buyerFinId },
          asset: {
            assetId,
            assetType: 'finp2p',
            amount: transferAmount
          },
          settlement: {
            assetId: settlementAsset,
            assetType: 'fiat',
            amount: transferSettlementAmount
          }
        } as EIP721TransferMessage, seller),
    } as Paths.TransferAsset.RequestBody));
    expect(transferReceipt.asset).toStrictEqual(asset);
    expect(parseInt(transferReceipt.quantity)).toBe(transferAmount);
    expect(transferReceipt.source?.finId).toBe(sellerFinId);
    expect(transferReceipt.destination?.finId).toBe(buyerFinId);
    expect(transferReceipt.operationType).toBe("transfer");

    await client.expectBalance(sellerSource, asset, issueAmount - transferAmount);
    await client.expectBalance(buyerSource, asset, transferAmount);

    // -------------------------------------------

    const redeemOwner = buyer;
    const redeemOwnerFinId = buyerFinId;
    const redeemOwnerSource = buyerSource;
    const redeemBuyer = Wallet.createRandom();
    const redeemBuyerFinId = getFinId(redeemBuyer);

    const redeemNonce = generateNonce();
    const redeemAmount = 300;
    const redeemSettlementAmount = 3000;

    const redeemReceipt = await client.expectReceipt(await client.tokens.redeem({
      nonce: redeemNonce.toString("hex"),
      source: redeemOwnerSource.account as Components.Schemas.FinIdAccount,
      quantity: `${redeemAmount}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      signature: await buildEIP721Signature(chainId, verifyingContract,
        'Redemption', EIP721_REDEEM_TYPES, {
          nonce: `0x${redeemNonce.toString('hex')}`,
          owner: { key: redeemOwnerFinId },
          buyer: { key: redeemBuyerFinId },
          asset: {
            assetId,
            assetType: 'finp2p',
            amount: redeemAmount
          },
          settlement: {
            assetId: settlementAsset,
            assetType: 'fiat',
            amount: redeemSettlementAmount
          }
        } as EIP721RedeemMessage, redeemOwner)
    } as Paths.RedeemAssets.RequestBody));
    expect(redeemReceipt.asset).toStrictEqual(asset);
    expect(parseFloat(redeemReceipt.quantity)).toBeCloseTo(redeemAmount, 4);
    expect(redeemReceipt.source?.finId).toBe(redeemOwnerFinId);
    expect(redeemReceipt.destination).toBeUndefined();
    expect(redeemReceipt.operationType).toBe("redeem");

    await client.expectBalance(redeemOwnerSource, asset, transferAmount - redeemAmount);
  });

  // test(`Scenario: escrow hold / release`, async () => {
  //
  //   const assetId = randomResourceId(orgId, ASSET);
  //   const settlementAsset = 'USD'
  //   const asset = { type: "fiat", code: settlementAsset } as Components.Schemas.Asset;
  //
  //   const assetStatus = await client.tokens.createAsset({ asset: asset });
  //   if (!assetStatus.isCompleted) {
  //     await client.common.waitForCompletion(assetStatus.cid);
  //   }
  //
  //   const buyerCrypto = createCrypto();
  //   const buyerFinId = buyerCrypto.public.toString("hex");
  //   const buyer = {
  //     finId: buyerFinId,
  //     account: {
  //       type: "finId",
  //       finId: buyerFinId
  //     }
  //   } as Components.Schemas.Source;
  //
  //   let depositStatus = await client.payments.getDepositInstruction({
  //     owner: buyer,
  //     destination: buyer,
  //     asset: asset
  //   } as Paths.DepositInstruction.RequestBody);
  //   if (!depositStatus.isCompleted) {
  //     await client.common.waitForCompletion(depositStatus.cid);
  //   }
  //
  //   let initialBalance: number;
  //   initialBalance = 1000;
  //   let settlementRef = `${uuidv4()}`;
  //   const setBalanceStatus = await client.tokens.issue({
  //     nonce: generateNonce().toString("utf-8"),
  //     destination: buyer.account as Components.Schemas.FinIdAccount,
  //     quantity: `${initialBalance}`,
  //     asset: asset as Components.Schemas.Finp2pAsset,
  //     settlementRef: settlementRef
  //   } as Paths.IssueAssets.RequestBody);
  //   if (!setBalanceStatus.isCompleted) {
  //     await client.common.waitForReceipt(setBalanceStatus.cid);
  //   }
  //   await client.expectBalance(buyer, asset, initialBalance);
  //
  //   const sellerCrypto = createCrypto();
  //   const sellerFinId = sellerCrypto.public.toString("hex");
  //   const seller = {
  //     finId: sellerFinId,
  //     account: {
  //       type: "finId",
  //       finId: sellerFinId
  //     }
  //   } as Components.Schemas.Source;
  //
  //   depositStatus = await client.payments.getDepositInstruction({
  //     owner: seller,
  //     destination: seller,
  //     asset: asset
  //   } as Paths.DepositInstruction.RequestBody);
  //   if (!depositStatus.isCompleted) {
  //     await client.common.waitForCompletion(depositStatus.cid);
  //   }
  //
  //   await client.expectBalance(seller, asset, 0);
  //
  //   const operationId = `${uuidv4()}`;
  //   const transferAmount = 100;
  //   const transferSettlementAmount = 1000;
  //
  //   const transferNonce = generateNonce();
  //   const holdReceipt = await client.expectReceipt(await client.escrow.hold({
  //     operationId: operationId,
  //     nonce: transferNonce.toString("hex"),
  //     source: buyer,
  //     destination: seller,
  //     quantity: `${transferSettlementAmount}`,
  //     asset: settlementAsset,
  //     signature: await buildEIP721Signature(chainId, verifyingContract,
  //       'SecondarySale', EIP721_TRANSFER_TYPES, {
  //         nonce: `0x${transferNonce.toString('hex')}`,
  //         seller: { key: sellerFinId },
  //         buyer: { key: buyerFinId },
  //         asset: {
  //           assetId,
  //           assetType: 'finp2p',
  //           amount: transferAmount
  //         },
  //         settlement: {
  //           assetId: settlementAsset,
  //           assetType: 'fiat',
  //           amount: transferSettlementAmount
  //         }
  //       } as EIP721TransferMessage, seller),
  //   } as Paths.HoldOperation.RequestBody));
  //   expect(holdReceipt.asset).toStrictEqual(asset);
  //
  //   await client.expectBalance(buyer, asset, initialBalance - transferSettlementAmount);
  //
  //   const releaseReceipt = await client.expectReceipt(await client.escrow.release({
  //     operationId: operationId,
  //     source: buyer,
  //     destination: seller,
  //     quantity: `${transferAmount}`,
  //     asset: asset
  //   }));
  //   expect(releaseReceipt.asset).toStrictEqual(asset);
  //   expect(parseFloat(releaseReceipt.quantity)).toBeCloseTo(transferAmount, 4);
  //   expect(releaseReceipt.source).toStrictEqual(buyer);
  //   expect(releaseReceipt.destination).toStrictEqual(seller);
  //   expect(releaseReceipt.operationType).toBe("release");
  //
  //   await client.expectBalance(seller, asset, transferAmount);
  // });

  test.skip(`Failed transaction and nonce resetting`, async () => {

    const asset = {
      type: "finp2p",
      resourceId: randomResourceId(orgId, ASSET)
    } as Components.Schemas.Asset;

    const buyerCrypto = createCrypto();
    let buyer = {
      finId: buyerCrypto.public.toString("hex"),
      account: {
        type: "finId",
        finId: buyerCrypto.public.toString("hex")
      }
    } as Components.Schemas.Source;

    const assetStatus = await client.tokens.createAsset({ asset: asset });
    if (!assetStatus.isCompleted) {
      await client.common.waitForCompletion(assetStatus.cid);
    }

    await client.expectBalance(buyer, asset, 0);

    let issueQuantity = 1000;
    let settlementRef = `${uuidv4()}`;
    const issueReceipt = await client.expectReceipt(await client.tokens.issue({
      nonce: generateNonce().toString("utf-8"),
      destination: buyer.account as Components.Schemas.FinIdAccount,
      quantity: `${issueQuantity}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      settlementRef: settlementRef,
    } as Paths.IssueAssets.RequestBody));
    expect(issueReceipt.asset).toStrictEqual(asset);
    expect(parseInt(issueReceipt.quantity)).toBe(issueQuantity);
    expect(issueReceipt.destination).toStrictEqual(buyer);
    expect(issueReceipt.operationType).toBe("issue");

    await client.expectBalance(buyer, asset, issueQuantity);

    const sellerCrypto = createCrypto();
    let seller = {
      finId: sellerCrypto.public.toString("hex"),
      account: {
        type: "finId",
        finId: sellerCrypto.public.toString("hex")
      }
    } as Components.Schemas.Source;

    let transferQuantity = 1600;

    let nonce = generateNonce();
    let signature = transferSignature(
      {
        nonce: nonce,
        operation: "transfer",
        quantity: transferQuantity,
        asset: asset,
        source: buyer,
        destination: seller
      },
      {
        asset: { type: "fiat", code: "USD" },
        quantity: 10000,
        source: seller,
        destination: buyer,
        expiry: 6000
      },
      hashFunction,
      buyerCrypto.private
    );

    settlementRef = `${uuidv4()}`;
    let failedResult = await client.tokens.transfer({
      nonce: nonce.toString("hex"),
      source: buyer,
      destination: seller,
      quantity: `${transferQuantity}`,
      settlementRef: settlementRef,
      asset,
      signature: signature
    } as Paths.TransferAsset.RequestBody);
    expect(failedResult.isCompleted).toBeTruthy();
    expect(failedResult.error).toBeDefined();
    expect(failedResult.error!.message).toBe("Not sufficient balance to transfer");

    transferQuantity = 600;

    nonce = generateNonce();
    signature = transferSignature(
      {
        nonce: nonce,
        operation: "transfer",
        quantity: transferQuantity,
        asset: asset,
        source: buyer,
        destination: seller
      },
      {
        asset: { type: "fiat", code: "USD" },
        quantity: 10000,
        source: seller,
        destination: buyer,
        expiry: 6000
      },
      hashFunction,
      buyerCrypto.private
    );

    settlementRef = `${uuidv4()}`;
    const transferReceipt = await client.expectReceipt(await client.tokens.transfer({
      nonce: nonce.toString("hex"),
      source: buyer,
      destination: seller,
      quantity: `${transferQuantity}`,
      settlementRef: settlementRef,
      asset,
      signature: signature
    } as Paths.TransferAsset.RequestBody));
    expect(transferReceipt.asset).toStrictEqual(asset);
    expect(parseInt(transferReceipt.quantity)).toBe(transferQuantity);
    expect(transferReceipt.source).toStrictEqual(buyer);
    expect(transferReceipt.destination).toStrictEqual(seller);
    expect(transferReceipt.operationType).toBe("transfer");
  });
});
