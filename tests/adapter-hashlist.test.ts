import { ASSET, createCrypto, generateNonce, randomResourceId, transferSignature } from "./utils/utils";
import { APIClient } from "./api/api";
import { v4 as uuidv4 } from "uuid";


describe(`token service test (signature hash type: hash-list)`, () => {

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

    const asset = {
      type: "finp2p",
      resourceId: randomResourceId(orgId, ASSET)
    } as Components.Schemas.Asset;

    const issuerCrypto = createCrypto();
    const issuer = {
      finId: issuerCrypto.public.toString("hex"),
      account: {
        type: "finId",
        finId: issuerCrypto.public.toString("hex")
      }
    } as Components.Schemas.Source;

    const buyerCrypto = createCrypto();
    const buyer = {
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

    const issueQuantity = 1000;
    let settlementRef = `${uuidv4()}`;
    const issueStatus = await client.tokens.issue({
      nonce: generateNonce().toString("utf-8"),
      destination: buyer.account as Components.Schemas.FinIdAccount,
      quantity: `${issueQuantity}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      settlementRef: settlementRef,
    } as Paths.IssueAssets.RequestBody);
    expect(issueStatus.error).toBeUndefined();
    const issueReceipt = await client.expectReceipt(issueStatus);
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

    let transferQuantity = 600;

    let nonce = generateNonce();
    const signature = transferSignature(
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
      },
      hashFunction,
      buyerCrypto.private
    );

    settlementRef = `${uuidv4()}`;
    const transferStatus = await client.tokens.transfer({
      nonce: nonce.toString("hex"),
      source: buyer,
      destination: seller,
      quantity: `${transferQuantity}`,
      settlementRef: settlementRef,
      asset,
      signature: signature
    } as Paths.TransferAsset.RequestBody);
    expect(transferStatus.error).toBeUndefined();
    const transferReceipt = await client.expectReceipt(transferStatus);
    expect(transferReceipt.asset).toStrictEqual(asset);
    expect(parseInt(transferReceipt.quantity)).toBe(transferQuantity);
    expect(transferReceipt.source).toStrictEqual(buyer);
    expect(transferReceipt.destination).toStrictEqual(seller);
    expect(transferReceipt.operationType).toBe("transfer");

    await client.expectBalance(buyer, asset, issueQuantity - transferQuantity);
    await client.expectBalance(seller, asset, transferQuantity);

    nonce = generateNonce();
    let redeemQuantity = 300;
    const redeemSignature = transferSignature(
      {
        nonce: nonce,
        operation: "redeem",
        quantity: redeemQuantity,
        asset: asset,
        source: buyer
      },
      {
        asset: { type: "fiat", code: "USD" },
        quantity: 10000,
        source: issuer,
        destination: buyer,
      },
      hashFunction,
      buyerCrypto.private
    );

    settlementRef = `${uuidv4()}`;
    const redeemStatus = await client.tokens.redeem({
      nonce: nonce.toString("hex"),
      source: buyer.account as Components.Schemas.FinIdAccount,
      quantity: `${redeemQuantity}`,
      settlementRef: settlementRef,
      asset: asset as Components.Schemas.Finp2pAsset,
      signature: redeemSignature
    });
    expect(redeemStatus.error).toBeUndefined();
    const redeemReceipt = await client.expectReceipt(redeemStatus);
    expect(redeemReceipt.asset).toStrictEqual(asset);
    expect(parseFloat(redeemReceipt.quantity)).toBeCloseTo(redeemQuantity, 4);
    expect(redeemReceipt.source).toStrictEqual(buyer);
    expect(redeemReceipt.destination).toBeUndefined();
    expect(redeemReceipt.operationType).toBe("redeem");

    await client.expectBalance(buyer, asset, issueQuantity - transferQuantity - redeemQuantity);
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
      },
      hashFunction, buyerCrypto.private
    );

    const holdStatus = await client.escrow.hold({
      operationId: operationId,
      source: buyer,
      destination: seller,
      quantity: `${transferQty}`,
      asset: asset,
      signature: signature
    } as Paths.HoldOperation.RequestBody);
    expect(holdStatus.error).toBeUndefined();

    await client.expectReceipt(holdStatus);

    await client.expectBalance(buyer, asset, initialBalance - transferQty);

    const releaseStatus = await client.escrow.release({
      operationId: operationId,
      source: buyer,
      destination: seller,
      quantity: `${transferQty}`,
      asset: asset
    });
    const releaseReceipt = await client.expectReceipt(releaseStatus);
    expect(releaseReceipt.asset).toStrictEqual(asset);
    expect(parseFloat(releaseReceipt.quantity)).toBeCloseTo(transferQty, 4);
    expect(releaseReceipt.source).toStrictEqual(buyer);
    expect(releaseReceipt.destination).toStrictEqual(seller);
    expect(releaseReceipt.operationType).toBe("release");

    await client.expectBalance(seller, asset, transferQty);
  });

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

    const issueQuantity = 1000;
    let settlementRef = `${uuidv4()}`;
    const issueStatus = await client.tokens.issue({
      nonce: generateNonce().toString("utf-8"),
      destination: buyer.account as Components.Schemas.FinIdAccount,
      quantity: `${issueQuantity}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      settlementRef: settlementRef,
    } as Paths.IssueAssets.RequestBody);
    expect(issueStatus.error).toBeUndefined();
    const issueReceipt = await client.expectReceipt(issueStatus);
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
        destination: buyer
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
      },
      hashFunction,
      buyerCrypto.private
    );

    settlementRef = `${uuidv4()}`;
    const transferStatus = await client.tokens.transfer({
      nonce: nonce.toString("hex"),
      source: buyer,
      destination: seller,
      quantity: `${transferQuantity}`,
      settlementRef: settlementRef,
      asset,
      signature: signature
    } as Paths.TransferAsset.RequestBody);
    expect(transferStatus.error).toBeUndefined();
    const transferReceipt = await client.expectReceipt(transferStatus);
    expect(transferReceipt.asset).toStrictEqual(asset);
    expect(parseInt(transferReceipt.quantity)).toBe(transferQuantity);
    expect(transferReceipt.source).toStrictEqual(buyer);
    expect(transferReceipt.destination).toStrictEqual(seller);
    expect(transferReceipt.operationType).toBe("transfer");
  });
});