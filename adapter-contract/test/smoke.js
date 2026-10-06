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
assert.strictEqual(spi.supportsWhitelisting({ ensureWhitelisted: async () => {} }), false);
assert.strictEqual(spi.supportsWhitelisting({ isWhitelisted: async () => true, whitelist: async () => {} }), false);
assert.strictEqual(spi.supportsWhitelisting({ isWhitelisted: async () => true, whitelist: async () => {}, dewhitelist: async () => {} }), true);

assert.deepStrictEqual(spi.executedSwap('tx-1', 42, 1700000000), { status: 'executed', transactionId: 'tx-1', blockNumber: 42, timestamp: 1700000000 });
assert.deepStrictEqual(spi.failedSwap('nope'), { status: 'failure', reason: 'nope' });
assert.deepStrictEqual(spi.failedSwap('timeout', 'tx-prep'), { status: 'failure', reason: 'timeout', preparedTransactionId: 'tx-prep' });

const intent = {
  operationId: 'op-1',
  give: { token: '0xaaa', party: '0x111', amount: 1n },
  take: { token: '0xbbb', party: '0x222', amount: 10n },
  deadline: 1700000300,
  permit: { signature: '0xsig', nonce: 0n, deadline: 1700000300 },
};
const mirror = spi.mirrored(intent);
assert.deepStrictEqual(mirror.give, intent.take);
assert.deepStrictEqual(mirror.take, intent.give);
assert.strictEqual(mirror.permit, undefined); // permit authorizes its own give.party only
assert.strictEqual(mirror.operationId, intent.operationId);
const { permit, ...intentSansPermit } = intent;
assert.deepStrictEqual(spi.mirrored(mirror), intentSansPermit);

console.log('adapter-contract smoke: OK');
