// Issue #215 — NUL extraction from application.mjs + coordination-store.mjs.
//
// OBSERVED: the two files carry raw 0x00 bytes inside cacheKey template literals
// (application.mjs line 543, coordination-store.mjs line 2457, three bytes each).
// `grep` treats a file with a NUL byte as binary and fails silently, so every suite
// row that pins those sources carries a NUL-workaround instead of a plain read.
// The NUL separator itself is legitimate (it cannot collide with real key text);
// only its spelling in source is wrong: a raw byte instead of the `\0` escape,
// which evaluates to the identical runtime string.
//
// What this file pins, on the real source bytes:
//   a  neither file contains a raw 0x00 byte;
//   b  the cacheKey separators are still the NUL escape in source, so the runtime
//      separator value is unchanged by the extraction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = Object.freeze([
  'src/application.mjs',
  'src/coordination-store.mjs',
]);

function nulOffsets(relative) {
  const bytes = readFileSync(join(root, relative));
  const offsets = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) offsets.push(i);
  }
  return offsets;
}

for (const relative of FILES) {
  test(`215-a: ${relative} carries no raw NUL byte`, () => {
    assert.deepEqual(nulOffsets(relative), [], `${relative} must be NUL-clean so grep reads it as text`);
  });
}

test('215-b: the cacheKey separators keep the NUL escape in source', () => {
  for (const relative of FILES) {
    const text = readFileSync(join(root, relative), 'utf8');
    const line = text.split('\n').find((entry) => entry.includes('const cacheKey = `'));
    assert.ok(line, `${relative} still builds its cacheKey from a template literal`);
    assert.ok(line.includes('\\0'), `${relative} cacheKey still separates with the NUL escape`);
    assert.equal('\0', '\u0000', 'the escape spells the same separator the raw byte did');
  }
});
