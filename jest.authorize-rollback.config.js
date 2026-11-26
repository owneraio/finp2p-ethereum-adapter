module.exports = {
  preset: "ts-jest",
  testTimeout: 180000,
  roots: ["<rootDir>/tests"],
  testMatch: ["<rootDir>/tests/onchain-authorize-rollback.test.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
};
