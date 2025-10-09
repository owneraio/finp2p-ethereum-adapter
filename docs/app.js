// ---------------- Wallet connect ----------------
const walletBox = document.getElementById("walletBox");

async function updateWalletStatus() {
  if (!window.ethereum) {
    walletBox.innerHTML = "MetaMask not detected";
    return;
  }

  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const accounts = await provider.listAccounts();

  if (accounts.length > 0) {
    const shortAddr = accounts[0].slice(0, 6) + "..." + accounts[0].slice(-4);
    walletBox.innerHTML = `<span>${shortAddr}</span>`;
  } else {
    walletBox.innerHTML = `<button id="connectWalletBtn">Connect</button>`;
    document.getElementById("connectWalletBtn").addEventListener("click", connectWallet);
  }
}

async function connectWallet() {
  try {
    await ethereum.request({ method: "eth_requestAccounts" });
    updateWalletStatus();
  } catch (err) {
    console.error(err);
  }
}

updateWalletStatus();

if (window.ethereum) {
  window.ethereum.on("accountsChanged", updateWalletStatus);
}

// ---------------- Compute Address ----------------
const computeForm = document.getElementById("computeForm");
const result = document.getElementById("result");

computeForm.addEventListener("submit", function(ev) {
  ev.preventDefault();
  const finId = document.getElementById("finId").value.trim();
  if (!finId) {
    result.textContent = "Please enter finId";
    return;
  }
  try {
    const addr = ethers.utils.computeAddress("0x" + finId.replace(/^0x/i, ""));
    result.textContent = addr;
  } catch (err) {
    result.textContent = "Error: " + (err.message || err);
  }
});

// ---------------- ERC20 Approve ----------------
const erc20Form = document.getElementById("erc20Form");
const approvalResult = document.getElementById("approvalResult");
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

erc20Form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!window.ethereum) {
    approvalResult.textContent = "MetaMask not detected!";
    return;
  }

  try {
    await ethereum.request({ method: "eth_requestAccounts" });
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const signer = provider.getSigner();

    const tokenAddress = document.getElementById("tokenAddress").value.trim();
    const spenderAddress = document.getElementById("spenderAddress").value.trim();
    const amount = document.getElementById("amount").value.trim();

    if (!tokenAddress || !spenderAddress || !amount) {
      approvalResult.textContent = "All fields are required";
      return;
    }

    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const value = ethers.utils.parseUnits(amount, 18);

    const tx = await erc20.approve(spenderAddress, value);
    approvalResult.textContent = `Transaction sent: ${tx.hash}`;
    await tx.wait();
    approvalResult.textContent = `✅ Approval confirmed: ${tx.hash}`;

  } catch (err) {
    approvalResult.textContent = "Error: " + (err.message || err);
  }
});

const tokenAddressInput = document.getElementById("tokenAddress");
const tokenInfoDiv = document.getElementById("tokenInfo");

tokenAddressInput.addEventListener("blur", async () => { // or 'input' for live
  const tokenAddress = tokenAddressInput.value.trim();
  tokenInfoDiv.textContent = ""; // clear previous info

  if (!ethers.utils.isAddress(tokenAddress)) {
    tokenInfoDiv.textContent = "Invalid token address";
    return;
  }

  if (!window.ethereum) {
    tokenInfoDiv.textContent = "MetaMask not detected";
    return;
  }

  console.log(`Fetching token info for ${tokenAddress}...`);
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    // const [name, symbol] = await Promise.all([erc20.name(), erc20.symbol()]);
    // tokenInfoDiv.textContent = `Token: ${name} (${symbol})`;
    const decimals = await erc20.decimals();
    console.log(decimals);
  } catch (err) {
    tokenInfoDiv.textContent = "Error fetching token info";
    console.error(err);
  }
});
