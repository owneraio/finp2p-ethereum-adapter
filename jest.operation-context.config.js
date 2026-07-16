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
    "<rootDir>/tests/operation-context.test.+(ts|tsx|js)",
    "<rootDir>/tests/token-standard-registry.test.+(ts|tsx|js)",
    "<rootDir>/tests/ethereum-standards.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};
