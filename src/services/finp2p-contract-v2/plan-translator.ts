import { EIP712Template } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import {
  ExecutionState,
  ExecutionVenue,
  NO_SIGNATURE,
  PlanInstruction,
  PlanInstructionType,
  PlanInvestmentSignature,
  ValidationError
} from "@owneraio/finp2p-contracts";
import { businessDetailsFromTemplate, TemplateBusinessDetails } from "../finp2p-contract/helpers";

// Minimal structural types of the RAW FinAPI execution plan payload
// (finP2PClient.getExecutionPlan(planId).data.plan). We consume the raw shape
// deliberately: the skeleton's plan mapper drops instruction/investor
// signatures, which are exactly what on-chain plan creation needs.

export type RawFinIdAccount = { finId: string; orgId?: string; custodian?: { orgId?: string } };
export type RawLedgerAccountAsset = {
  finp2pAccount: {
    asset: { id: string };
    account: RawFinIdAccount;
  };
};
export type RawSignature = { signature: string; template: { type: string; [k: string]: any }; hashFunc?: string };
export type RawPlanOperation = {
  type: "hold" | "release" | "issue" | "transfer" | "await" | "revertHoldInstruction" | "redeem";
  source?: RawLedgerAccountAsset;
  destination?: RawLedgerAccountAsset;
  amount?: string;
  signature?: RawSignature;
  waitUntil?: number;
};
export type RawPlanInstruction = {
  sequence: number;
  organizations: string[];
  executionPlanOperation: RawPlanOperation;
};
export type RawExecutionPlan = {
  id: string;
  instructions: RawPlanInstruction[];
  contract?: { investors?: { investor?: string; role?: string; signature?: RawSignature }[] };
};

export type TranslatedPlan = {
  planId: string;
  instructions: PlanInstruction[];
  signatures: PlanInvestmentSignature[];
};

/**
 * Deterministic escrow operationId for a hold instruction. The orchestrator's
 * per-request operationIds are not part of the plan payload, so the on-chain
 * mirror keys escrow holds by plan + hold sequence instead.
 */
export const holdOperationId = (planId: string, holdSequence: number): string => `${planId}:${holdSequence}`;

type HoldRecord = {
  sequence: number;
  assetId: string;
  assetType: number;
  source: string;
  destination: string;
  operationId: string;
  amount: string;
  consumed: boolean;
};

const finIdOf = (account: RawLedgerAccountAsset | undefined): string => account?.finp2pAccount?.account?.finId ?? "";
const assetIdOf = (account: RawLedgerAccountAsset | undefined): string => account?.finp2pAccount?.asset?.id ?? "";

/**
 * Translate a raw FinAPI execution plan into the on-chain mirror: an ordered
 * instruction list plus the deduplicated investor signatures they reference.
 * Throws ValidationError when the plan cannot be mirrored (missing/non-EIP712
 * signature on a local asset movement, malformed sequences, release without a
 * matching hold).
 */
