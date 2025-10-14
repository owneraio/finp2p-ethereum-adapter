import { isAddress, Contract, parseUnits, BrowserProvider } from "ethers";

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)"
];

export function setupERC20Form(provider: BrowserProvider) {
  const form = document.getElementById("erc20Form") as HTMLFormElement;
  const result = document.getElementById("approvalResult")!;
  const infoDiv = document.getElementById("tokenInfo")!;
  const tokenInput = document.getElementById("tokenAddress") as HTMLInputElement;

  tokenInput.addEventListener("blur", async () => {
    const tokenAddr = tokenInput.value.trim();
    infoDiv.textContent = "";

    if (!isAddress(tokenAddr)) {
      infoDiv.textContent = "Invalid token address";
      return;
    }

    try {
      const contract = new Contract(tokenAddr, ERC20_ABI, provider);
      const [name, symbol] = await Promise.allSettled([
        contract.name(),
        contract.symbol()
      ]);
      const tokenName = name.status === "fulfilled" ? name.value : "Unknown";
      const tokenSymbol = symbol.status === "fulfilled" ? symbol.value : "Unknown";
      infoDiv.textContent = `Token: ${tokenName} (${tokenSymbol})`;
    } catch (err) {
      infoDiv.textContent = "Error fetching token info";
    }
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!window.ethereum) {
      result.textContent = "MetaMask not detected";
      return;
    }

    const signer = provider.getSigner();
    const tokenAddress = (document.getElementById("tokenAddress") as HTMLInputElement).value.trim();
    const spender = (document.getElementById("spenderAddress") as HTMLInputElement).value.trim();
    const amount = (document.getElementById("amount") as HTMLInputElement).value.trim();

    try {
      const token = new Contract(tokenAddress, ERC20_ABI, signer);
      const tx = await token.approve(spender, parseUnits(amount, 18));
      result.textContent = `Sent: ${tx.hash}`;
      await tx.wait();
      result.textContent = `✅ Confirmed: ${tx.hash}`;
    } catch (err: any) {
      result.textContent = `Error: ${err.message}`;
    }
  });
}
