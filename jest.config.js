module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/adapter/utils/test-environment.ts",
  testTimeout: 30000,
  "roots": [
    "<rootDir>/src",
    "<rootDir>/test"
  ],
  "testMatch": [
    "<rootDir>/test/adapter/**/*.test.+(ts|tsx|js)",
  ],
  "transform": {
    "^.+\\.(ts|tsx)$": "ts-jest"
  },
};
