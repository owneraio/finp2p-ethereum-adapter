import { PlanApprovalService, PlanApprovalStatus, PlanProposal } from '@owneraio/finp2p-adapter-models'

export class PlanApprovalServiceImpl implements PlanApprovalService {
  async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    throw new Error('Method not implemented.');
  }

  async proposeCancelPlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    throw new Error('Method not implemented.');
  }

  async proposeResetPlan(idempotencyKey: string, planId: string, proposedSequence: number): Promise<PlanApprovalStatus> {
    throw new Error('Method not implemented.');
  }

  async proposeInstructionApproval(idempotencyKey: string, planId: string, instructionSequence: number): Promise<PlanApprovalStatus> {
    throw new Error('Method not implemented.');
  }

  async proposalStatus(planId: string, proposal: PlanProposal, status: 'approved' | 'rejected'): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
