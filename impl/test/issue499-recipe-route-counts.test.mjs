import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';
import { admitRecipe } from '../src/recipes.mjs';

// Issue #499 — the recipe member/scope/constraint ceilings and the deployment route-inventory
// ceiling read the registry COUNTS rows instead of re-declaring their literals. Each is a
// structural admission bound on one operation payload (docs/audits/2026-09-13-runtime-policy/
// admission.md §4 F7), not a fleet size.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

function sourceWithoutComments(filename) {
  return readFileSync(join(srcDir, filename), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('499-R1: the recipe and route count rows are cataloged', () => {
  const expected = [
    ['recipe.members', 8, 'member_cards'],
    ['recipe.scope', 64, 'paths'],
    ['recipe.constraints', 8, 'strings'],
    ['deployment.routes', 64, 'routes'],
  ];
  for (const [lane, value, unit] of expected) {
    const row = FRAME_LIMITS[lane];
    assert.ok(row, `the registry catalogs ${lane}`);
    assert.equal(row.value, value, `${lane} declares ${value}`);
    assert.equal(row.unit, unit, `${lane} is measured in ${unit}`);
  }
});

test('499-R2: recipes.mjs declares no local count literals and reads the registry rows', () => {
  const src = sourceWithoutComments('recipes.mjs');
  assert.ok(!/const MAX_MEMBERS = 8/u.test(src), 'recipes.mjs re-declares the MAX_MEMBERS literal');
  assert.ok(!/const MAX_SCOPE = 64/u.test(src), 'recipes.mjs re-declares the MAX_SCOPE literal');
  assert.ok(!/const MAX_CONSTRAINTS = 8/u.test(src), 'recipes.mjs re-declares the MAX_CONSTRAINTS literal');
  assert.ok(src.includes("FRAME_LIMITS['recipe.members'].value"), 'recipes.mjs reads recipe.members');
  assert.ok(src.includes("FRAME_LIMITS['recipe.scope'].value"), 'recipes.mjs reads recipe.scope');
  assert.ok(src.includes("FRAME_LIMITS['recipe.constraints'].value"), 'recipes.mjs reads recipe.constraints');
});

test('499-R3: application-deployment.mjs reads the route-inventory row', () => {
  const src = sourceWithoutComments('application-deployment.mjs');
  assert.ok(!/value\.length > 64\b/u.test(src),
    'application-deployment.mjs re-declares the route-inventory bound as a bare literal');
  assert.ok(src.includes("FRAME_LIMITS['deployment.routes'].value"),
    'application-deployment.mjs reads FRAME_LIMITS[\'deployment.routes\'].value');
});

function recipeWithMembers(count) {
  return {
    name: 'issue499-probe',
    version: '1',
    members: Array.from({ length: count }, (_, i) => ({
      role: `m${i + 1}`,
      exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
      scope: ['reports/**'],
      objectiveTemplate: { task: 'do the thing', constraints: [] },
    })),
  };
}

test('499-R4: a 9-member recipe refuses with the unchanged member-card text', () => {
  assert.throws(
    () => admitRecipe(recipeWithMembers(9)),
    (error) => error.message.includes('exceeds 8 member cards'),
    'the 9-member recipe must refuse on the member-card ceiling',
  );
  admitRecipe(recipeWithMembers(8)); // 8 members admits without the member-card refusal
});

test('499-R5: a member with 65 scope globs refuses with the unchanged text', () => {
  const recipe = recipeWithMembers(1);
  recipe.members[0].scope = Array.from({ length: 65 }, (_, i) => `reports/dir${i}/**`);
  assert.throws(
    () => admitRecipe(recipe),
    (error) => error.message.includes('"scope" must be a non-empty array of glob strings'),
    'the 65-glob scope must refuse on the scope ceiling',
  );
});
