import { ethers } from "ethers";

export function setupComputeAddressForm() {
  const form = document.getElementById("computeForm") as HTMLFormElement;
  const result = document.getElementById("result")!;

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const finId = (document.getElementById("finId") as HTMLInputElement).value.trim();
    if (!finId) {
      result.textContent = "Please enter finId";
      return;
    }

    try {
      const address = ethers.computeAddress("0x" + finId.replace(/^0x/i, ""));
      result.textContent = address;
    } catch (err: any) {
      result.textContent = "Error: " + err.message;
    }
  });
}
