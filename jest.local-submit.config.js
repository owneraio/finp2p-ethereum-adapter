module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 60000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/fireblocks-raw-signer.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};
