// Loads the built package exactly as a plugin would and asserts the runtime
// surface: helpers, enums, and the whitelisting probe. No adapter involved.
const assert = require('node:assert');
const spi = require('../dist/index.js');

assert.deepStrictEqual(spi.successfulTokenOp('tx-1', 42), { status: 'success', transactionId: 'tx-1', timestamp: 42 });
assert.deepStrictEqual(spi.failedTokenOp('nope'), { status: 'failure', reason: 'nope' });

assert.strictEqual(spi.LegType.Settlement, 1);
assert.strictEqual(spi.PrimaryType.Move, 7);
assert.strictEqual(spi.Phase.Close, 1);
assert.strictEqual(spi.ReleaseType.Redeem, 1);

assert.strictEqual(spi.supportsWhitelisting({}), false);
assert.strictEqual(spi.supportsWhitelisting({ ensureWhitelisted: async () => {} }), true);

console.log('adapter-contract smoke: OK');
