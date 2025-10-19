import { FinP2PContract, ConsoleLogger, Logger } from "../src";
import { createProviderAndSigner, ProviderType } from "./config";

const logger: Logger = new ConsoleLogger('info')


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
