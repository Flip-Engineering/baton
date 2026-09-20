import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #496 — Decision 8: the scratchpad view bounds (view.scratchpad.bytes and
// view.scratchpad.items) are declared ONCE in limits.mjs. The enforcement site in
// runtime-observation.mjs (projectHorizonScratchpad) reads the registry rows; no
// file re-declares the literals.

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

/** Extract the body of the named exported function from the source text. */
function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) return null;
  let depth = 0; let i = src.indexOf('{', start);
  if (i === -1) return null;
  const begin = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(begin, i + 1); }
  }
  return null;
}

test('496-d8-a: the view.scratchpad.bytes registry row carries the expected value', () => {
  const row = FRAME_LIMITS['view.scratchpad.bytes'];
  assert.ok(row, 'FRAME_LIMITS[\'view.scratchpad.bytes\'] exists');
  assert.equal(row.value, 32768, 'the declared view.scratchpad.bytes bound is 32768');
  assert.equal(row.unit, 'bytes');
  assert.equal(row.class, 'view');
});

test('496-d8-b: the view.scratchpad.items registry row carries the expected value', () => {
  const row = FRAME_LIMITS['view.scratchpad.items'];
  assert.ok(row, 'FRAME_LIMITS[\'view.scratchpad.items\'] exists');
  assert.equal(row.value, 64, 'the declared view.scratchpad.items bound is 64');
  assert.equal(row.unit, 'items');
  assert.equal(row.class, 'view');
});

test('496-d8-c: projectHorizonScratchpad has no bare 32768 or 32_768 literal', () => {
  const src = sourceWithoutComments('runtime-observation.mjs');
  const body = extractFunction(src, 'projectHorizonScratchpad');
  assert.ok(body, 'projectHorizonScratchpad function found');
  const bare32768 = /(?<!\w)32[_]?768(?!\w)/g;
  const hits = [...body.matchAll(bare32768)];
  assert.equal(hits.length, 0,
    `projectHorizonScratchpad still contains bare literal 32768 (${hits.length} occurrence(s))`);
});

test('496-d8-d: projectHorizonScratchpad has no bare 64 item-cap literal', () => {
  const src = sourceWithoutComments('runtime-observation.mjs');
  const body = extractFunction(src, 'projectHorizonScratchpad');
  assert.ok(body, 'projectHorizonScratchpad function found');
  // Match a standalone numeric literal 64 (not part of a larger number or identifier).
  const bare64 = /(?<![0-9a-zA-Z_])64(?![0-9a-zA-Z_])/g;
  const hits = [...body.matchAll(bare64)];
  assert.equal(hits.length, 0,
    `projectHorizonScratchpad still contains bare literal 64 (${hits.length} occurrence(s))`);
});

test('496-d8-e: projectHorizonScratchpad reads the registry for both bounds', () => {
  const src = readFileSync(join(srcDir, 'runtime-observation.mjs'), 'utf8');
  const body = extractFunction(src, 'projectHorizonScratchpad');
  assert.ok(body, 'projectHorizonScratchpad function found');
  assert.ok(body.includes("FRAME_LIMITS['view.scratchpad.items']"),
    'function reads view.scratchpad.items from the registry');
  assert.ok(body.includes("FRAME_LIMITS['view.scratchpad.bytes']"),
    'function reads view.scratchpad.bytes from the registry');
});
