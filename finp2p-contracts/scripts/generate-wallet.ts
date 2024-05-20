import console from "console";
import { privateKeyToFinId } from "../test/utils";
import { createAccount } from "../src/contracts/utils";

const generateWallet = async () => {
  const account = createAccount();
  console.log("New wallet:");
  console.log("\tprivate key:\t", account.privateKey);
  console.log("\taddress:\t", account.address);
  console.log("\tfinId:\t", privateKeyToFinId(account.privateKey));
};

generateWallet()
  .then(() => {
  });