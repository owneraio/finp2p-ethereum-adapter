import { FinP2PContract, createProviderAndSigner, ProviderType } from "../src";
import winston, { format, transports } from "winston";

const logger = winston.createLogger({
  level: "info", transports: [new transports.Console()], format: format.json()
});

const domainParams = async (providerType: ProviderType, finp2pContractAddress: string) => {
  const { provider, signer } = await createProviderAndSigner(providerType, logger);
  const finp2pContract = new FinP2PContract(provider, signer, finp2pContractAddress, logger);
  const { name, version, chainId, verifyingContract } = await finp2pContract.eip712Domain();
  logger.info(`EIP712 domain: name=${name} version=${version} chainId=${chainId} verifyingContract=${verifyingContract}`);
};

const providerType = (process.env.PROVIDER_TYPE || "local") as ProviderType;
const finp2pContractAddress = process.env.FINP2P_CONTRACT_ADDRESS;
if (!finp2pContractAddress) {
  throw new Error("FINP2P_CONTRACT_ADDRESS is not set");
}


domainParams(providerType, finp2pContractAddress)
  .catch((err) => {
    logger.error("Error running domainParams:", err);
    process.exit(1);
  });
