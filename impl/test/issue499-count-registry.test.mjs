import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #499 — the item/row/member-count boundaries are DECLARED ONCE in the limits.mjs
// registry and read by every enforcement site. The wave member ceiling (64) is a structural
// admission bound on ONE wave payload, not a fleet size (docs/audits/2026-09-13-runtime-policy/
// admission.md §4 F7); it and its sibling counts are cataloged so no module re-declares the
// literal. This suite pins:
//   R — the registry rows exist with their declared values, units, and classes;
//   S — the application.mjs wave validators read the registry rows, with no bare member-count
//       literal left in the comment-stripped source.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

function sourceWithoutComments(filename) {
  return readFileSync(join(srcDir, filename), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('499-R: the count-family registry rows are cataloged', () => {
  const expected = [
    ['wave.members', 64, 'members', 'admission'],
    ['wave.member.scope', 64, 'paths', 'admission'],
    ['recipe.members', 8, 'member_cards', 'admission'],
    ['recipe.scope', 64, 'paths', 'admission'],
    ['deployment.routes', 64, 'routes', 'admission'],
    ['workflow.team.members', 16, 'members', 'admission'],
  ];
  for (const [lane, value, unit, klass] of expected) {
    const row = FRAME_LIMITS[lane];
    assert.ok(row, `the registry catalogs ${lane}`);
    assert.equal(row.value, value, `${lane} declares ${value}`);
    assert.equal(row.unit, unit, `${lane} is measured in ${unit}`);
    assert.equal(row.class, klass, `${lane} is a ${klass} row`);
    assert.ok(Object.isFrozen(row), `${lane} is frozen`);
  }
});

test('499-S: application.mjs wave validators read the registry, not a bare 64', () => {
  const src = sourceWithoutComments('application.mjs');
  // The two wave admission validators (`waves.attach` and `_normalizeWaveStart`) compare
  // member counts against the registry row. A bare `> 64` (or `>= 65`) members comparison in
  // the comment-stripped source means a module re-declares the cataloged bound.
  assert.ok(!/members\.length > 64\b/u.test(src),
    'application.mjs re-declares the wave.members bound as a bare literal');
  assert.ok(src.includes("FRAME_LIMITS['wave.members'].value"),
    'application.mjs reads FRAME_LIMITS[\'wave.members\'].value');
});
