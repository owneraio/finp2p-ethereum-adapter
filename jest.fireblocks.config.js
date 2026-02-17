module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/utils/fireblocks-test-environment.ts",
  testEnvironmentOptions: {
    orgId: "bank-id",
    hashFunction: "keccak-256",
  },
  testTimeout: 300000,
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
