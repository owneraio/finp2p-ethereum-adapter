module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/utils/test-environment.ts",
  testTimeout: 30000,
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
