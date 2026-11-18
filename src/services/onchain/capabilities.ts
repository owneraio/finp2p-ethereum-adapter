import { ExecutionContext, InstructionCapability } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { SwapVenue } from "@owneraio/finp2p-ethereum-adapter-contract";
import { NamedSwapVenue } from "../../swap-venues";

const OPERATOR_INSTRUCTIONS = [
  "INSTRUCTION_HOLD",
  "INSTRUCTION_TRANSFER",
  "INSTRUCTION_RELEASE",
  "INSTRUCTION_ISSUE",
  "INSTRUCTION_REVERT_HOLD",
  "INSTRUCTION_REDEEM",
] as const;

export type OperatorInstruction = (typeof OPERATOR_INSTRUCTIONS)[number];

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** EVM addresses compare in any letter case, any other identifier exactly. */
export const sameAddress = (a: string, b: string): boolean =>
  EVM_ADDRESS.test(a) && EVM_ADDRESS.test(b) ? a.toLowerCase() === b.toLowerCase() : a === b;

export const onChainCapabilities = (operatorAddress: string, venues: NamedSwapVenue[]): InstructionCapability[] => {
  const list: InstructionCapability[] = OPERATOR_INSTRUCTIONS.map((instruction) => ({
    instruction,
    contracts: [{
      name: "FINP2POperator",
      address: operatorAddress,
      description: "Holds, moves, issues and redeems the asset",
    }],
  }));
  if (venues.length > 0) {
    list.push({
      instruction: "INSTRUCTION_SWAP",
      contracts: venues.map(({ name, description, venue }) => ({
        name,
        address: venue.venueAddress,
        description,
      })),
    });
  }
  return list;
};

const unavailable = (contract: string, instruction: string): string =>
  `contract ${contract} is not available for ${instruction} on this adapter`;

/** Returns an error message when the requested contract is not the operator, undefined otherwise. */
export const operatorContractError = (
  instruction: OperatorInstruction | "INSTRUCTION_SWAP",
  exCtx: ExecutionContext | undefined,
  operatorAddress: string,
): string | undefined => {
  const requested = exCtx?.contract;
  if (requested === undefined || sameAddress(requested, operatorAddress)) {
    return undefined;
  }
  return unavailable(requested, instruction.replace("INSTRUCTION_", ""));
};

export const pickVenue = (
  exCtx: ExecutionContext | undefined,
  venues: NamedSwapVenue[],
): { venue: SwapVenue } | { error: string } => {
  const requested = exCtx?.contract;
  if (requested === undefined) {
    return { venue: venues[0].venue };
  }
  const found = venues.find((candidate) => sameAddress(candidate.venue.venueAddress, requested));
  return found ? { venue: found.venue } : { error: unavailable(requested, "SWAP") };
};
