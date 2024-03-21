# FinP2P Ethereum Reference Adapter

The FinP2P Ethereum adapter is a reference implementation of a FinP2P adapter to EVM compatiable ledgers. It allows to execute FinP2P instructions to trade tokenized assets on the Ethereum network.
The Adapter communicated with a FinP2P proxy contract on Ethereum network which is responsible to verify and execute the asset movements on chain.

### Getting started


#### Install dependencies

`npm install`

#### Compile contracts and generate typescript bindings

`npm run contracts-compile`

#### Run contracts tests

`npm run contracts-test`

#### Run adapter tests

By default, test environment starts Hardhat node within test-containers and adapter server and run tests against it.

`npm run adapter-test`

#### External ethereum network

To run tests against external network, set `network.rpcUrl` parameter in `jest.config.js` to the desired network url.


© 2019-2022 XCap Ecosystem Ltd trading as Ownera. All rights reserved. 

To run tests against external adapter, set `adapter.url` parameter in `jest.config.js` to the desired adapter url.

#### Run adapter


