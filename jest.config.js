module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/utils/test-environment.ts",
  testEnvironmentOptions: {
    // adapter: {
    //   url: "http://localhost:3000",
    // },
    network: {
      //   rpcUrl: "https://ethereum-rpc-url/",
      accounts: [
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
        "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
      ]
    }
  },
  testTimeout: 120000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/**/*.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};
