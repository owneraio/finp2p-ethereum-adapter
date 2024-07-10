import { ASSET, createCrypto, generateNonce, randomResourceId, transferSignature } from "./utils/utils";
import { APIClient } from "./api/api";
import { v4 as uuidv4 } from "uuid";
import {
  EIP721_ISSUANCE_TYPES, EIP721_TRANSFER_TYPES,
  EIP721IssuanceMessage,
  EIP721Message, EIP721TransferMessage,
  signMessage
} from "../finp2p-contracts/src/contracts/eip721";
import { Wallet } from "ethers";
import { getFinId } from "../finp2p-contracts/src/contracts/utils";
import { eip712MessageToAPI, eip712TypesToAPI } from "./api/mapper";
import { OpenApisV3 } from "dtsgenerator/dist/core/openApiV3";
import Components = OpenApisV3.SchemaJson.Definitions.Components;


describe(`token service test`, () => {

  let client: APIClient;
  let orgId: string;
  let hashFunction: string;

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
      finId: issueBuyerFinId,
      account: {
        type: 'finId',
        finId: issueBuyerFinId
      } as Components.Schemas.FinIdAccount
    } as Components.Schemas.Source;

    const assetStatus = await client.tokens.createAsset({ asset: asset });
    if (!assetStatus.isCompleted) {
      await client.common.waitForCompletion(assetStatus.cid);
    }

    await client.expectBalance(issuerSource, asset, 0);

    const settlementAsset = 'USD';
    const issueAmount = 1000;
    const issueSettlementAmount = 10000;
    let settlementRef = `${uuidv4()}`;
    const issueNonce = generateNonce();

    const chainId = 1337;
    const verifyingContract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

    const eip712IssuanceMessage = {
      nonce: `0x${issueNonce.toString('hex')}`,
      buyer: { key: issueBuyerFinId },
      issuer: { key: issuerFinId },
      asset: {
        assetId,
        assetType: 'finp2p',
        amount: `${issueAmount}`
      },
      settlement: {
        assetId: settlementAsset,
        assetType: 'fiat',
        amount: `${issueSettlementAmount}`
      }
    } as EIP721IssuanceMessage;
    const issueSignature = {
      signature:  await signMessage(chainId, verifyingContract, EIP721_ISSUANCE_TYPES, eip712IssuanceMessage, issuer),
      template: {
        type: 'EIP712',
        domain: {
          name: 'FinP2P',
          version: '1',
          chainId: chainId,
          verifyingContract: verifyingContract
        } as Components.Schemas.EIP712Domain,
        primaryType: 'PrimarySale',
        types: eip712TypesToAPI(EIP721_ISSUANCE_TYPES),
        message: eip712MessageToAPI(eip712IssuanceMessage),
        hash: '',
      } as Components.Schemas.EIP712Template
    };
    const issueReceipt = await client.expectReceipt(await client.tokens.issue({
      nonce: issueNonce.toString("hex"),
      destination: issuerSource.account,
      quantity: `${issueAmount}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      settlementRef: settlementRef,
      signature: issueSignature
    } as Paths.IssueAssets.RequestBody));
    expect(issueReceipt.asset).toStrictEqual(asset);
    expect(parseInt(issueReceipt.quantity)).toBe(issueAmount);
    expect(issueReceipt.destination).toStrictEqual(issueBuyer);
    expect(issueReceipt.operationType).toBe("issue");

    await client.expectBalance(issuerSource, asset, issueAmount);

    // --------------------------------------------------------------------------

    const seller = issueBuyer;
    const sellerFinId = issueBuyerFinId;
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

    const transferQuantity = 600;
    const transferSettlementQuantity = 6000;

    const transferNonce = generateNonce();
    const eip712TransferMessage = {
      nonce: `0x${transferNonce.toString('hex')}`,
      buyer: { key: buyerFinId },
      seller: { key: sellerFinId },
      asset: {
        assetId,
        assetType: 'finp2p',
        amount: `${transferQuantity}`
      },
      settlement: {
        assetId: settlementAsset,
        assetType: 'fiat',
        amount: `${transferSettlementQuantity}`
      }
    } as EIP721TransferMessage;
    const transferSignature = {
      signature:  await signMessage(chainId, verifyingContract, EIP721_TRANSFER_TYPES, eip712TransferMessage, issuer),
      template: {
        type: 'EIP712',
        domain: {
          name: 'FinP2P',
          version: '1',
          chainId: chainId,
          verifyingContract: verifyingContract
        } as Components.Schemas.EIP712Domain,
        primaryType: 'SecondarySale',
        types: eip712TypesToAPI(EIP721_TRANSFER_TYPES),
        message: eip712MessageToAPI(eip712TransferMessage),
        hash: '',
      } as Components.Schemas.EIP712Template
    };

    settlementRef = `${uuidv4()}`;
    const transferReceipt = await client.expectReceipt(await client.tokens.transfer({
      nonce: transferNonce.toString("hex"),
      source: sellerSource,
      destination: buyerSource,
      quantity: `${transferQuantity}`,
      settlementRef: settlementRef,
      asset,
      signature: transferSignature
    } as Paths.TransferAsset.RequestBody));
    expect(transferReceipt.asset).toStrictEqual(asset);
    expect(parseInt(transferReceipt.quantity)).toBe(transferQuantity);
    expect(transferReceipt.source).toStrictEqual(issueBuyer);
    expect(transferReceipt.destination).toStrictEqual(seller);
    expect(transferReceipt.operationType).toBe("transfer");

    await client.expectBalance(sellerSource, asset, issueAmount - transferQuantity);
    await client.expectBalance(buyerSource, asset, transferQuantity);

    // const redeemNonce = generateNonce();
    // let redeemQuantity = 300;
    // const redeemSignature = transferSignature(
    //   {
    //     nonce: nonce,
    //     operation: "redeem",
    //     quantity: redeemQuantity,
    //     asset: asset,
    //     source: issueBuyer
    //   },
    //   {
    //     asset: { type: "fiat", code: "USD" },
    //     quantity: 10000,
    //     destination: issueBuyer,
    //     expiry: 6000
    //   },
    //   hashFunction,
    //   issueBuyerCrypto.private
    // );
    //
    // settlementRef = `${uuidv4()}`;
    // const redeemReceipt = await client.expectReceipt(await client.tokens.redeem({
    //   nonce: nonce.toString("hex"),
    //   source: issueBuyer.account as Components.Schemas.FinIdAccount,
    //   quantity: `${redeemQuantity}`,
    //   settlementRef: settlementRef,
    //   asset: asset as Components.Schemas.Finp2pAsset,
    //   signature: redeemSignature
    // }));
    // expect(redeemReceipt.asset).toStrictEqual(asset);
    // expect(parseFloat(redeemReceipt.quantity)).toBeCloseTo(redeemQuantity, 4);
    // expect(redeemReceipt.source).toStrictEqual(issueBuyer);
    // expect(redeemReceipt.destination).toBeUndefined();
    // expect(redeemReceipt.operationType).toBe("redeem");
    //
    // await client.expectBalance(issueBuyer, asset, issueAmount - transferQuantity - redeemQuantity);
  });

  test.skip(`Scenario: escrow hold / release`, async () => {

    const asset = { type: "fiat", code: "USD" } as Components.Schemas.Asset;

    const assetStatus = await client.tokens.createAsset({ asset: asset });
    if (!assetStatus.isCompleted) {
      await client.common.waitForCompletion(assetStatus.cid);
    }

    const buyerCrypto = createCrypto();
    const buyerFinId = buyerCrypto.public.toString("hex");
    const buyer = {
      finId: buyerFinId,
      account: {
        type: "finId",
        finId: buyerFinId
      }
    } as Components.Schemas.Source;

    let depositStatus = await client.payments.getDepositInstruction({
      owner: buyer,
      destination: buyer,
      asset: asset
    } as Paths.DepositInstruction.RequestBody);
    if (!depositStatus.isCompleted) {
      await client.common.waitForCompletion(depositStatus.cid);
    }

    let initialBalance: number;
    initialBalance = 1000;
    let settlementRef = `${uuidv4()}`;
    const setBalanceStatus = await client.tokens.issue({
      nonce: generateNonce().toString("utf-8"),
      destination: buyer.account as Components.Schemas.FinIdAccount,
      quantity: `${initialBalance}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      settlementRef: settlementRef
    } as Paths.IssueAssets.RequestBody);
    if (!setBalanceStatus.isCompleted) {
      await client.common.waitForReceipt(setBalanceStatus.cid);
    }
    await client.expectBalance(buyer, asset, initialBalance);

    const sellerCrypto = createCrypto();
    const sellerFinId = sellerCrypto.public.toString("hex");
    const seller = {
      finId: sellerFinId,
      account: {
        type: "finId",
        finId: sellerFinId
      }
    } as Components.Schemas.Source;

    depositStatus = await client.payments.getDepositInstruction({
      owner: seller,
      destination: seller,
      asset: asset
    } as Paths.DepositInstruction.RequestBody);
    if (!depositStatus.isCompleted) {
      await client.common.waitForCompletion(depositStatus.cid);
    }

    await client.expectBalance(seller, asset, 0);

    const operationId = `${uuidv4()}`;
    const transferQty = 1000;
    const expiry = Math.floor(new Date().getTime() / 1000) + 600;
    const signature = transferSignature(
      {
        nonce: generateNonce(),
        operation: "transfer",
        quantity: 10,
        asset: { type: "finp2p", resourceId: randomResourceId(orgId, ASSET) },
        source: seller,
        destination: buyer
      },
      {
        asset: asset,
        quantity: transferQty,
        source: buyer,
        destination: seller,
        expiry: expiry
      },
      hashFunction, buyerCrypto.private
    );

    const status = await client.escrow.hold({
      operationId: operationId,
      source: buyer,
      destination: seller,
      quantity: `${transferQty}`,
      asset: asset,
      expiry: expiry,
      signature: signature
    } as Paths.HoldOperation.RequestBody);
    await client.expectReceipt(status);

    await client.expectBalance(buyer, asset, initialBalance - transferQty);

    const releaseReceipt = await client.expectReceipt(await client.escrow.release({
      operationId: operationId,
      source: buyer,
      destination: seller,
      quantity: `${transferQty}`,
      asset: asset
    }));
    expect(releaseReceipt.asset).toStrictEqual(asset);
    expect(parseFloat(releaseReceipt.quantity)).toBeCloseTo(transferQty, 4);
    expect(releaseReceipt.source).toStrictEqual(buyer);
    expect(releaseReceipt.destination).toStrictEqual(seller);
    expect(releaseReceipt.operationType).toBe("release");

    await client.expectBalance(seller, asset, transferQty);
  });

  test(`Failed transaction and nonce resetting`, async () => {

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
