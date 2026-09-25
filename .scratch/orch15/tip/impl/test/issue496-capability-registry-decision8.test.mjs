import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #496 -- Decision 8: the capability registry's summary bound (2048 bytes)
// is declared ONCE in limits.mjs as FRAME_LIMITS['message.send.body'].value.
// The validResult helper in capability-registry.mjs reads the registry row;
// no bare 2048 or 2_048 literal survives in that file.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

/** Read a source file and strip single-line comments so that a comment citing the
 *  numeric value does not false-positive. */
function sourceWithoutComments(filename) {
  return readFileSync(join(srcDir, filename), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('496-d8-a: capability-registry.mjs has no bare 2048 or 2_048 literal outside comments', () => {
  const src = sourceWithoutComments('capability-registry.mjs');
  // Match bare 2048 or 2_048 as a standalone numeric literal (word boundary on
  // both sides), excluding lines that are part of an import or FRAME_LIMITS reference.
  const bare2048 = /(?<!\w)2[_]?048(?!\w)(?!.*FRAME_LIMITS)/g;
  const hits = [...src.matchAll(bare2048)];
  assert.equal(hits.length, 0,
    `capability-registry.mjs still contains bare literal 2048/2_048 outside comments (${hits.length} occurrence(s))`);
});

test('496-d8-b: the message.send.body registry row carries the expected value', () => {
  const row = FRAME_LIMITS['message.send.body'];
  assert.ok(row, 'FRAME_LIMITS[\'message.send.body\'] exists');
  assert.equal(row.value, 2048, 'the declared message.send.body bound is 2048 bytes');
  assert.equal(row.unit, 'bytes');
  assert.equal(row.class, 'admission');
});
