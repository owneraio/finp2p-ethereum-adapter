import {runAdapterTests} from "@owneraio/adapter-tests"

// `mapping: true` is required as of adapter-tests 0.28.7 — it threads the
// LedgerAPIClient into TestDataBuilder so `buildActor` can call
// `/api/mapping/owners` to register the finId → ledgerAccountId mapping
// before the test submits any signed op. Without it the builder runs
// client-less and registrations silently no-op, so every test fails with
// `Credential not found`.
runAdapterTests({ mapping: true });
