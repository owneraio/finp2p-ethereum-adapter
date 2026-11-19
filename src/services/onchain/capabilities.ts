import { getAddress } from "ethers";
import { ContractCapability, ExecutionContext, InstructionCapability } from "@owneraio/finp2p-nodejs-skeleton-adapter";
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

const CAIP10_CONTRACT = /^([A-Za-z0-9-]{3,8}):([0-9]+):(0x[0-9a-fA-F]{40})$/;

const contractId = (chainId: bigint, address: string): ContractCapability => ({
  address: `eip155:${chainId}:${getAddress(address)}`,
  addressFormat: "caip10",
});

/**
 * The 0x address of a requested contract written as CAIP-10 for this chain.
 * The namespace (eip155) is compared in any letter case, the chain reference
 * exactly. Anything else, including a bare 0x address, is undefined.
 */
export const requestedEvmAddress = (requested: string, chainId: bigint): string | undefined => {
  const match = CAIP10_CONTRACT.exec(requested);
  return match && match[1].toLowerCase() === "eip155" && match[2] === chainId.toString() ? match[3] : undefined;
};

/** True when the requested contract is `address` on this chain, the address in any letter case. */
export const isRequestedContract = (requested: string, chainId: bigint, address: string): boolean =>
  requestedEvmAddress(requested, chainId)?.toLowerCase() === address.toLowerCase();

export const onChainCapabilities = (
  chainId: bigint,
  operatorAddress: string,
  venues: NamedSwapVenue[],
): InstructionCapability[] => {
  const list: InstructionCapability[] = OPERATOR_INSTRUCTIONS.map((instruction) => ({
    instruction,
    contracts: [contractId(chainId, operatorAddress)],
  }));
  if (venues.length > 0) {
    list.push({
      instruction: "INSTRUCTION_SWAP",
      contracts: venues.map(({ venue }) => contractId(chainId, venue.venueAddress)),
    });
  }
  return list;
};

const unavailable = (contract: string, instruction: string): string =>
  `contract ${contract} is not available for ${instruction} on this adapter`;

/** Returns an error message when the requested contract is not the operator on this chain, undefined otherwise. */
export const operatorContractError = (
  instruction: OperatorInstruction | "INSTRUCTION_SWAP",
  exCtx: ExecutionContext | undefined,
  operatorAddress: string,
  chainId: bigint,
): string | undefined => {
  const requested = exCtx?.contract;
  if (requested === undefined || isRequestedContract(requested, chainId, operatorAddress)) {
    return undefined;
  }
  return unavailable(requested, instruction.replace("INSTRUCTION_", ""));
};

export const pickVenue = (
  exCtx: ExecutionContext | undefined,
  venues: NamedSwapVenue[],
  chainId: bigint,
): { venue: SwapVenue } | { error: string } => {
  const requested = exCtx?.contract;
  if (requested === undefined) {
    return venues.length > 0 ? { venue: venues[0].venue } : { error: "no swap venue is configured" };
  }
  const found = venues.find((candidate) => isRequestedContract(requested, chainId, candidate.venue.venueAddress));
  return found ? { venue: found.venue } : { error: unavailable(requested, "SWAP") };
};
