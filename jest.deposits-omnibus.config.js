module.exports = {
  preset: "ts-jest",
  testEnvironment: "./tests/utils/fireblocks-omnibus-test-environment.ts",
  testTimeout: 1200000,
  roots: ["<rootDir>/tests"],
  testMatch: ["<rootDir>/tests/deposits-omnibus.test.ts"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
  },
};
