import { Logger, ConsoleLogger } from "@owneraio/finp2p-adapter-models";
import { FinP2PContract } from "../src";
import { createJsonProvider, parseConfig } from "./config";

const logger: Logger = new ConsoleLogger("info");


const domainParams = async (
  operatorPrivateKey: string,
  ethereumRPCUrl: string,
  finp2pContractAddress: string
) => {
  const { provider, signer } = await createJsonProvider(operatorPrivateKey, ethereumRPCUrl);
  const finp2pContract = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  const { name, version, chainId, verifyingContract } = await finp2pContract.eip712Domain();
  logger.info(`EIP712 domain: name=${name} version=${version} chainId=${chainId} verifyingContract=${verifyingContract}`);
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
  }
]);

domainParams(config.operator_pk!, config.rpc_url!, config.finp2p_contract_address!)
  .catch(console.error);
