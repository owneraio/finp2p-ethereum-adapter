module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 60000,
  forceExit: true,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/gas-prefunding.test.+(ts|tsx|js)"
  ],
  "moduleNameMapper": {
    "\\.graphql$": "<rootDir>/tests/utils/graphql-stub.js"
  },
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};
