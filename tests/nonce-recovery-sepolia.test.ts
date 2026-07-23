/**
 * Real Sepolia diagnostic for the safeExecuteTransaction nonce-recovery wrapper
 * in @owneraio/finp2p-ethereum-orchestrator (manager.ts).
 *
 * Two NonceManager instances share one operator key; both prime their internal
 * nonce caches; manager A submits a tx (chain nonce + 1); manager B's cache is
 * now stale. We then exercise B and see whether the wrapper auto-resets on the
 * resulting nonce collision.
 *
 * The user reports the wrapper "fell through" in production despite the recovery
 * logic. This test is a controlled reproduction:
 *
 *   1. land tx_A and confirm it (chain nonce moves), then race a stale-nonce
 *      tx_B with NO wrapper — capture the raw error shape that ethers v6
 *      actually emits, so we can compare against detectError's pattern matches.
 *   2. exercise the wrapper end-to-end with the same scenario and assert that
 *      it actually recovers.
 *
 * Parameters default to the live values used by `k3d-local6 / org-a / ethereum`:
 *   SEPOLIA_RPC_URL          (default https://ethereum-sepolia-rpc.publicnode.com)
 *   OPERATOR_PRIVATE_KEY     — funded operator key, REQUIRED
 *   ERC20_TOKEN_ADDRESS      (default 0x16C188C6966D6Fc2999b2cF9D5267D517045F65B —
 *                             an ERC20WithOperator associated to org-a's
 *                             FinP2P contract on Sepolia)
 *
 * Tx used: ERC20.approve(self, 0) on the configured token. Anyone can call;
 * idempotent; costs ~46k gas per call. Wrapped via a tiny ContractsManager
 * subclass that exposes safeExecuteTransaction publicly — that's the very
 * helper we want to exercise.
 *
 * Run: SEPOLIA_RPC_URL=... OPERATOR_PRIVATE_KEY=... \
 *      npx jest --config jest.nonce-recovery.config.js
 */

import { JsonRpcProvider, NonceManager, Wallet, ContractFactory, BaseContract, ContractTransactionReceipt, ContractTransactionResponse } from 'ethers';
import { ContractsManager } from '@owneraio/finp2p-ethereum-orchestrator';
type PayableOverrides = { nonce?: number; gasLimit?: bigint; gasPrice?: bigint; value?: bigint };
import winston from 'winston';

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const OPERATOR_PK = process.env.OPERATOR_PRIVATE_KEY;
const ERC20_ADDRESS = process.env.ERC20_TOKEN_ADDRESS ?? '0x16C188C6966D6Fc2999b2cF9D5267D517045F65B';

const ERC20_ABI = [
  'function approve(address spender, uint256 value) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

/** Test-only wrapper: exposes the protected safeExecuteTransaction. */
class TestableManager extends ContractsManager {
  async safeExecute<C extends BaseContract>(
    contract: C,
    call: (c: C, overrides: PayableOverrides) => Promise<ContractTransactionResponse>,
    maxAttempts: number = 10,
  ): Promise<ContractTransactionReceipt> {
    return (this as any).safeExecuteTransaction(contract, call, maxAttempts);
  }
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  transports: [new winston.transports.Console({ format: winston.format.simple() })],
}) as any;

