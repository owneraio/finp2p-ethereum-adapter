Nodejs ledger adapter skeleton

## Getting started

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

To run tests against external adapter, set `adapter.url` parameter in `jest.config.js` to the desired adapter url.

#### Run adapter


