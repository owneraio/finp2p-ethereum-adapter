import {
  Asset,
  DepositAsset,
  DepositOperation,
  Destination,
  PaymentService,
  ReceiptOperation,
  Signature,
  Source,
  failedDepositOperation,
  failedReceiptOperation,
  successfulDepositOperation,
} from "@owneraio/finp2p-adapter-models";
import { parseUnits } from "ethers";
import { randomUUID } from "node:crypto";
import winston from "winston";
import { CustodyProvider } from "../direct/custody-provider";
import { getAssetFromDb } from "../direct/helpers";
import { CreateDepositIntentInput, OmnibusInboundStore } from "./store";

export interface OmnibusPaymentServiceConfig {
  intentTtlMs: number;
}

const defaultConfig: OmnibusPaymentServiceConfig = {
  intentTtlMs: 24 * 60 * 60 * 1000,
};

const normalizeAddress = (value: string | undefined): string | undefined =>
  value ? value.trim().toLowerCase() : undefined;

function extractSenderAddress(details: any): string | undefined {
  if (typeof details?.senderAddress === "string") {
    return normalizeAddress(details.senderAddress);
  }
  if (typeof details?.sender?.address === "string") {
    return normalizeAddress(details.sender.address);
  }
  return undefined;
}

export class OmnibusPaymentService implements PaymentService {
  private readonly config: OmnibusPaymentServiceConfig;

  constructor(
    private readonly logger: winston.Logger,
    private readonly custodyProvider: CustodyProvider,
    private readonly store: OmnibusInboundStore,
    config?: Partial<OmnibusPaymentServiceConfig>,
  ) {
    this.config = { ...defaultConfig, ...config };
  }

  async getDepositInstruction(
    _idempotencyKey: string,
    _owner: Source,
    destination: Destination,
    asset: DepositAsset,
    amount: string | undefined,
    details: any | undefined,
    _nonce: string | undefined,
    _signature: Signature | undefined,
  ): Promise<DepositOperation> {
    if (asset.assetType === "custom") {
      return failedDepositOperation(1, "Custom deposits are not supported in omnibus mode");
    }
    if (!amount) {
      return failedDepositOperation(1, "Amount is required for omnibus deposits");
    }
    if (!destination.finId || destination.account.type !== "finId") {
      return failedDepositOperation(1, "Omnibus deposits require a finId destination");
    }
    if (!this.custodyProvider.omnibus) {
      return failedDepositOperation(1, "Omnibus wallet is not configured");
    }

    const dbAsset = await getAssetFromDb(asset as Asset);
    const senderAddress = extractSenderAddress(details);
    let expectedAmountUnits: bigint;
    try {
      expectedAmountUnits = parseUnits(amount, dbAsset.decimals);
    } catch (e) {
      return failedDepositOperation(1, `Invalid amount ${amount}: ${e}`);
    }

    const referenceId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.intentTtlMs);
    const omnibusAddress = (await this.custodyProvider.omnibus.signer.getAddress()).toLowerCase();
    const network = await this.custodyProvider.rpcProvider.getNetwork();
    const chainId = Number(network.chainId);

    const input: CreateDepositIntentInput = {
      referenceId,
      destinationFinId: destination.finId,
      destinationAccount: destination.account,
      assetId: asset.assetId,
      assetType: asset.assetType,
      tokenContractAddress: dbAsset.contract_address,
      tokenDecimals: dbAsset.decimals,
      expectedAmount: amount,
      expectedAmountUnits: expectedAmountUnits.toString(),
      senderAddress,
      details,
      expiresAt,
    };
    await this.store.createDepositIntent(input);

    this.logger.info(
      `Created omnibus deposit intent ${referenceId} for ${destination.finId} ${amount} ${asset.assetId}`,
    );

    return successfulDepositOperation({
      account: destination,
      description: `Transfer ${amount} ${asset.assetId} to the omnibus wallet`,
      paymentOptions: [{
        description: "ERC-20 transfer to omnibus wallet",
        currency: asset.assetId,
        methodInstruction: {
          type: "cryptoTransfer",
          network: `eip155:${chainId}`,
          contractAddress: dbAsset.contract_address,
          walletAddress: omnibusAddress,
        },
      }],
      operationId: referenceId,
      details: {
        referenceId,
        senderAddress,
        expiresAt: expiresAt.toISOString(),
        tokenContractAddress: dbAsset.contract_address,
      },
    });
  }

  async payout(
    _idempotencyKey: string,
    _source: Source,
    _destination: Destination | undefined,
    _asset: Asset,
    _quantity: string,
    _description: string | undefined,
    _nonce: string | undefined,
    _signature: Signature | undefined,
  ): Promise<ReceiptOperation> {
    return failedReceiptOperation(1, "Payout is not supported in omnibus mode");
  }
}
