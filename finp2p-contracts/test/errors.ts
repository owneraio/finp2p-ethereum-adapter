import { expect } from "chai";
import { detectError } from "../src/errors";
import {
  EthereumContractMethodSignatureError,
  EthereumTransactionError,
  NonceAlreadyBeenUsedError,
  NonceTooHighError,
} from "../src/model";

/**
 * Unit tests for detectError(). Exercises the shapes that matter:
 *  • ethers v5 inner-error shape (`e.error.code` / `e.error.message`)
 *  • ethers v6 inner-error shape (`e.info.error.code` / `e.info.error.message`)
 *  • ethers v6 top-level codes (NONCE_EXPIRED / REPLACEMENT_UNDERPRICED)
 *  • the substring fallback in the printed message
 *  • the false-positive guard: bare `code === -32000` must NOT classify
 *    as NonceTooHighError when the message is unrelated (insufficient
 *    funds, execution reverted, ...)
 */
describe("detectError", function () {

  describe("NonceAlreadyBeenUsedError (local nonce behind chain)", () => {
    it("matches ethers v6 NONCE_EXPIRED top-level code", () => {
      const e: any = Object.assign(new Error("nonce has already been used"), {
        code: "NONCE_EXPIRED",
        info: { error: { code: -32000, message: "nonce too low: next nonce 1056, tx nonce 1055" } },
      });
      expect(detectError(e)).to.be.instanceOf(NonceAlreadyBeenUsedError);
    });

    it("matches REPLACEMENT_UNDERPRICED", () => {
      const e: any = Object.assign(new Error("replacement transaction underpriced"), {
        code: "REPLACEMENT_UNDERPRICED",
      });
      expect(detectError(e)).to.be.instanceOf(NonceAlreadyBeenUsedError);
    });

    it("matches the v5 inner-error 'nonce too low' message", () => {
      const e: any = { error: { code: -32000, message: "nonce too low: server has 42, got 41" } };
      expect(detectError(e)).to.be.instanceOf(NonceAlreadyBeenUsedError);
    });

    it("matches the v6 inner-error 'nonce too low' message", () => {
      const e: any = { info: { error: { code: -32000, message: "nonce too low: server has 42, got 41" } } };
      expect(detectError(e)).to.be.instanceOf(NonceAlreadyBeenUsedError);
    });

    it("matches the printed-message substring fallback", () => {
      const e = new Error("some prefix nonce has already been used some suffix");
      expect(detectError(e)).to.be.instanceOf(NonceAlreadyBeenUsedError);
    });
  });

  describe("NonceTooHighError (local nonce ahead of chain)", () => {
    it("matches the v5 inner-error 'Nonce too high' message", () => {
      const e: any = { error: { code: -32000, message: "Nonce too high. Expected 5, got 7" } };
      expect(detectError(e)).to.be.instanceOf(NonceTooHighError);
    });

    it("matches the v6 inner-error 'Nonce too high' message", () => {
      const e: any = { info: { error: { code: -32000, message: "Nonce too high. Expected 5, got 7" } } };
      expect(detectError(e)).to.be.instanceOf(NonceTooHighError);
    });

    it("does NOT match bare code -32000 with an unrelated 'insufficient funds' message", () => {
      // This is the false-positive the original detector hit: -32000 is the
      // generic JSON-RPC server-error code. Classifying it as a nonce error
      // would make safeExecuteTransaction reset + retry 10× and mask the
      // real cause. The fix tightens the match to the message string.
      const e: any = { info: { error: { code: -32000, message: "insufficient funds for gas * price + value" } } };
      const detected = detectError(e);
      expect(detected).not.to.be.instanceOf(NonceTooHighError);
      expect(detected).not.to.be.instanceOf(NonceAlreadyBeenUsedError);
    });

    it("does NOT match bare code -32000 with an unrelated 'execution reverted' message", () => {
      const e: any = { error: { code: -32000, message: "execution reverted: ERC20: transfer amount exceeds balance" } };
      const detected = detectError(e);
      expect(detected).not.to.be.instanceOf(NonceTooHighError);
      expect(detected).not.to.be.instanceOf(NonceAlreadyBeenUsedError);
    });
  });

  describe("EthereumTransactionError", () => {
    it("matches the standard ethers transaction-error shape", () => {
      const e: any = {
        code: "CALL_EXCEPTION",
        action: "sendTransaction",
        message: "execution reverted",
        reason: "ERC20: insufficient allowance",
        data: "0x08c379a0",
      };
      const detected = detectError(e);
      expect(detected).to.be.instanceOf(EthereumTransactionError);
      expect((detected as EthereumTransactionError).message).to.equal("ERC20: insufficient allowance");
    });
  });

  describe("EthereumContractMethodSignatureError", () => {
    it("matches the wrong-method-signature error string", () => {
      const e = new Error("call exception: no data present; likely require(false) occurred");
      expect(detectError(e)).to.be.instanceOf(EthereumContractMethodSignatureError);
    });
  });

  describe("pass-through", () => {
    it("returns the original Error when no branch matches", () => {
      const e = new Error("totally unrelated failure");
      expect(detectError(e)).to.equal(e);
    });

    it("does not throw on null-ish error shapes", () => {
      expect(detectError({})).to.deep.equal({});
      expect(() => detectError(null)).not.to.throw();
      expect(() => detectError(undefined)).not.to.throw();
    });
  });
});
