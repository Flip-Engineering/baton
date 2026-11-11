// Regression for issue #25 (job 1017-002747): indexWorld scrolls the FIELD board past row 0
// before its bt(28) anchor, so goodsRow receives negative row indices. GOODS[r % GOODS.length]
// was undefined for those rows and .padEnd threw.
import test from 'node:test';
import assert from 'node:assert/strict';

// meltdown8_flaps.js -> lib/kit.js allocates one scratch canvas at module load; no other DOM is touched.
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
const { goodsRow } = await import('../scenes/meltdown8_flaps.js');

// Keep in step with GOODS in meltdown8_flaps.js.
const LABELS = ['STEEL', 'WHEAT', 'CHIPS', 'POWER', 'RENT', 'OIL', 'CORN', 'COPPER', 'FREIGHT', 'INSULIN', 'LUMBER', 'CEMENT', 'COTTON', 'NICKEL', 'SUGAR', 'GAS', 'RICE', 'TIN', 'SOY', 'COAL'];
const label = s => s.slice(0, 7).trim();
const wrap = r => ((r % LABELS.length) + LABELS.length) % LABELS.length;

test('goodsRow renders negative row indices', () => {
  for (const r of [-1, -2, -3, -19, -20, -21, -45, -1001]) {
    const s = goodsRow(r, 3, 30);
    assert.equal(s.length, 30);
    assert.equal(label(s), LABELS[wrap(r)]);
  }
});

test('goodsRow keeps its output for non-negative rows', () => {
  assert.equal(goodsRow(0, 3), 'STEEL     $114.14  -1.');
  assert.equal(goodsRow(7, 3), 'COPPER    $306.69  +0.');
  assert.equal(goodsRow(19, 3), 'COAL       $36.22  -0.');
  assert.equal(goodsRow(26, 3), 'CORN    $1,213.24  +4.');
});

test('the real indexWorld scroll shape no longer throws', () => {
  // meltdown8.js: scroll = (t - bt(28)) * 90, SPB = 0.4, FIELD.th + FIELD.gy = 50 + 5 = 55.
  const SPB = 0.4, PITCH = 55;
  let negatives = 0;
  for (let b = 24; b < 28; b += 0.05) {
    const t = b * SPB, offset = Math.floor(((t - 28 * SPB) * 90) / PITCH);
    assert.ok(offset < 0, `b=${b} should still be above the row-0 anchor`);
    negatives++;
    for (let r = 0; r < 26; r++) {
      const s = goodsRow(r + offset, Math.floor(t / 1.2 + r), 30);
      assert.equal(s.length, 30);
      assert.ok(LABELS.includes(label(s)), `b=${b} r=${r} label=${label(s)}`);
    }
  }
  assert.ok(negatives > 0);
});