(OPERATOR_PK ? describe : describe.skip)('safeExecuteTransaction nonce recovery — Sepolia', () => {
  let provider: JsonRpcProvider;
  let operatorAddress: string;

  beforeAll(async () => {
    provider = new JsonRpcProvider(SEPOLIA_RPC);
    operatorAddress = new Wallet(OPERATOR_PK!).address;
    const balance = await provider.getBalance(operatorAddress);
    logger.info(`operator=${operatorAddress} balance=${balance.toString()} wei nonce(latest)=${await provider.getTransactionCount(operatorAddress, 'latest')}`);
  });

  it('captures the raw error shape ethers v6 emits on a stale-nonce submit (no wrapper)', async () => {
    // Step 1: send & confirm an ERC20.approve from a fresh signer. The on-chain
    // nonce now sits at N+1.
    const wallet = new Wallet(OPERATOR_PK!).connect(provider);
    const startingNonce = await provider.getTransactionCount(operatorAddress, 'latest');
    const factory = new ContractFactory(ERC20_ABI, '0x', wallet);
    const erc20 = factory.attach(ERC20_ADDRESS) as BaseContract & {
      approve(spender: string, value: bigint, overrides?: PayableOverrides): Promise<ContractTransactionResponse>;
    };
    logger.info(`landing tx_A at nonce=${startingNonce}…`);
    const tx1 = await erc20.approve(operatorAddress, 0n, { nonce: startingNonce });
    await tx1.wait();
    const onchainAfter = await provider.getTransactionCount(operatorAddress, 'latest');
    expect(onchainAfter).toBe(startingNonce + 1);
    logger.info(`tx_A confirmed; on-chain nonce now ${onchainAfter}`);

    // Step 2: deliberately submit a *stale-nonce* tx (the just-used N).
    let losingError: any = undefined;
    try {
      const tx2 = await erc20.approve(operatorAddress, 0n, { nonce: startingNonce });
      await tx2.wait();
    } catch (e) {
      losingError = e;
    }
    expect(losingError).toBeDefined();

    // Diagnostic dump — what we care about for detectError matching.
    logger.info(`stale-nonce error code=${losingError?.code}`);
    logger.info(`stale-nonce error shortMessage=${losingError?.shortMessage}`);
    logger.info(`stale-nonce error info=${JSON.stringify(losingError?.info)}`);
    logger.info(`stale-nonce error e.error=${JSON.stringify(losingError?.error)}`);
    logger.info(`stale-nonce error message=${losingError?.message}`);

    // detectError currently matches via:
    //   • code === 'REPLACEMENT_UNDERPRICED' OR
    //   • String(e).includes("nonce has already been used") OR
    //   • e.error.code === -32000           (v5 inner-error shape)
    //   • e.error.message.startsWith('Nonce too high')  (v5 inner-error shape)
    const checks = {
      codeReplacementUnderpriced: losingError?.code === 'REPLACEMENT_UNDERPRICED',
      codeNonceExpired: losingError?.code === 'NONCE_EXPIRED',
      stringIncludesAlreadyUsed: String(losingError).includes('nonce has already been used'),
      v5InnerErrorCodeMinus32000: losingError?.error?.code === -32000,
      v5InnerErrorStartsWithNonceTooHigh: typeof losingError?.error?.message === 'string'
        && losingError.error.message.startsWith('Nonce too high'),
      v6InfoErrorCodeMinus32000: losingError?.info?.error?.code === -32000,
      v6InfoErrorMessage: losingError?.info?.error?.message,
    };
    logger.info(`detectError branch hits: ${JSON.stringify(checks)}`);
  });

  it('exercises safeExecuteTransaction end-to-end with two managers sharing a key', async () => {
    // Two NonceManagers wrapping the same operator key. Both prime their cache;
    // A submits successfully (nonce N → N+1); B's cache is now stale at N. We
    // then ask manager B to submit through the wrapper — the wrapper should see
    // the nonce conflict, reset B, retry at N+1, and succeed.
    const signerA = new NonceManager(new Wallet(OPERATOR_PK!)).connect(provider);
    const signerB = new NonceManager(new Wallet(OPERATOR_PK!)).connect(provider);
    const managerA = new TestableManager(provider, signerA, logger);
    const managerB = new TestableManager(provider, signerB, logger);

    const cachedA = await signerA.getNonce();
    const cachedB = await signerB.getNonce();
    expect(cachedA).toBe(cachedB);
    logger.info(`primed both signers at nonce=${cachedA}`);

    const factoryA = new ContractFactory(ERC20_ABI, '0x', signerA);
    const factoryB = new ContractFactory(ERC20_ABI, '0x', signerB);
    const erc20A = factoryA.attach(ERC20_ADDRESS) as BaseContract & {
      approve(spender: string, value: bigint, overrides?: PayableOverrides): Promise<ContractTransactionResponse>;
    };
    const erc20B = factoryB.attach(ERC20_ADDRESS) as BaseContract & {
      approve(spender: string, value: bigint, overrides?: PayableOverrides): Promise<ContractTransactionResponse>;
    };

    logger.info(`A submitting via wrapper…`);
    await managerA.safeExecute(erc20A, async (c, txParams) =>
      c.approve(operatorAddress, 0n, txParams));
    const onchainAfterA = await provider.getTransactionCount(operatorAddress, 'latest');
    expect(onchainAfterA).toBe(cachedA + 1);
    logger.info(`A landed; on-chain nonce=${onchainAfterA}; B.cache=${cachedB} (stale)`);

    // B's local cache is still cachedB (= cachedA), stale by 1. Wrapper must
    // detect-and-recover.
    let bRecovered = true;
    let bError: any = undefined;
    try {
      await managerB.safeExecute(erc20B, async (c, txParams) =>
        c.approve(operatorAddress, 0n, txParams));
    } catch (e) {
      bRecovered = false;
      bError = e;
    }

    if (!bRecovered) {
      logger.error(`B did NOT recover — wrapper fell through.`);
      logger.error(`error code=${bError?.code}`);
      logger.error(`error shortMessage=${bError?.shortMessage}`);
      logger.error(`error info=${JSON.stringify(bError?.info)}`);
      logger.error(`error message=${bError?.message}`);
    }

    expect(bRecovered).toBe(true);
    const onchainAfterB = await provider.getTransactionCount(operatorAddress, 'latest');
    expect(onchainAfterB).toBe(cachedA + 2);
  });
});