export const translateExecutionPlan = (plan: RawExecutionPlan, orgId: string): TranslatedPlan => {
  const planId = plan.id;
  if (!planId) {
    throw new ValidationError("Execution plan has no id");
  }
  const sorted = [...(plan.instructions ?? [])].sort((a, b) => a.sequence - b.sequence);
  if (sorted.length === 0) {
    throw new ValidationError(`Execution plan ${planId} has no instructions`);
  }
  sorted.forEach((instruction, i) => {
    if (instruction.sequence !== i + 1) {
      throw new ValidationError(`Execution plan ${planId} has non-contiguous instruction sequences`);
    }
  });

  const signatures: PlanInvestmentSignature[] = [];
  const signatureIndexByHex = new Map<string, number>();
  const holds: HoldRecord[] = [];

  const registerSignature = (raw: RawSignature, signerFinId: string): { index: number; details: TemplateBusinessDetails } => {
    if (raw.template?.type !== "EIP712") {
      throw new ValidationError(`Only EIP712 signature templates can be mirrored on-chain, got '${raw.template?.type}'`);
    }
    const details = businessDetailsFromTemplate(raw.template as unknown as EIP712Template);
    const hex = raw.signature.startsWith("0x") ? raw.signature : `0x${raw.signature}`;
    const existing = signatureIndexByHex.get(hex);
    if (existing !== undefined) {
      return { index: existing, details };
    }
    signatures.push({
      eip712PrimaryType: details.primaryType,
      nonce: details.nonce,
      buyerFinId: details.buyerFinId,
      sellerFinId: details.sellerFinId,
      asset: details.asset,
      settlement: details.settlement,
      loan: details.loan,
      signerFinId,
      signature: hex
    });
    const index = signatures.length - 1;
    signatureIndexByHex.set(hex, index);
    return { index, details };
  };

  const assetTypeFor = (assetId: string, details: TemplateBusinessDetails | undefined): number => {
    if (details) {
      if (details.asset.assetId === assetId) return details.asset.assetType;
      if (details.settlement.assetId === assetId) return details.settlement.assetType;
    }
    return 0; // AssetType.FinP2P
  };

  const findHold = (assetId: string, matcher: (h: HoldRecord) => boolean): HoldRecord | undefined => {
    for (let i = holds.length - 1; i >= 0; i--) {
      const hold = holds[i];
      if (!hold.consumed && hold.assetId === assetId && matcher(hold)) return hold;
    }
    return undefined;
  };

  const instructions: PlanInstruction[] = sorted.map((raw) => {
    const { sequence, organizations, executionPlanOperation: op } = raw;
    const local = organizations.length === 0 || organizations.includes(orgId);
    const venue = local ? ExecutionVenue.OnLedger : ExecutionVenue.OffLedger;
    const organizationId = local ? "" : (organizations.find((o) => o !== orgId) ?? organizations[0]);

    const base = {
      sequence,
      venue,
      organizationId,
      operationId: "",
      signatureIndex: NO_SIGNATURE,
      state: ExecutionState.Pending
    };

    switch (op.type) {
      case "issue": {
        const assetId = assetIdOf(op.destination);
        let details: TemplateBusinessDetails | undefined;
        if (op.signature?.template?.type === "EIP712") {
          details = businessDetailsFromTemplate(op.signature.template as unknown as EIP712Template);
        }
        return {
          ...base,
          instructionType: PlanInstructionType.Issue,
          assetId,
          assetType: assetTypeFor(assetId, details),
          source: "",
          destination: finIdOf(op.destination),
          amount: op.amount ?? ""
        };
      }
      case "transfer": {
        const assetId = assetIdOf(op.source);
        const source = finIdOf(op.source);
        let signatureIndex = NO_SIGNATURE;
        let details: TemplateBusinessDetails | undefined;
        if (local) {
          if (!op.signature) {
            throw new ValidationError(`Transfer instruction ${sequence} of plan ${planId} has no investor signature`);
          }
          ({ index: signatureIndex, details } = registerSignature(op.signature, source));
        } else if (op.signature?.template?.type === "EIP712") {
          details = businessDetailsFromTemplate(op.signature.template as unknown as EIP712Template);
        }
        return {
          ...base,
          instructionType: PlanInstructionType.Transfer,
          assetId,
          assetType: assetTypeFor(assetId, details),
          source,
          destination: finIdOf(op.destination),
          amount: op.amount ?? "",
          signatureIndex
        };
      }
      case "hold": {
        const assetId = assetIdOf(op.source);
        const source = finIdOf(op.source);
        const destination = finIdOf(op.destination);
        const operationId = holdOperationId(planId, sequence);
        let signatureIndex = NO_SIGNATURE;
        let details: TemplateBusinessDetails | undefined;
        if (local) {
          if (!op.signature) {
            throw new ValidationError(`Hold instruction ${sequence} of plan ${planId} has no investor signature`);
          }
          ({ index: signatureIndex, details } = registerSignature(op.signature, source));
        } else if (op.signature?.template?.type === "EIP712") {
          details = businessDetailsFromTemplate(op.signature.template as unknown as EIP712Template);
        }
        const assetType = assetTypeFor(assetId, details);
        if (local) {
          holds.push({ sequence, assetId, assetType, source, destination, operationId, amount: op.amount ?? "", consumed: false });
        }
        return {
          ...base,
          instructionType: PlanInstructionType.Hold,
          assetId,
          assetType,
          source,
          destination,
          amount: op.amount ?? "",
          operationId,
          signatureIndex
        };
      }
      case "release": {
        const assetId = assetIdOf(op.source);
        const destination = finIdOf(op.destination);
        if (!local) {
          return {
            ...base,
            instructionType: PlanInstructionType.Release,
            assetId,
            assetType: 0,
            source: finIdOf(op.source),
            destination,
            amount: op.amount ?? ""
          };
        }
        // only holds pinned to the same destination qualify: destinationless
        // (redeem-style) holds can only be burned or rolled back
        const hold = findHold(assetId, (h) => h.destination !== "" && h.destination === destination);
        if (!hold) {
          throw new ValidationError(`Release instruction ${sequence} of plan ${planId} has no matching hold`);
        }
        // the escrow always releases the full held amount; a differing release
        // amount would make receipts lie about what moved
        if (op.amount !== undefined && op.amount !== hold.amount) {
          throw new ValidationError(
            `Release instruction ${sequence} of plan ${planId} releases ${op.amount} but the matching hold is for ${hold.amount}`);
        }
        hold.consumed = true;
        return {
          ...base,
          instructionType: PlanInstructionType.Release,
          assetId,
          assetType: hold.assetType,
          source: hold.source,
          destination,
          amount: hold.amount,
          operationId: hold.operationId
        };
      }
      case "redeem": {
        const assetId = assetIdOf(op.source);
        const source = finIdOf(op.source);
        if (local) {
          const hold = findHold(assetId, (h) => h.source === source);
          if (hold) {
            // redeem of previously escrowed funds → burn from escrow; the
            // escrow always burns the full held amount
            if (op.amount !== undefined && op.amount !== hold.amount) {
              throw new ValidationError(
                `Redeem instruction ${sequence} of plan ${planId} redeems ${op.amount} but the matching hold is for ${hold.amount}`);
            }
            hold.consumed = true;
            return {
              ...base,
              instructionType: PlanInstructionType.ReleaseAndRedeem,
              assetId,
              assetType: hold.assetType,
              source,
              destination: "",
              amount: hold.amount,
              operationId: hold.operationId
            };
          }
        }
        let details: TemplateBusinessDetails | undefined;
        if (op.signature?.template?.type === "EIP712") {
          details = businessDetailsFromTemplate(op.signature.template as unknown as EIP712Template);
        }
        return {
          ...base,
          instructionType: PlanInstructionType.Redeem,
          assetId,
          assetType: assetTypeFor(assetId, details),
          source,
          destination: "",
          amount: op.amount ?? ""
        };
      }
      case "revertHoldInstruction": {
        const assetId = assetIdOf(op.destination) || assetIdOf(op.source);
        if (!local) {
          return {
            ...base,
            instructionType: PlanInstructionType.RevertHold,
            assetId,
            assetType: 0,
            source: finIdOf(op.source),
            destination: finIdOf(op.destination),
            amount: ""
          };
        }
        // the revert destination is the original hold source getting funds back
        const destination = finIdOf(op.destination);
        const hold = findHold(assetId, (h) => h.source === destination || destination === "");
        if (!hold) {
          throw new ValidationError(`Revert-hold instruction ${sequence} of plan ${planId} has no matching hold`);
        }
        hold.consumed = true;
        return {
          ...base,
          instructionType: PlanInstructionType.RevertHold,
          assetId,
          assetType: hold.assetType,
          source: hold.source,
          destination: "",
          amount: hold.amount,
          operationId: hold.operationId
        };
      }
      case "await": {
        return {
          ...base,
          instructionType: PlanInstructionType.Await,
          assetId: "",
          assetType: 0,
          source: "",
          destination: "",
          amount: ""
        };
      }
      default:
        throw new ValidationError(`Unsupported execution plan instruction type: ${(op as { type: string }).type}`);
    }
  });

  return { planId, instructions, signatures };
};
