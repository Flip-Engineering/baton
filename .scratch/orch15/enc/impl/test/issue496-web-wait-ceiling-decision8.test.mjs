import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #496 — Decision 8: the web.wait_ceiling_ms bound (30 000 ms) is declared
// ONCE in limits.mjs as FRAME_LIMITS['web.wait_ceiling_ms'].value. Every enforcement
// site reads the registry row; no file re-declares the literal. These tests pin that
// invariant for the six sites the issue identified across three files:
// production-cli-convergence.mjs, production-mcp-convergence.mjs, and surface-cli.mjs.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

/** Read a source file and strip single-line comments so that a comment citing the
 *  numeric value (e.g. "// 30_000 is the web wait ceiling") does not false-positive. */
function sourceWithoutComments(filename) {
  return readFileSync(join(srcDir, filename), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('496-d8-a: production-cli-convergence.mjs has no bare 30_000 literal outside comments', () => {
  const src = sourceWithoutComments('production-cli-convergence.mjs');
  const bare = /(?<!\w)30_000(?!\w)(?!.*FRAME_LIMITS)/g;
  const hits = [...src.matchAll(bare)];
  assert.equal(hits.length, 0,
    `production-cli-convergence.mjs still contains bare literal 30_000 outside comments (${hits.length} occurrence(s))`);
});

test('496-d8-b: production-mcp-convergence.mjs has no bare 30_000 literal outside comments', () => {
  const src = sourceWithoutComments('production-mcp-convergence.mjs');
  const bare = /(?<!\w)30_000(?!\w)(?!.*FRAME_LIMITS)/g;
  const hits = [...src.matchAll(bare)];
  assert.equal(hits.length, 0,
    `production-mcp-convergence.mjs still contains bare literal 30_000 outside comments (${hits.length} occurrence(s))`);
});

test('496-d8-c: surface-cli.mjs has no bare 30_000 literal outside comments', () => {
  const src = sourceWithoutComments('surface-cli.mjs');
  const bare = /(?<!\w)30_000(?!\w)(?!.*FRAME_LIMITS)/g;
  const hits = [...src.matchAll(bare)];
  assert.equal(hits.length, 0,
    `surface-cli.mjs still contains bare literal 30_000 outside comments (${hits.length} occurrence(s))`);
});

test('496-d8-d: the web.wait_ceiling_ms registry row carries the expected value', () => {
  const row = FRAME_LIMITS['web.wait_ceiling_ms'];
  assert.ok(row, 'FRAME_LIMITS[\'web.wait_ceiling_ms\'] exists');
  assert.equal(row.value, 30_000, 'the declared web.wait_ceiling_ms bound is 30 000 ms');
  assert.equal(row.unit, 'ms');
  assert.equal(row.class, 'substrate');
});
