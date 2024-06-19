import process from "process";
import console from "console";
import { getAddress, JsonRpcProvider, NonceManager, Wallet, zeroPadValue } from "ethers";

const signTyped = async (ethereumRPCUrl: string, signerPrivateKey: string) => {
  if (!signerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set");
  }
  const provider = new JsonRpcProvider(ethereumRPCUrl);
  const signer = new NonceManager(new Wallet(signerPrivateKey)).connect(provider);

  const domain = {
    name: "FinP2P",
    version: "1",
    chainId: 1,
    verifyingContract: "0xb780F1284664D9A49D090f6f92a10431EBeD9eF5"
  };

  const val = zeroPadValue(getAddress("0x5FbDB2315678afecb367f032d93F642f64180aa3"), 32);
  console.log(`val: ${val}`);

  const types = {
    finId: [{
      name: "key", type: "string"
    }],
    Term: [
      { name: "assetId", type: "string" },
      { name: "assetType", type: "string" },
      { name: "amount", type: "uint256" }
    ],
    PrimarySale: [
      { name: "nonce", type: "bytes" },
      { name: "buyer", type: "finId" },
      { name: "issuer", type: "finId" },
      { name: "asset", type: "Term" },
      { name: "settlement", type: "Term" }
    ]
  };

  const message = {
    nonce: Buffer.from("712a8920ef2c1c99f8245c7f35b86c80fb6a6ebd4c12bf2f", "hex"),
    buyer: { key: "020e49498eedca38a0b7f74ae1818b21125cb6abfda83de3d31f188f8311522b12" },
    issuer: { key: "020e49498eedca38a0b7f74ae1818b21125cb6abfda83de3d31f188f8311522b12" },
    asset: {
      assetId: "bank-us:102:92c46f2c-43e1-43a5-b8f7-8deb3c23eab5",
      assetType: "finP2P",
      amount: "10",
    },
    settlement: {
      assetId: "USD",
      assetType: "fiat",
      amount: "30",
    },
  };

  const signature = await signer.signTypedData(domain, types, message);
  console.log(`signature: ${signature}`);
};

const ethereumRPCUrl = process.env.NETWORK_ADDRESS || "";
const signerPrivateKey = process.env.SIGNER || "";

signTyped(ethereumRPCUrl, signerPrivateKey)
  .then(() => {
  });