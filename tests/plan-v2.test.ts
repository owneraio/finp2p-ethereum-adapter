import { ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { Contract, Wallet, ZeroAddress } from "ethers";
import winston, { format, transports } from "winston";
import {
  ContractsManager,
  ExecutionPlanStatus,
  FinP2PPlanContract,
  MINTER_ROLE,
  OPERATOR_ROLE,
  RECEIPT_PROOF_TYPES,
  eip712Asset,
  eip712Destination,
  eip712ExecutionContext,
  eip712Source,
  eip712TradeDetails,
  eip712TransactionDetails,
  finIdToAddress,
  getFinId,
  newInvestmentMessage,
  newReceiptMessage,
  eip712Term,
  signEIP712
} from "@owneraio/finp2p-contracts";
import { approvedPlan } from "@owneraio/finp2p-nodejs-skeleton-adapter";
import { createJsonProvider } from "../src/config";
import { InMemoryExecDetailsStore } from "../src/services/finp2p-contract";
import {
  PlanBasedApprovalService,
  PlanEscrowService,
  PlanTokenService,
  ProofSyncService
} from "../src/services/finp2p-contract-v2";
import { RawExecutionPlan } from "../src/services/finp2p-contract-v2/plan-translator";

const ORG = "bank-us";
const REMOTE_ORG = "bank-uk";
const PORT = 8600 + Math.floor(Math.random() * 200);
const RPC_URL = `http://127.0.0.1:${PORT}`;
// hardhat's first default account
const DEPLOYER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const logger = winston.createLogger({
  level: "error",
  transports: [new transports.Console()],
  format: format.json()
});

const ERC20_ADMIN_ABI = [
  "function grantOperatorTo(address account)",
  "function grantMinterTo(address account)",
  "function mint(address to, uint256 amount)",
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)"
];

jest.setTimeout(180_000);

