// Driven by issue580-verdict-file-scope.test.mjs through a nested runner: the runner's verdict
// path must not reach a test process it spawns.
import test from 'node:test';
import assert from 'node:assert/strict';

test('the runner verdict path is not in a test process environment', () => {
  assert.equal(process.env.BATON_SUITE_VERDICT_FILE, undefined);
});
