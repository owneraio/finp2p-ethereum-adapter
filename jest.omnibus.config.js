module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 30000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],
  "testMatch": [
    "<rootDir>/tests/omnibus-delegate.test.+(ts|tsx|js)"
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  }
};
