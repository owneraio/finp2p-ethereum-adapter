import { EthereumTransactionError, NonceAlreadyBeenUsedError, NonceToHighError } from "./model";


export const detectError = (e: any): EthereumTransactionError | NonceToHighError | Error => {
  if ("code" in e && "action" in e && "message" in e && "reason" in e && "data" in e && e.reason !== undefined && e.reason !== null) {
    return new EthereumTransactionError(e.reason);
  } else if ("code" in e && "error" in e && "code" in e.error && "message" in e.error) {
    if (e.error.code === -32000 || e.error.message.startsWith("Nonce too high")
    ) {
      return new NonceToHighError(e.error.message);
    }
  } else if (e.code === "REPLACEMENT_UNDERPRICED" || `${e}`.includes("nonce has already been used")) {
    return new NonceAlreadyBeenUsedError(`${e}`);
  }
  return e;
};
