import { EthereumTransactionError, NonceAlreadyBeenUsedError, NonceTooHighError, EthereumContractMethodSignatureError } from "./model";


export type DetectedError = EthereumTransactionError |
  NonceTooHighError |
  NonceAlreadyBeenUsedError |
  EthereumContractMethodSignatureError

/**
 * Map raw provider/RPC errors to typed nonce + transaction errors so the
 * safeExecuteTransaction wrapper in `manager.ts` can decide whether to
 * reset the NonceManager and retry.
 *
 * The order of the branches matters: we look for the most specific signals
 * first (substring + ethers `code`), then fall back to the JSON-RPC inner
 * error shape (which differs between ethers v5 and v6 — see below).
 *
 * Inner-error shapes:
 *   • ethers v5: `e.error?.code`, `e.error?.message`
 *   • ethers v6: `e.info?.error?.code`, `e.info?.error?.message`
 * The check below covers both so the wrapper continues to recover after
 * an ethers upgrade.
 */
export const detectError = (e: any): DetectedError | Error => {
  if (`${e}`.includes("no data present; likely require(false) occurred")) {
    return new EthereumContractMethodSignatureError(`${e}`);
  }

  const innerCode = e?.error?.code ?? e?.info?.error?.code;
  const innerMessage = e?.error?.message ?? e?.info?.error?.message;
  const messageString = `${e}`;

  // "Nonce already used" / "nonce too low" — local nonce is BEHIND the chain.
  // Match: ethers code, OZ-style substring, and the v5/v6 inner-error message.
  if (
    e?.code === 'REPLACEMENT_UNDERPRICED' ||
    e?.code === 'NONCE_EXPIRED' ||
    messageString.includes("nonce has already been used") ||
    (typeof innerMessage === 'string' && innerMessage.startsWith("nonce too low"))
  ) {
    return new NonceAlreadyBeenUsedError(messageString);
  }

  // "Nonce too high" — local nonce is AHEAD of the chain (queued in mempool).
  // Match the explicit "Nonce too high" message string in the inner error
  // (v5 `e.error.message` or v6 `e.info.error.message`). We deliberately do
  // NOT match on bare `code === -32000`: that's a generic JSON-RPC "Server
  // error" used for many non-nonce failures ("insufficient funds for gas",
  // "execution reverted", "transaction underpriced", …). Matching it here
  // would force the wrapper to reset the NonceManager and retry up to 10×
  // before surfacing a non-nonce error, masking the real cause.
  if (typeof innerMessage === 'string' && innerMessage.startsWith("Nonce too high")) {
    return new NonceTooHighError(innerMessage);
  }

  // Generic on-chain revert / transaction error.
  if (
    typeof e === 'object' && e !== null &&
    'code' in e && 'action' in e && 'message' in e && 'reason' in e && 'data' in e &&
    e.reason !== undefined && e.reason !== null
  ) {
    return new EthereumTransactionError(e.reason);
  }

  return e;
};
