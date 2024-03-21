# Design Approach for the FinP2P Adapter to EVM Compatible Ledgers

## FinP2P Network Basics

FinP2P networks orchestrate the execution of financial operations involving digital assets across multiple entities/ledgers. Investors agree upon and sign each financial operation, which is then translated into an instruction set forming an execution plan.

The execution plan is built of a set of instructions, each targeting a particular ledger operation by a designated executing party.

## The Purpose of This Adapter

- Enable FinP2P investors to access and move assets deployed on Ethereum.
- Accommodate routers within the FinP2P network that might not have direct Ethereum blockchain access.

## Design Considerations

- **Ethereum Compatibility:** The adapter design should be aligned with Ethereum transaction formats, smart contract standards (such as ERC-20 and other token standards), and the Ethereum Virtual Machine (EVM).
- **Offline Signing:** Users should securely sign transactions offline with their secp256k1 keys.
- **Proxy/Operator Contract:** An operator contract will likely be needed to check payload signatures on-chain and dispatch operations to corresponding asset contracts. This principle follows the operator contract model implemented by token standards.
- **Security:** Protecting against replay attacks and implementing robust authorization mechanisms is paramount.
- **Flexibility:** The system should be adaptable to support different types of Ethereum-based assets (e.g., fungible, non-fungible).

## FinP2P Operator/Proxy Contracts

To seamlessly integrate FinP2P instructions into the Ethereum network, the FinP2P Proxy contract has been introduced. This contract facilitates the translation of FinP2P instructions onto the chain, dynamically establishing associations between accounts and assets as transactions occur.

- **Tokens Ownership:** Tokens are "owned" by Ethereum addresses corresponding to the FinP2P users' public keys (finId). Tokens in these contracts cannot be transferred unrestrictedly to ensure regulatory compliance.
- **Payload Verification:** The proxy contract will verify signatures from FinP2P users and ensure their validity before relaying transactions to the respective asset contracts. Leveraging secp256k1 cryptography, which is commonly used in Ethereum, streamlines the signature verification process within the contract.
- **Transaction Relaying:** The proxy contract forwards valid, signed transactions to the appropriate asset contract to execute transfer, mint, burn, and other supported asset operations.
- **Security:** The proxy contract is a critical component. Access control mechanisms should prevent unauthorized calls to the proxy.
- **Upgradability (Optional):** Consider some level of upgradability in the proxy to accommodate evolving standards or security fixes.

## Authorization Contract (Optional)

- **Access Control:** This optional contract establishes rules for authorizing asset transfers or other operations initiated via the proxy contract.
- **Flexibility:** Allows for dynamic updates to authorization logic to adapt to changing business requirements or security considerations.

## Security Considerations

- **Replay Attacks:** Include mechanisms such as nonces or timestamps within the signed payloads to prevent transactions from being replayed on the Ethereum blockchain.
- **Authorization:** Meticulous access controls on the proxy contract, and any authorization contract, are essential for preventing unauthorized asset movement.
- **Smart Contract Audits:** Thoroughly audit the proxy contract and any authorization contracts to identify and eliminate potential vulnerabilities.

## Operator Allowance

As the interaction with token contracts (such as ERC20) occurs through the FinP2P operator contract rather than directly by the investor, a preliminary allowance step becomes necessary. There are a few ways to achieve this:

1. The token contract enables support for FinP2P and includes the FinP2P operator contract as a default allowed operator for token holders.
2. The investor grants approval for the transfer in advance using ERC20 allowance.

Importantly, this doesn't compromise the security scheme of token transfers. The signature verification process within FinP2P ensures that only coordinated and authorized transactions are executed, maintaining the integrity of the overall process.
