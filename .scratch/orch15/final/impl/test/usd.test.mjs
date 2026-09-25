import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addUsd,
  subtractUsdFloor,
  usdFromNanos,
  usdToNanos,
} from '../src/usd.mjs';

test('USD helpers parse exact decimal and exponent numbers into bounded nano-USD', () => {
  assert.equal(usdToNanos(1.000000001), 1_000_000_001);
  assert.equal(usdToNanos(1e-9), 1);
  assert.equal(usdToNanos(1e-10), null);
  assert.equal(usdToNanos(0.5000000000000001), null);
  assert.equal(usdToNanos(Number.EPSILON), null);
  assert.equal(usdToNanos(-1), null);
  assert.equal(usdToNanos(Infinity), null);
});

test('USD helpers add and subtract exact units without floating authority drift', () => {
  assert.equal(addUsd(0.1, 0.2), 0.3);
  assert.equal(subtractUsdFloor(1, 0.3), 0.7);
  assert.equal(subtractUsdFloor(0.3, 1), 0);
  assert.equal(addUsd(0.5000000000000001, 0.5), null);
});

test('USD projections and arithmetic fail closed when Number cannot preserve exact nano-USD', () => {
  assert.equal(usdFromNanos(Number.MAX_SAFE_INTEGER), null);
  assert.equal(addUsd(9_007_199.25474099, 0.000000001), null);
  assert.equal(usdFromNanos(-1), null);
  assert.equal(usdFromNanos(1.5), null);
});
