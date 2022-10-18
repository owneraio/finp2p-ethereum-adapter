import {ACCOUNT, ASSET, createCrypto, generateNonce, randomResourceId, transferSignature} from "./utils";
import {v4 as uuidv4} from 'uuid';
import {
  LEDGER_HASH_FUNCTION,
  ORG1_MSPID
} from "./configuration";
import {CommonAPI, EscrowAPI, OperatorAPI, PaymentsAPI} from "./api";


describe(`escrow test flow`, () => {

  test(`Scenario: escrow hold / release`, async () => {
    const asset = {type: "fiat", code: "USD"} as Components.Schemas.Asset;

    const buyerCrypto = createCrypto();
    let buyerFinId = buyerCrypto.public.toString('hex');
    let buyer = {
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
    let setBalanceStatus = await OperatorAPI.setBalance({
      to: {
        finId: buyer.finId,
      }, asset: {
        type: asset.type,
        code: {
          code: (asset as Components.Schemas.FiatAsset).code
        }
      }, balance: `${initialBalance}`
    });
    if (!setBalanceStatus.isCompleted) {
      await CommonAPI.waitForReceipt(setBalanceStatus.cid)
    }
    await expectBalance(buyer, asset, initialBalance);

    const sellerCrypto = createCrypto();
    const sellerFinId = sellerCrypto.public.toString('hex');
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
        asset: {type: "finp2p", resourceId: randomResourceId(ORG1_MSPID, ASSET)},
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

    let status = await EscrowAPI.hold({
      operationId: operationId,
      source: buyer,
      quantity: `${transferQty}`,
      asset: asset,
      expiry: expiry,
      signature: signature,
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
  }

  const expectBalance = async (owner: Components.Schemas.Source, asset: Components.Schemas.Asset, amount: number) => {
    const balance = await CommonAPI.balance({asset: asset, owner: owner});
    expect(parseFloat(balance.balance)).toBeCloseTo(amount, 4);
  }
});

