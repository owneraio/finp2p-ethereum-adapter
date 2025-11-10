#!/usr/bin/env node
import { createAccount, privateKeyToFinId } from "../src";


const generateWallet = async () => {
  const account = createAccount();
  console.log("New wallet:");
  console.log(`\tprivate key:\t${account.privateKey}\t`);
  console.log(`\taddress:\t${account.address}`);
  console.log(`\tfinId:\t\t${privateKeyToFinId(account.privateKey)}`);
};

generateWallet()
  .then(() => {
  });
