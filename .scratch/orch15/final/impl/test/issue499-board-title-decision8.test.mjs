import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #499 — Decision 8: the board.title bound (160 bytes) is declared ONCE in
// limits.mjs as FRAME_LIMITS['board.title'].value. Every enforcement site reads the
// registry row; no file re-declares the literal. These tests pin that invariant for
// the three sites the issue identified: two runtime checks in mcp-northbound.mjs and
// one schema declaration in application-semantics.mjs.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

/** Read a source file and strip single-line comments so that a comment citing the
 *  numeric value (e.g. "// 160 is the board.title bound") does not false-positive. */
function sourceWithoutComments(filename) {
  return readFileSync(join(srcDir, filename), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('499-d8-a: mcp-northbound.mjs has no bare 160 literal outside comments', () => {
  const src = sourceWithoutComments('mcp-northbound.mjs');
  // Match a bare 160 that is NOT part of a FRAME_LIMITS reference — a standalone
  // numeric literal 160 as a word boundary (not embedded in 1600, 2160, etc.).
  const bare160 = /(?<!\w)160(?!\w)(?!.*FRAME_LIMITS)/g;
  const hits = [...src.matchAll(bare160)];
  assert.equal(hits.length, 0,
    `mcp-northbound.mjs still contains bare literal 160 outside comments (${hits.length} occurrence(s))`);
});

test('499-d8-b: application-semantics.mjs has no bare 160 literal outside comments', () => {
  const src = sourceWithoutComments('application-semantics.mjs');
  const bare160 = /(?<!\w)160(?!\w)(?!.*FRAME_LIMITS)/g;
  const hits = [...src.matchAll(bare160)];
  assert.equal(hits.length, 0,
    `application-semantics.mjs still contains bare literal 160 outside comments (${hits.length} occurrence(s))`);
});

test('499-d8-c: the board.title registry row carries the expected value', () => {
  const row = FRAME_LIMITS['board.title'];
  assert.ok(row, 'FRAME_LIMITS[\'board.title\'] exists');
  assert.equal(row.value, 160, 'the declared board.title bound is 160 bytes');
  assert.equal(row.unit, 'bytes');
  assert.equal(row.class, 'admission');
});
