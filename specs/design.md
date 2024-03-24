# Design Approach for the FinP2P Adapter to EVM Compatible Ledgers

## FinP2P Network Basics

FinP2P networks orchestrate the execution of financial operations involving digital assets across multiple entities/ledgers. Investors agree upon and sign each financial business terms, which is then translated into an instruction set forming an execution plan, the plan is agreed by participating organizations before execution.

The execution plan is built of a set of instructions, each targeting a particular ledger operation by a designated executing party.

## The Purpose of This Adapter

- Enable FinP2P investors to access and move assets deployed on Ethereum.
- Accommodate routers within the FinP2P network that might not have direct Ethereum blockchain access.

## Design Considerations

- **Ethereum Compatibility:** The adapter design should be aligned with Ethereum transaction formats, smart contract standards (such as ERC-20 and other token standards), and the Ethereum Virtual Machine (EVM).
- **Off-chain Signing:** Users should securely sign off-chain transactions with their secp256k1 keys.
- **Proxy/Operator Contract:** An operator contract will likely be needed to check payload signatures on-chain and dispatch operations to corresponding asset contracts. This principle follows the operator contract model implemented by token standards.
- **Security:** Protecting against replay attacks and implementing robust authorization mechanisms is paramount.
- **Flexibility:** The system should be adaptable to support different types of Ethereum-based assets (e.g., fungible, non-fungible).

## FinP2P Operator/Proxy Contracts

To seamlessly integrate FinP2P instructions into the Ethereum network, the FinP2P Proxy contract has been introduced. This contract facilitates the translation of FinP2P instructions onto the chain, dynamically establishing associations between accounts and assets as transactions occur.

- **Tokens Ownership:** Tokens are "owned" by Ethereum addresses corresponding to the FinP2P users' public keys (finId). Tokens in these contracts cannot be transferred unrestrictedly to ensure regulatory compliance.
- **Payload Verification:** The proxy contract will verify FinP2P signatures from FinP2P users and ensure their validity before relaying transactions to the respective asset contracts. Leveraging elliptic curve cryptography, which is commonly used in Ethereum, streamlines the signature verification process within the contract.
- **Transaction Relaying:** The proxy contract forwards signed ethereum transactions to the appropriate asset contract to execute transfer, mint, burn, and other supported asset operations.
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

In the context of interacting with token contracts, such as ERC20, via the FinP2P operator contract, an essential step involves the establishment of an allowance. This procedure is fundamental for enabling the FinP2P operator contract, which acts as an intermediary, to manage token transactions on behalf of the investor. This facilitation can be achieved through two primary methods:

1. **Direct Authorization by the ERC20 Issuer**: In scenarios where the ERC20 token issuer integrates support for FinP2P, the FinP2P operator contract may be designated as a default allowed operator for token holders within the token's architecture. This integration permits token holders to authorize the movement of value via signed FinP2P transactions seamlessly.
2. **Investor-Initiated Allowance** Alternatively, investors have the option to proactively grant the operator contract permission to handle their tokens transfer approval by employing the ERC20 allowance mechanism. This approach requires an action from the investor to set up the allowance in favor of the FinP2P operator contract.

Addressing the system's security and the role of allowances:
- **Granting of Allowance**: The allowance is strictly granted either natively by the token issuer as part of the token's operational design or directly by the investor. Unauthorized parties cannot unilaterally establish this allowance.
- **Mandatory User Signatures**: Despite the allowance mechanism, the FinP2P operator contract is meticulously designed to require and verify user signatures for any value transfer. This step is crucial for maintaining transaction authenticity and security.
- **Online Requirement and Custody Solutions**: It is acknowledged that setting an allowance necessitates online interaction with the blockchain. To facilitate this, custody solutions can be employed to securely set the allowance while also managing offline signature requirements, thus ensuring direct access to public chains.

Crucially, within the scope of cross-chain Delivery versus Payment (DvP) transactions, the security framework of token transfers remains intact. The FinP2P platform's signature verification mechanism guarantees that all transactions are both coordinated and authorized, thereby preserving the integrity of the entire process
