import { ASSET, createCrypto, generateNonce, randomResourceId, transferSignature } from "./utils/utils";
import { TokensAPI, CommonAPI, PaymentsAPI, OperatorAPI, EscrowAPI } from "./api/api";
import { LEDGER_HASH_FUNCTION, ORG1_MSPID } from "./api/configuration";
import { v4 as uuidv4 } from "uuid";


describe(`token service test`, () => {

  test(`
        Scenario: issue / transfer / redeem
     `, async () => {

    const asset = {
      type: "finp2p",
      resourceId: randomResourceId(ORG1_MSPID, ASSET)
    } as Components.Schemas.Asset;

    const buyerCrypto = createCrypto();
    let buyer = {
      finId: buyerCrypto.public.toString("hex"),
      account: {
        type: "finId",
        finId: buyerCrypto.public.toString("hex")
      }
    } as Components.Schemas.Source;

    const assetStatus = await TokensAPI.createAsset({ asset: asset });
    if (!assetStatus.isCompleted) {
      await CommonAPI.waitForCompletion(assetStatus.cid);
    }

    await expectBalance(buyer, asset, 0);

    let issueQuantity = 1000;
    let settlementRef = `${uuidv4()}`;
    const issueReceipt = await expectReceipt(await TokensAPI.issue({
      nonce: generateNonce().toString("utf-8"),
      destination: buyer.account as Components.Schemas.FinIdAccount,
      quantity: `${issueQuantity}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      settlementRef: settlementRef
    } as Paths.IssueAssets.RequestBody));
    expect(issueReceipt.asset).toStrictEqual(asset);
    expect(parseInt(issueReceipt.quantity)).toBe(issueQuantity);
    expect(issueReceipt.destination).toStrictEqual(buyer);

    await expectBalance(buyer, asset, issueQuantity);

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
        expiry: 6000
      },
      LEDGER_HASH_FUNCTION,
      buyerCrypto.private
    );

    settlementRef = `${uuidv4()}`;
    const transferReceipt = await expectReceipt(await TokensAPI.transfer({
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

    await expectBalance(buyer, asset, issueQuantity - transferQuantity);
    await expectBalance(seller, asset, transferQuantity);

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
        destination: buyer,
        expiry: 6000
      },
      LEDGER_HASH_FUNCTION,
      buyerCrypto.private
    );

    settlementRef = `${uuidv4()}`;
    const redeemReceipt = await expectReceipt(await TokensAPI.redeem({
      nonce: nonce.toString("hex"),
      source: buyer.account as Components.Schemas.FinIdAccount,
      quantity: `${redeemQuantity}`,
      settlementRef: settlementRef,
      asset: asset as Components.Schemas.Finp2pAsset,
      signature: redeemSignature
    }));
    expect(redeemReceipt.asset).toStrictEqual(asset);
    expect(parseFloat(redeemReceipt.quantity)).toBeCloseTo(redeemQuantity, 4);
    expect(redeemReceipt.source).toStrictEqual(buyer);
    expect(redeemReceipt.destination).toBeUndefined();

    await expectBalance(buyer, asset, issueQuantity - transferQuantity - redeemQuantity);
  });

  test(`Scenario: escrow hold / release`, async () => {
    const asset = { type: "fiat", code: "USD" } as Components.Schemas.Asset;

    const buyerCrypto = createCrypto();
    const buyerFinId = buyerCrypto.public.toString("hex");
    const buyer = {
      finId: buyerFinId,
      account: {
        type: "finId",
        finId: buyerFinId
      }
    } as Components.Schemas.Source;

    let depositStatus = await PaymentsAPI.getDepositInstruction({
      owner: buyer,
      destination: buyer,
      asset: asset
    } as Paths.DepositInstruction.RequestBody);
    if (!depositStatus.isCompleted) {
      await CommonAPI.waitForCompletion(depositStatus.cid);
    }

    let initialBalance: number;
    initialBalance = 1000;
    const setBalanceStatus = await OperatorAPI.setBalance({
      to: {
        finId: buyer.finId
      }, asset: {
        type: asset.type,
        code: {
          code: (asset as Components.Schemas.FiatAsset).code
        }
      }, balance: `${initialBalance}`
    });
    if (!setBalanceStatus.isCompleted) {
      await CommonAPI.waitForReceipt(setBalanceStatus.cid);
    }
    await expectBalance(buyer, asset, initialBalance);

    const sellerCrypto = createCrypto();
    const sellerFinId = sellerCrypto.public.toString("hex");
    const seller = {
      finId: sellerFinId,
      account: {
        type: "finId",
        finId: sellerFinId
      }
    } as Components.Schemas.Source;

    depositStatus = await PaymentsAPI.getDepositInstruction({
      owner: seller,
      destination: seller,
      asset: asset
    } as Paths.DepositInstruction.RequestBody);
    if (!depositStatus.isCompleted) {
      await CommonAPI.waitForCompletion(depositStatus.cid);
    }

    await expectBalance(seller, asset, 0);

    const operationId = `${uuidv4()}`;
    const transferQty = 1000;
    const expiry = Math.floor(new Date().getTime() / 1000) + 600;
    const signature = transferSignature(
      {
        nonce: generateNonce(),
        operation: "transfer",
        quantity: 10,
        asset: { type: "finp2p", resourceId: randomResourceId(ORG1_MSPID, ASSET) },
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
      LEDGER_HASH_FUNCTION, buyerCrypto.private
    );

    const status = await EscrowAPI.hold({
      operationId: operationId,
      source: buyer,
      destination: seller,
      quantity: `${transferQty}`,
      asset: asset,
      expiry: expiry,
      signature: signature
    } as Paths.HoldOperation.RequestBody);
    await expectReceipt(status);

    await expectBalance(buyer, asset, initialBalance - transferQty);

    const releaseReceipt = await expectReceipt(await EscrowAPI.release({
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

    await expectBalance(seller, asset, transferQty);
  });


  const expectReceipt = async (status: any): Promise<Components.Schemas.Receipt> => {
    if (status.isCompleted) {
      return status.response;
    } else {
      return await CommonAPI.waitForReceipt(status.cid);
    }
  };

  const expectBalance = async (owner: Components.Schemas.Source, asset: Components.Schemas.Asset, amount: number) => {
    const balance = await CommonAPI.balance({ asset: asset, owner: owner });
    expect(parseInt(balance.balance)).toBe(amount);
  };
});

