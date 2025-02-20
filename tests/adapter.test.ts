import { ASSET, createCrypto, generateNonce, randomResourceId, transferSignature } from "./utils/utils";
import { APIClient } from "./api/api";
import { v4 as uuidv4 } from "uuid";
import { eip712Signature } from "./api/mapper";
import {
  PRIMARY_SALE_TYPES,
  REDEMPTION_TYPES, SELLING_TYPES,
  EIP712PrimarySaleMessage,
  EIP712SellingMessage, newRedemptionMessage, finId, term, newSellingMessage
} from "../finp2p-contracts/src/contracts/eip712";


describe(`token service test`, () => {

  let client: APIClient;
  let orgId: string;
  let hashFunction: string;
  const chainId = 1;
  const  verifyingContract = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC';

  beforeAll(async () => {
    // @ts-ignore
    client = new APIClient(global.serverAddress);
    // @ts-ignore
    orgId = global.orgId;
    // @ts-ignore
    hashFunction = global.hashFunction;
  });

  test(`Scenario: issue / transfer / redeem`, async () => {

    const assetId = randomResourceId(orgId, ASSET);
    const asset = {
      type: 'finp2p',
      resourceId: assetId
    } as Components.Schemas.Finp2pAsset;

    const { private: issuerPrivate, public: issuerPublic } = createCrypto();
    const issuerPrivateKey = issuerPrivate.toString('hex');
    const issuerFinId = issuerPublic.toString('hex');

    const { private: issueBuyerPrivateBytes, public: issueBuyerPublic } = createCrypto();
    const issueBuyerPrivateKey = issueBuyerPrivateBytes.toString('hex');
    const issueBuyerFinId = issueBuyerPublic.toString('hex');
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

    // --------------------------------------------------------------------------

    const issueNonce = generateNonce().toString('hex');
    const issueStatus = await client.tokens.issue({
      nonce: issueNonce,
      destination: issuerSource.account,
      quantity: `${issueAmount}`,
      asset: asset as Components.Schemas.Finp2pAsset,
      signature: await eip712Signature(chainId, verifyingContract,
        'PrimarySale', PRIMARY_SALE_TYPES, {
          nonce: issueNonce,
          buyer: { idkey: issueBuyerFinId },
          issuer: { idkey: issuerFinId },
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
        } as EIP712PrimarySaleMessage, issueBuyerPrivateKey)
    } as Paths.IssueAssets.RequestBody);
    expect(issueStatus.error).toBeUndefined();
    const issueReceipt = await client.expectReceipt(issueStatus);
    expect(issueReceipt.asset).toStrictEqual(asset);
    expect(parseInt(issueReceipt.quantity)).toBe(issueAmount);
    expect(issueReceipt.destination?.finId).toBe(issuerFinId);
    expect(issueReceipt.operationType).toBe('issue');

    await client.expectBalance(issuerSource, asset, issueAmount);

    // --------------------------------------------------------------------------

    const sellerPrivateKey = issuerPrivateKey;
    const sellerFinId = issuerFinId;
    const sellerSource = issuerSource;
    const { private: buyerPrivateBytes, public: buyerPublic } = createCrypto();
    const buyerPrivateKey = buyerPrivateBytes.toString('hex');
    const buyerFinId = buyerPublic.toString('hex');
    const buyerSource = {
      finId: buyerFinId,
      account: {
        type: 'finId',
        finId: buyerFinId
      } as Components.Schemas.FinIdAccount
    } as Components.Schemas.Source;

    const transferAmount = 600;
    const transferSettlementAmount = 6000;

    const transferNonce = generateNonce().toString('hex');
    const transferReceipt = await client.expectReceipt(await client.tokens.transfer({
      nonce: transferNonce,
      source: sellerSource,
      destination: buyerSource,
      quantity: `${transferAmount}`,
      asset,
      signature: await eip712Signature(chainId, verifyingContract,
        'Selling', SELLING_TYPES, {
          nonce: transferNonce,
          seller: { idkey: sellerFinId },
          buyer: { idkey: buyerFinId },
          asset: {
            assetId,
            assetType: 'finp2p',
            amount: `${transferAmount}`
          },
          settlement: {
            assetId: settlementAsset,
            assetType: 'fiat',
            amount: `${transferSettlementAmount}`
          }
        } as EIP712SellingMessage, sellerPrivateKey),
    } as Paths.TransferAsset.RequestBody));
    expect(transferReceipt.asset).toStrictEqual(asset);
    expect(parseInt(transferReceipt.quantity)).toBe(transferAmount);
    expect(transferReceipt.source?.finId).toBe(sellerFinId);
    expect(transferReceipt.destination?.finId).toBe(buyerFinId);
    expect(transferReceipt.operationType).toBe('transfer');

    await client.expectBalance(sellerSource, asset, issueAmount - transferAmount);
    await client.expectBalance(buyerSource, asset, transferAmount);
  });

  test(`Scenario: escrow hold / release`, async () => {

    const assetId = randomResourceId(orgId, ASSET);
    const settlementAssetId = 'USD'
    const settlementAsset = { type: 'fiat',code: settlementAssetId} as Components.Schemas.Asset;
    const assetStatus = await client.tokens.createAsset({ asset: settlementAsset });
    if (!assetStatus.isCompleted) {
      await client.common.waitForCompletion(assetStatus.cid);
    }

    const { private: buyerPrivateKeyBytes, public: buyerPublic} = createCrypto();
    const buyerPrivateKey = buyerPrivateKeyBytes.toString('hex');
    const buyerFinId = buyerPublic.toString('hex');
    const buyerSource = {
      finId: buyerFinId,
      account: {
        type: 'finId',
        finId: buyerFinId
      }
    } as Components.Schemas.Source;

    let depositStatus = await client.payments.getDepositInstruction({
      owner: buyerSource,
      destination: buyerSource,
      asset: settlementAsset
    } as Paths.DepositInstruction.RequestBody);
    if (!depositStatus.isCompleted) {
      await client.common.waitForCompletion(depositStatus.cid);
    }

    let initialBalance: number;
    initialBalance = 1000;
    let settlementRef = `${uuidv4()}`;
    const setBalanceStatus = await client.tokens.issue({
      nonce: generateNonce().toString('hex'),
      destination: buyerSource.account,
      quantity: `${initialBalance}`,
      asset: settlementAsset,
      settlementRef: settlementRef
    } as Paths.IssueAssets.RequestBody);
    if (!setBalanceStatus.isCompleted) {
      await client.common.waitForReceipt(setBalanceStatus.cid);
    }
    await client.expectBalance(buyerSource, settlementAsset, initialBalance);

    const { public: sellerPublic } = createCrypto();
    const sellerFinId = sellerPublic.toString('hex');
    const sellerSource = {
      finId: sellerFinId,
      account: {
        type: 'finId',
        finId: sellerFinId
      }
    } as Components.Schemas.Source;
    await client.expectBalance(sellerSource, settlementAsset, 0);

    const operationId = `${uuidv4()}`;
    const transferAmount = 100;
    const transferSettlementAmount = 1000;

    const transferNonce = generateNonce().toString('hex');
    const holdStatus = await client.escrow.hold({
      operationId: operationId,
      nonce: transferNonce,
      source: buyerSource,
      destination: sellerSource,
      quantity: `${transferSettlementAmount}`,
      asset: settlementAsset,
      signature: await eip712Signature(chainId, verifyingContract,
        'Selling', SELLING_TYPES, newSellingMessage(transferNonce, finId(buyerFinId), finId(sellerFinId),
          term(assetId, 'finp2p', `${transferAmount}`),
          term(settlementAssetId, 'fiat', `${transferSettlementAmount}`)), buyerPrivateKey),
    } as Paths.HoldOperation.RequestBody);
    expect(holdStatus.error).toBeUndefined();
    const holdReceipt = await client.expectReceipt(holdStatus);
    expect(holdReceipt.asset).toStrictEqual(settlementAsset);
    expect(holdReceipt.source).toStrictEqual(buyerSource);
    expect(holdReceipt.destination).toBeUndefined();
    expect(parseFloat(holdReceipt.quantity)).toBeCloseTo(transferSettlementAmount, 4);
    expect(holdReceipt.operationType).toBe('hold');

    await client.expectBalance(buyerSource, settlementAsset, initialBalance - transferSettlementAmount);

    const releaseReceipt = await client.expectReceipt(await client.escrow.release({
      operationId: operationId,
      source: buyerSource,
      destination: sellerSource,
      quantity: `${transferSettlementAmount}`,
      asset: settlementAsset
    }));
    expect(releaseReceipt.asset).toStrictEqual(settlementAsset);
    expect(parseFloat(releaseReceipt.quantity)).toBeCloseTo(transferSettlementAmount, 4);
    expect(releaseReceipt.source).toStrictEqual(buyerSource);
    expect(releaseReceipt.destination).toStrictEqual(sellerSource);
    expect(releaseReceipt.operationType).toBe('release');

    await client.expectBalance(sellerSource, settlementAsset, transferSettlementAmount);
  });

  test(`Scenario: escrow hold / redeem`, async () => {

    const assetId = randomResourceId(orgId, ASSET);
    const settlementAssetId = 'USD'

    const asset = {
      type: 'finp2p',
      resourceId: assetId
    } as Components.Schemas.Finp2pAsset;

    const assetStatus = await client.tokens.createAsset({ asset: asset });
    if (!assetStatus.isCompleted) {
      await client.common.waitForCompletion(assetStatus.cid);
    }

    const { public: issuerPublic } = createCrypto();
    const issuerFinId = issuerPublic.toString('hex');
    const issuerSource = {
      finId: issuerFinId,
      account: {
        type: 'finId',
        finId: issuerFinId
      }
    } as Components.Schemas.Source;

    const { public: investorPublic, private: investorPrivateKeyBytes} = createCrypto();
    const investorPrivateKey = investorPrivateKeyBytes.toString('hex');

    const investorFinId = investorPublic.toString('hex');
    const investorSource = {
      finId: investorFinId,
      account: {
        type: 'finId',
        finId: investorFinId
      }
    } as Components.Schemas.Source;

    const issueAmount = 100;
    const setBalanceStatus = await client.tokens.issue({
      nonce: generateNonce().toString('hex'),
      destination: investorSource.account,
      quantity: `${issueAmount}`,
      asset: asset,
    } as Paths.IssueAssets.RequestBody);
    if (!setBalanceStatus.isCompleted) {
      await client.common.waitForReceipt(setBalanceStatus.cid);
    }
    await client.expectBalance(investorSource, asset, issueAmount);

    await client.expectBalance(issuerSource, asset, 0);

    const operationId = `${uuidv4()}`;
    const redeemAmount = 100;
    const redeemSettlementAmount = 1000;

    const transferNonce = generateNonce().toString('hex');
    const redemptionSignature = await eip712Signature(chainId, verifyingContract,
      'Redemption', REDEMPTION_TYPES, newRedemptionMessage(transferNonce, finId(issuerFinId), finId(investorFinId),
        term(assetId, 'finp2p', `${redeemAmount}`), term(settlementAssetId, 'fiat', `${redeemSettlementAmount}`)),

      investorPrivateKey);

    const holdStatus = await client.escrow.hold({
      operationId: operationId,
      nonce: transferNonce,
      source: investorSource,
      destination: issuerSource,
      quantity: `${redeemAmount}`,
      asset: asset,
      signature: redemptionSignature,
    } as Paths.HoldOperation.RequestBody);
    expect(holdStatus.error).toBeUndefined();
    const holdReceipt = await client.expectReceipt(holdStatus);
    expect(holdReceipt.asset).toStrictEqual(asset);
    expect(holdReceipt.source).toStrictEqual(investorSource);
    expect(holdReceipt.destination).toBeUndefined();
    expect(parseFloat(holdReceipt.quantity)).toBeCloseTo(redeemAmount, 4);
    expect(holdReceipt.operationType).toBe('hold');

    await client.expectBalance(investorSource, asset, issueAmount - redeemAmount);

    const redeemReceipt = await client.expectReceipt(await client.tokens.redeem({
      nonce: transferNonce,
      operationId: operationId,
      source: investorSource.account,
      quantity: `${redeemAmount}`,
      settlementRef: '',
      signature: redemptionSignature,
      asset: asset
    }));
    expect(redeemReceipt.asset).toStrictEqual(asset);
    expect(parseFloat(redeemReceipt.quantity)).toBeCloseTo(redeemAmount, 4);
    expect(redeemReceipt.source).toStrictEqual(investorSource);
    expect(redeemReceipt.destination).toBeUndefined();
    expect(redeemReceipt.operationType).toBe('redeem');

    await client.expectBalance(issuerSource, asset, issueAmount - redeemAmount);
  });


});
