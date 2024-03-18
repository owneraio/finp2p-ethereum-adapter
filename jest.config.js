module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/utils/test-environment.ts",
  testEnvironmentOptions: {
    // adapter: {
      // url: "http://localhost:3000",
    // },
    // network: {
    //   rpcUrl: "https://ethereum-rpc-url/"
    // }
  },
  testTimeout: 120000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/**/*.test.+(ts|tsx|js)",
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
};
