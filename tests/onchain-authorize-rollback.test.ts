// @ts-nocheck
// Integration test: drives the AUTHORIZE grant and its RevertAuthorize rollback end-to-end through
// the adapter's OnChainTokenService against a live FINP2POperator deployed on a local EVM.
//
//   authorize(...)        -> grants the swap venue an ERC20 allowance from the seller (10)
//   rollback(quantity=0)  -> core's RevertAuthorize; revokes that allowance back to 0
//
// Gated like the other chain-touching tests: needs an EVM at ETH_RPC_URL (default a local hardhat
// node). Run with: npx jest --config jest.authorize-rollback.config.js
// (Requires the orchestrator package to carry revertAuthorize + the viaIR-sized FINP2POperator.)
import { JsonRpcProvider, Wallet, ContractFactory, NonceManager } from "ethers";
import { randomBytes } from "crypto";
import { v4 as uuid } from "uuid";
import {
  FinP2PContract,
  term,
  termToEIP712,
  newInvestmentMessage,
  emptyLoanTerms,
  signEIP712,
  getFinId,
  finIdToAddress,
  PrimaryType,
} from "@owneraio/finp2p-ethereum-orchestrator";
import { ERC20WithOperator__factory } from "@owneraio/finp2p-ethereum-erc20-plugin";
import { OnChainTokenService, InMemoryExecDetailsStore } from "../src/services/onchain";

const FINP2P = require("@owneraio/finp2p-ethereum-orchestrator/dist/artifacts/contracts/finp2p/FINP2POperator.sol/FINP2POperator.json");

const RPC = process.env.ETH_RPC_URL || "http://127.0.0.1:8545";
// Standard hardhat/anvil account #0 — deployer and operator.
const OPERATOR_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEC = 2;
const AMOUNT = "10";
const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {} };

const toUnits = (n: string) => BigInt(n) * 10n ** BigInt(DEC);
const mkInvestor = () => {
  const signer = Wallet.createRandom();
  const finId = getFinId(signer);
  return { signer, finId, address: finIdToAddress(finId) };
};

describe("OnChainTokenService authorize -> rollback(revert) against a live FINP2POperator", () => {
  let provider: JsonRpcProvider;
  let reachable = false;
  let token: any;
  let assetId: string;
  let venueAddress: string;
  let service: OnChainTokenService;
  let seller: ReturnType<typeof mkInvestor>;
  let buyer: ReturnType<typeof mkInvestor>;
  let verifyingContract: string;
  let signVerifyingContract: string;
  let chainId: bigint;

  beforeAll(async () => {
    provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
    try {
      await provider.getNetwork();
      reachable = true;
    } catch {
      return; // no EVM — test body short-circuits with a warning
    }

    // NonceManager serializes nonce allocation so the setup deploys and the service's own
    // authorize/rollback transactions (all from account #0) can't race on the EVM's tx nonce.
    const operator = new NonceManager(new Wallet(OPERATOR_PK, provider));
    const operatorAddress = await operator.getAddress();

    // Deploy the operator contract in WALLET_MAPPING mode, plus an operator-controlled ERC20.
    const contract = await new ContractFactory(FINP2P.abi, FINP2P.bytecode, operator).deploy(operatorAddress, 0);
    await contract.waitForDeployment();
    const deployedAddress = await contract.getAddress();
    // Sign against the contract's own EIP-712 domain (chainId + verifyingContract), exactly as the
    // contract reconstructs it when verifying. The wrapper, separately, talks to the deployed address.
    const dom = await contract.eip712Domain();
    chainId = dom.chainId;
    signVerifyingContract = dom.verifyingContract;
    verifyingContract = deployedAddress;

    assetId = `bank-us:102:${uuid()}`;
    token = await new ERC20WithOperator__factory(operator).deploy(assetId, assetId, DEC, verifyingContract);
    await token.waitForDeployment();
    await (await contract.associateAsset(assetId, await token.getAddress())).wait();

    seller = mkInvestor();
    buyer = mkInvestor();
    await (await contract.addCredential(seller.finId, seller.address)).wait();
    await (await contract.addCredential(buyer.finId, buyer.address)).wait();

    venueAddress = Wallet.createRandom().address; // the AllowanceSwap venue, in practice
    const finP2PContract = new FinP2PContract(provider, operator, verifyingContract, logger);
    service = new OnChainTokenService(
      finP2PContract, undefined, new InMemoryExecDetailsStore(), undefined, undefined, undefined,
      { venueAddress } as any,
    );
  }, 120000);

  test("authorize grants the venue allowance, rollback(quantity=0) revokes it to 0", async () => {
    if (!reachable) {
      console.warn(`No EVM reachable at ${RPC} — skipping authorize/rollback integration test.`);
      return;
    }

    const assetTerm = term(assetId, 0, AMOUNT); // AssetType.FinP2P = 0
    const settlementTerm = term("USD", 1, "100"); // AssetType.Fiat = 1
    const loan = emptyLoanTerms();
    const nonce = randomBytes(32).toString("hex");

    // On-chain-verifiable seller signature over the investment intent.
    const { types, message } = newInvestmentMessage(
      PrimaryType.Selling, nonce, buyer.finId, seller.finId,
      termToEIP712(assetTerm), termToEIP712(settlementTerm), loan,
    );
    // The wrapper prepends `0x`, matching the FinP2P API's un-prefixed hex signatures — strip it here.
    const signature = (await signEIP712(chainId, signVerifyingContract, types, message, seller.signer)).replace(/^0x/, "");

    // The adapter's business-detail template the service parses (buyer/seller/asset/settlement).
    const template = {
      type: "EIP712",
      primaryType: "Selling",
      message: {
        buyer: { idkey: buyer.finId },
        seller: { idkey: seller.finId },
        asset: { assetId, assetType: "finp2p", amount: AMOUNT },
        settlement: { assetId: "USD", assetType: "fiat", amount: "100" },
      },
    };
    const ast = { assetId, assetType: "finp2p" };

    expect(await token.allowance(seller.address, venueAddress)).toBe(0n);

    const granted = await service.authorize(
      "idem-grant", nonce, { finId: seller.finId }, { finId: buyer.finId }, ast, AMOUNT,
      { signature, template } as any, "op-authorize-1", undefined, undefined as any,
    );
    expect(granted).toMatchObject({ type: "success" });
    expect(await token.allowance(seller.address, venueAddress)).toBe(toUnits(AMOUNT));

    // Core's RevertAuthorize arrives as /assets/rollback with quantity 0.
    const reverted = await service.rollback(
      "idem-revert", { finId: seller.finId }, ast, "0", "op-authorize-1", undefined,
    );
    expect(reverted).toMatchObject({ type: "success" });
    expect(await token.allowance(seller.address, venueAddress)).toBe(0n);
  }, 120000);
});
