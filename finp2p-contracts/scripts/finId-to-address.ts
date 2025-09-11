import { finIdToAddress } from "../src/utils";
import process from "process";


const convertFinIdToAddress = (finId: string) => {
    const address = finIdToAddress(finId)
    console.log(`finId: ${finId},  address: ${address}`);
}

const finId = process.env.FIN_ID;
if (!finId) {
  throw new Error("FIN_ID is not set");
}

convertFinIdToAddress(finId)
