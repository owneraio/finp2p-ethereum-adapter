module.exports = {
  preset: "ts-jest",
  testTimeout: 600000,
  roots: ["<rootDir>/tests"],
  testMatch: ["<rootDir>/tests/nonce-recovery-sepolia.test.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
};
