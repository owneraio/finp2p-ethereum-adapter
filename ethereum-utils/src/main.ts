import { WalletManager } from "./wallet";
import { setupComputeAddressForm } from "./computeAddress";
import { setupERC20Form } from "./erc20";

window.addEventListener("DOMContentLoaded", async () => {
  const wallet = new WalletManager("walletBox");
  setupComputeAddressForm();

  // Only initialize ERC20 after wallet available
  if (window.ethereum) {
    const provider = await wallet.connect();
    setupERC20Form(provider);
  }
});
