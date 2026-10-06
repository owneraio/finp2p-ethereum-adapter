module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testTimeout: 900000,
  roots: [
    "<rootDir>/src",
    "<rootDir>/tests",
  ],
  testMatch: [
    "<rootDir>/tests/taurus-uat.test.+(ts|tsx|js)",
  ],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
};
