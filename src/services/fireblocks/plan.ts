import { PlanApprovalService, PlanApprovalStatus } from '@owneraio/finp2p-adapter-models'

export class PlanApprovalServiceImpl implements PlanApprovalService {
  async approvePlan(idempotencyKey: string, planId: string): Promise<PlanApprovalStatus> {
    throw new Error('Method not implemented.');
  }
}
