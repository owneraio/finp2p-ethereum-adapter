module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/utils/test-environment.ts",
  testEnvironmentOptions: {
    orgId: "bank-id",
    hashFunction: "sha3-256",
    // adapter: {
    //   url: "http://localhost:3000",
    // },
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
