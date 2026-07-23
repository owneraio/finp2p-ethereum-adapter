import { HealthService } from '@owneraio/finp2p-nodejs-skeleton-adapter'
import { Provider } from 'ethers'

export class HealthServiceImpl implements HealthService {
    constructor(readonly provider: Provider) {}

    async liveness(): Promise<void> {
      await this.provider.getNetwork()
    }

    async readiness(): Promise<void> {
      await this.provider.getBlockNumber()
    }
}
