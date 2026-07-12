module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 120000,
  forceExit: true,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/plan-translator.test.+(ts|tsx|js)",
    "<rootDir>/tests/plan-v2.test.+(ts|tsx|js)",
    "<rootDir>/tests/direct-contract-escrow.test.+(ts|tsx|js)"
  ],
  "maxWorkers": 1,
  "moduleNameMapper": {
    "\\.graphql$": "<rootDir>/tests/utils/graphql-stub.js"
  },
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};
