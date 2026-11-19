import { NonceManager, Provider, Signer, TransactionRequest } from "ethers";
import { ERC20WithOperator__factory } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { Logger, resetSignerNonce, sendWithNonceRecovery } from "@owneraio/finp2p-ethereum-orchestrator";

/**
 * A NonceManager that drops its cached nonce when a send fails, so the next
 * transaction reads the nonce from the chain instead of queueing behind one
 * that never arrived. Covers every send on the signer, including those made
 * inside plugins and venues that only return a receipt.
 */
export class RecoveringNonceManager extends NonceManager {
  override connect(provider: Provider | null): RecoveringNonceManager {
    return new RecoveringNonceManager(this.signer.connect(provider));
  }

  override async sendTransaction(tx: TransactionRequest) {
    try {
      return await super.sendTransaction(tx);
    } catch (e) {
      this.reset();
      throw e;
    }
  }
}

/** Runs an operation that sends transactions, resyncing the signer's nonce if it throws. */
export async function resetNonceOnFailure<T>(signer: Signer, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    resetSignerNonce(signer);
    throw e;
  }
}

/** The pieces of a ContractsManager a direct send needs. */
export interface SendContext {
  provider: Provider;
  signer: Signer;
  logger: Logger;
  confirmationTimeoutMs: number;
}

/** Deploys an ERC20WithOperator with the same nonce recovery as ContractsManager sends. */
export async function deployERC20WithRecovery(
  ctx: SendContext, name: string, symbol: string, decimals: number, operatorAddress: string,
): Promise<string> {
  const { provider, signer, logger, confirmationTimeoutMs } = ctx;
  const deployment = await new ERC20WithOperator__factory(signer).getDeployTransaction(name, symbol, decimals, operatorAddress);
  const receipt = await sendWithNonceRecovery(signer, () => signer.sendTransaction(deployment), {
    provider, logger, confirmationTimeoutMs,
  });
  if (!receipt?.contractAddress) {
    throw new Error(`ERC20 deployment ${receipt?.hash} produced no contract address`);
  }
  return receipt.contractAddress;
}
