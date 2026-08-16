import winston from 'winston';
import { FinP2PContract, WalletResolutionMode } from '@owneraio/finp2p-ethereum-orchestrator';

/**
 * Boot-time probe of the contract's wallet resolution mode. A probe failure
 * (RPC fault, or a contract predating getWalletResolutionMode) must not stop
 * the application: WalletMapping is the default — the long-standing
 * credentials-registry behavior; FinIdDerivation is a demo mode a deployment
 * opts into deliberately.
 */
export async function probeWalletResolutionMode(finP2PContract: FinP2PContract, logger: winston.Logger): Promise<WalletResolutionMode> {
  try {
    const mode = await finP2PContract.getWalletResolutionMode();
    logger.info(`FinP2P contract wallet resolution mode: ${WalletResolutionMode[mode]}`);
    return mode;
  } catch (e) {
    logger.warn(`FinP2P contract wallet resolution mode probe failed — defaulting to WalletMapping: ${(e as Error).message}`);
    return WalletResolutionMode.WalletMapping;
  }
}
