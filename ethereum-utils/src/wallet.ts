import { BrowserProvider } from "ethers";

export class WalletManager {
  private box: HTMLElement;

  constructor(boxId: string) {
    this.box = document.getElementById(boxId)!;
    this.updateStatus();
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", () => this.updateStatus());
    }
  }

  private async updateStatus() {
    if (!window.ethereum) {
      this.box.innerHTML = "MetaMask not detected";
      return;
    }

    const provider = new BrowserProvider(window.ethereum);
    const accounts = await provider.listAccounts();

    if (accounts.length) {
      const addresses = accounts.map(a => a.address)
      const short = `${addresses[0].slice(0, 6)}...${addresses[0].slice(-4)}`;
      this.box.innerHTML = `<span>${short}</span>`;
    } else {
      this.box.innerHTML = `<button id="connectWalletBtn">Connect</button>`;
      document
        .getElementById("connectWalletBtn")!
        .addEventListener("click", () => this.connect());
    }
  }

  async connect() {
    await window.ethereum?.request({ method: "eth_requestAccounts" });
    await this.updateStatus();
  }

}
