module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/utils/fireblocks-test-environment.ts",
  testEnvironmentOptions: {
    orgId: "bank-id",
    hashFunction: "keccak-256",
    vaultAccountId: "85",
    destVaultAccountId: "86",
    assetBinding: {
      tokenId: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      decimals: 6,
    },
  },
  testTimeout: 600000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/adapter.test.+(ts|tsx|js)",
    "<rootDir>/tests/fireblocks-provider.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};
