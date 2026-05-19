import { isAddress } from "ethers";
import { FinP2PContract, finIdToAddress } from "../src";
import { createJsonProvider, parseConfig } from "./config";
import { Logger, ConsoleLogger } from "../src/adapter-types";

const logger: Logger = new ConsoleLogger("info");

const associateCredential = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  finp2pContractAddress: string,
  finId: string,
  addressOverride?: string,
) => {
  let address: string;
  if (addressOverride) {
    if (!isAddress(addressOverride)) {
      throw new Error(`Invalid address: ${addressOverride}`);
    }
    address = addressOverride;
  } else {
    address = finIdToAddress(finId);
    logger.info(`Derived address ${address} from finId ${finId}`);
  }

  logger.info(`Associating finId ${finId} → ${address} on finP2P contract ${finp2pContractAddress}`);

  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const finP2P = new FinP2PContract(provider, signer, finp2pContractAddress, logger);

  try {
    const existing = await finP2P.getCredentialAddress(finId);
    if (existing && existing !== "0x0000000000000000000000000000000000000000") {
      logger.info(`Credential already registered: ${finId} → ${existing}`);
      if (existing.toLowerCase() === address.toLowerCase()) {
        logger.info("Nothing to do.");
        return;
      }
      logger.info(`Overwriting with ${address}...`);
    }
  } catch {
    // not registered yet — fall through to addCredential
  }

  await finP2P.addCredential(finId, address);
  logger.info("Credential associated successfully");
};

const config = parseConfig([
  {
    name: "operator_pk",
    envVar: "OPERATOR_PRIVATE_KEY",
    required: true,
    description: "Operator private key"
  },
  {
    name: "rpc_url",
    envVar: "RPC_URL",
    required: true,
    description: "Ethereum RPC URL"
  },
  {
    name: "finp2p_contract_address",
    envVar: "FINP2P_CONTRACT_ADDRESS",
    description: "FinP2P contract address",
    required: true
  },
  {
    name: "fin_id",
    envVar: "FIN_ID",
    description: "finId (secp256k1 public key) to associate",
    required: true
  },
  {
    name: "address",
    envVar: "ADDRESS",
    description: "Optional Ethereum address to bind. Defaults to address derived from finId"
  }
]);

associateCredential(
  config.operator_pk!,
  config.rpc_url!,
  config.finp2p_contract_address!,
  config.fin_id!,
  config.address,
)
  .then(() => {
  }).catch(console.error);
