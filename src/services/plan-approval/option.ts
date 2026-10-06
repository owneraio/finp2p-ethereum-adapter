import { PlanApprovalStatus } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { IntrospectedPlan } from "./plan-introspection";

/**
 * A pluggable behavior applied when a plan is approved, over the introspected
 * plan (fetched once and shared). Options run after the base approval service
 * has approved the plan.
 *
 * An option may:
 *  - perform a side effect (e.g. pre-fund gas) — return void;
 *  - veto the approval (e.g. a party fails token-based whitelisting) — return a
 *    rejected PlanApprovalStatus, which the service returns instead of the
 *    base approval.
 *
 * Side-effect-only options that must not block approval on transient failures
 * (gas prefunding) are responsible for swallowing their own errors; an option
 * that throws rejects the plan.
 */
export interface PlanApprovalOption {
  readonly name: string;

  /**
   * Whether this option gates approval. A gating option (e.g. token-based
   * whitelisting) MUST run to clear the plan, so when the plan cannot be
   * introspected the service rejects rather than approving unchecked. A
   * non-gating option (e.g. gas prefunding) is a side effect that may be
   * skipped on introspection failure without affecting the verdict.
   */
  readonly gating: boolean;

  apply(plan: IntrospectedPlan): Promise<PlanApprovalStatus | void>;
}
