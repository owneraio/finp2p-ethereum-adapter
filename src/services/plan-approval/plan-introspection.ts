// A normalized, option-friendly view of a FinP2P execution plan, produced once
// per approval and shared across all approval options. Options read this
// instead of re-parsing the raw FinAPI payload (or re-fetching the plan).

export type IntrospectedInstruction = {
  sequence?: number;
  /** FinAPI operation type: issue | transfer | hold | release | redeem | revertHoldInstruction | await */
  type?: string;
  organizations: string[];
  /** true when this instruction executes on this organization's ledger */
  local: boolean;
  sourceFinId?: string;
  destinationFinId?: string;
  /** explicit ledger address (FinAPI networkAccount), execution's fallback when the finId is unmapped */
  sourceAddress?: string;
  destinationAddress?: string;
  assetId?: string;
  amount?: string;
};

export type IntrospectedPlan = {
  planId: string;
  orgId: string;
  instructions: IntrospectedInstruction[];
  /** escape hatch for options needing fields introspection doesn't surface */
  raw: any;
};

type RawAccount = {
  finp2pAccount?: { account?: { finId?: string }; asset?: { id?: string } };
  networkAccount?: { address?: string };
};
const finIdOf = (account: RawAccount | undefined): string | undefined => account?.finp2pAccount?.account?.finId;
const assetIdOf = (account: RawAccount | undefined): string | undefined => account?.finp2pAccount?.asset?.id;
const addressOf = (account: RawAccount | undefined): string | undefined => account?.networkAccount?.address;

/**
 * Normalize the raw FinAPI execution plan into an IntrospectedPlan. An
 * instruction is `local` when it has no executing organizations or names this
 * org (the same rule the orchestration translator uses for the on-/off-ledger
 * venue split).
 */
export const introspectPlan = (planId: string, orgId: string, rawPlan: any): IntrospectedPlan => {
  const instructions: IntrospectedInstruction[] = (rawPlan?.instructions ?? []).map((instruction: any) => {
    const op = instruction.executionPlanOperation ?? {};
    const organizations: string[] = instruction.organizations ?? [];
    return {
      sequence: instruction.sequence,
      type: op.type,
      organizations,
      local: organizations.length === 0 || organizations.includes(orgId),
      sourceFinId: finIdOf(op.source),
      destinationFinId: finIdOf(op.destination),
      sourceAddress: addressOf(op.source),
      destinationAddress: addressOf(op.destination),
      assetId: assetIdOf(op.source) ?? assetIdOf(op.destination),
      amount: op.amount
    };
  });
  return { planId, orgId, instructions, raw: rawPlan };
};