describe("v2 plan-based services (integration)", () => {

  let node: ChildProcess;
  let planContract: FinP2PPlanContract;
  let escrowAddress: string;
  let provider: ReturnType<typeof createJsonProvider>["provider"];
  let signer: ReturnType<typeof createJsonProvider>["signer"];

  const buyer = Wallet.createRandom();
  const seller = Wallet.createRandom();
  const proofSigner = Wallet.createRandom();
  const buyerFinId = getFinId(buyer);
  const sellerFinId = getFinId(seller);

  const planId = `${ORG}:106:plan-integration-1`;
  const assetId = `${REMOTE_ORG}:102:asset-1`;
  const settlementId = "USD";

  let assetToken: Contract;
  let settlementToken: Contract;

  beforeAll(async () => {
    const contractsDir = join(__dirname, "..", "finp2p-contracts");
    node = spawn("npx", ["hardhat", "node", "--port", `${PORT}`], { cwd: contractsDir, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("hardhat node did not start")), 60_000);
      node.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes("Started HTTP")) {
          clearTimeout(timer);
          resolve();
        }
      });
      node.on("exit", (code) => reject(new Error(`hardhat node exited with ${code}`)));
    });

    ({ provider, signer } = createJsonProvider(DEPLOYER_PK, RPC_URL));
    const manager = new ContractsManager(provider, signer, logger);
    const operatorAddress = await signer.getAddress();
    const deployed = await manager.deployFinP2PPlanContract(operatorAddress);
    escrowAddress = deployed.escrowAddress;
    planContract = new FinP2PPlanContract(provider, signer, deployed.planContractAddress, logger);

    const deployToken = async (): Promise<Contract> => {
      const tokenAddress = await manager.deployERC20("Test", "TST", 2, operatorAddress);
      const token = new Contract(tokenAddress, ERC20_ADMIN_ABI, signer);
      await (await token.grantOperatorTo(deployed.planContractAddress)).wait();
      await (await token.grantOperatorTo(escrowAddress)).wait();
      await (await token.grantMinterTo(deployed.planContractAddress)).wait();
      return token;
    };
    assetToken = await deployToken();
    settlementToken = await deployToken();

    await planContract.associateAsset(assetId, await assetToken.getAddress());
    await planContract.associateAsset(settlementId, await settlementToken.getAddress());
    await planContract.addCredential(buyerFinId, finIdToAddress(buyerFinId));
    await planContract.addCredential(sellerFinId, finIdToAddress(sellerFinId));
    await planContract.addProofSigner(REMOTE_ORG, proofSigner.address);

    await (await settlementToken.mint(finIdToAddress(buyerFinId), 10000)).wait(); // "100.00"
  });

  afterAll(() => {
    node?.kill();
  });

  const buyingTemplateSignature = async () => {
    const { message, types } = newInvestmentMessage(
      1 /* Buying */, "nonce-1", buyerFinId, sellerFinId,
      eip712Term(assetId, "finp2p", "10"),
      eip712Term(settlementId, "fiat", "100")
    );
    const signature = await signEIP712(1, ZeroAddress, types, message, buyer);
    return {
      signature: signature.slice(2),
      template: { type: "EIP712", primaryType: "Buying", message, types }
    };
  };

  const account = (finId: string, asset: string) => ({
    finp2pAccount: { asset: { id: asset }, account: { finId, orgId: ORG } }
  });

  const buildRawPlan = async (): Promise<RawExecutionPlan> => ({
    id: planId,
    instructions: [
      {
        sequence: 1, organizations: [ORG],
        executionPlanOperation: {
          type: "hold",
          source: account(buyerFinId, settlementId),
          destination: account(sellerFinId, settlementId),
          amount: "100",
          signature: await buyingTemplateSignature()
        }
      },
      {
        sequence: 2, organizations: [REMOTE_ORG],
        executionPlanOperation: {
          type: "transfer",
          source: account(sellerFinId, assetId),
          destination: account(buyerFinId, assetId),
          amount: "10"
        }
      },
      {
        sequence: 3, organizations: [ORG],
        executionPlanOperation: {
          type: "release",
          source: account(buyerFinId, settlementId),
          destination: account(sellerFinId, settlementId),
          amount: "100"
        }
      }
    ]
  });

  const remoteCompletionProof = async () => {
    const message = newReceiptMessage(
      "receipt-1", "transfer",
      eip712Source("finId", sellerFinId),
      eip712Destination("finId", buyerFinId),
      eip712Asset(assetId, "finp2p"),
      "10",
      eip712TradeDetails(eip712ExecutionContext(planId, "2")),
      eip712TransactionDetails("op-2", "tx-2")
    );
    const signature = await signEIP712(1, ZeroAddress, RECEIPT_PROOF_TYPES, message, proofSigner);
    return {
      instructionSequenceNumber: 2,
      output: {
        type: "receipt",
        proof: {
          type: "signatureProofPolicy",
          signature: {
            signature,
            template: { type: "EIP712", primaryType: "Receipt", message, types: RECEIPT_PROOF_TYPES }
          }
        }
      }
    };
  };

  test("mirrors the plan at approval, executes local instructions, proves the remote one", async () => {
    const rawPlan = await buildRawPlan();
    const completionEvents: any[] = [];
    const finP2PClientStub = {
      getExecutionPlan: async () => ({ data: { plan: rawPlan, instructionsCompletionEvents: completionEvents } })
    } as any;
    const innerApprovalStub = { approvePlan: async () => approvedPlan() } as any;
    const failingFallback = new Proxy({}, {
      get: (_t, prop) => () => {
        throw new Error(`unexpected fallback call: ${String(prop)}`);
      }
    }) as any;

    const execDetailsStore = new InMemoryExecDetailsStore();
    const proofSync = new ProofSyncService(planContract, finP2PClientStub);
    const approvalService = new PlanBasedApprovalService(ORG, planContract, finP2PClientStub, innerApprovalStub);
    const tokenService = new PlanTokenService(planContract, proofSync, execDetailsStore, failingFallback);
    const escrowService = new PlanEscrowService(planContract, proofSync, execDetailsStore, failingFallback);

    // --- approval mirrors the plan on-chain, investor signature verified in createPlan
    const approval = await approvalService.approvePlan("ik-1", planId);
    expect(approval.type).toBe("approved");
    expect(await planContract.hasPlan(planId)).toBe(true);
    expect((await planContract.getPlan(planId)).status).toBe(ExecutionPlanStatus.Created);

    // --- instruction 1: hold settlement into the escrow contract (no signature used)
    const dummySignature = { signature: "", template: { type: "EIP712", primaryType: "Buying", message: {}, types: {} }, hashFunc: "keccak_256" } as any;
    const holdReceipt = await escrowService.hold(
      "ik-2", "nonce-1", { finId: buyerFinId } as any, { finId: sellerFinId } as any,
      { assetId: settlementId, assetType: "fiat" } as any, "100",
      dummySignature, "orchestrator-op-1", { planId, sequence: 1 } as any);
    expect(holdReceipt.type).toBe("success");
    expect(await settlementToken.balanceOf(escrowAddress)).toBe(10000n);

    // --- instruction 2 is remote: release (seq 3) must fail while it is unproven
    const prematureRelease = await escrowService.release(
      "ik-3", { finId: buyerFinId } as any, { finId: sellerFinId } as any,
      { assetId: settlementId, assetType: "fiat" } as any, "100",
      "orchestrator-op-1", { planId, sequence: 3 } as any);
    expect(prematureRelease.type).toBe("failure");

    // --- the remote ledger completes; its receipt proof appears in the plan events
    completionEvents.push(await remoteCompletionProof());

    // --- release now syncs the proof for seq 2 and executes seq 3
    const releaseReceipt = await escrowService.release(
      "ik-4", { finId: buyerFinId } as any, { finId: sellerFinId } as any,
      { assetId: settlementId, assetType: "fiat" } as any, "100",
      "orchestrator-op-1", { planId, sequence: 3 } as any);
    expect(releaseReceipt.type).toBe("success");

    expect(await settlementToken.balanceOf(escrowAddress)).toBe(0n);
    expect(await settlementToken.balanceOf(finIdToAddress(sellerFinId))).toBe(10000n);

    const finalPlan = await planContract.getPlan(planId);
    expect(finalPlan.status).toBe(ExecutionPlanStatus.Completed);

    // approval is idempotent
    const again = await approvalService.approvePlan("ik-5", planId);
    expect(again.type).toBe("approved");

    // sanity: the token service delegates non-plan calls to the fallback (which throws here)
    await expect(tokenService.issue("ik-6", { assetId, assetType: "finp2p" } as any, buyerFinId, "1", undefined as any))
      .rejects.toThrow(/unexpected fallback call/);
  });

  test("createAsset mirrors the association and token roles onto the plan operator + escrow", async () => {
    const manager = new ContractsManager(provider, signer, logger);
    const newAssetId = `${ORG}:102:asset-created`;
    // token deployed by the (v1) fallback path: adapter's account is the admin
    const newTokenAddress = await manager.deployERC20("Created", "CRD", 2, await signer.getAddress());
    const fallbackStub = {
      createAsset: async () => ({
        operation: "createAsset", type: "success",
        result: { ledgerIdentifier: { assetIdentifierType: "CAIP-19", network: "test", tokenId: newTokenAddress, standard: "ERC20" } }
      })
    } as any;

    const tokenService = new PlanTokenService(planContract, new ProofSyncService(planContract, undefined),
      new InMemoryExecDetailsStore(), fallbackStub);
    const result = await tokenService.createAsset("ik-ca", newAssetId, undefined, undefined, undefined, undefined, undefined);
    expect(result.type).toBe("success");

    expect(await planContract.getAssetAddress(newAssetId)).toBe(newTokenAddress);
    const token = new Contract(newTokenAddress, ["function hasRole(bytes32,address) view returns (bool)"], provider);
    expect(await token.hasRole(OPERATOR_ROLE, planContract.planContractAddress)).toBe(true);
    expect(await token.hasRole(MINTER_ROLE, planContract.planContractAddress)).toBe(true);
    expect(await token.hasRole(OPERATOR_ROLE, escrowAddress)).toBe(true);

    // idempotent retry: association already exists, still succeeds
    const retry = await tokenService.createAsset("ik-ca-2", newAssetId, undefined, undefined, undefined, undefined, undefined);
    expect(retry.type).toBe("success");
  });
});
