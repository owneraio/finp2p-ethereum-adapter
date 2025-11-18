import { EthereumTransactionError, NonceAlreadyBeenUsedError, NonceTooHighError, EthereumContractMethodSignatureError } from "./model";


export type DetectedError = EthereumTransactionError |
  NonceTooHighError |
  NonceAlreadyBeenUsedError |
  EthereumContractMethodSignatureError

export const detectError = (e: any): DetectedError | Error => {
  if (`${e}`.includes("no data present; likely require(false) occurred")) {
    return new EthereumContractMethodSignatureError(`${e}`)
  } else if ("code" in e && "error" in e && "code" in e.error && "message" in e.error) {
    if (e.error.code === -32000 || e.error.message.startsWith("Nonce too high")
    ) {
      return new NonceTooHighError(e.error.message);
    }
  } else if (e.code === 'REPLACEMENT_UNDERPRICED' || `${e}`.includes("nonce has already been used")) {
    return new NonceAlreadyBeenUsedError(`${e}`);
  } else if ("code" in e && "action" in e && "message" in e && "reason" in e && "data" in e && e.reason !== undefined && e.reason !== null) {
    return new EthereumTransactionError(e.reason);
  }

  return e
};
