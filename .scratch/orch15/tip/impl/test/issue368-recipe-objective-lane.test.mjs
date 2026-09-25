// GitHub issue #368: the recipe renderer refused rendered objectives over 4096 bytes
// (recipe_oversize) while the wave machinery admits the 1 MiB wave.member.objective lane.
// The renderer must read the registry row and behave exactly like wave-driver.mjs's OQ5 fold:
// pass-through with a spill-aware advisory above the lane, never a refusal.
//
// Rows: (a) a 5 KB rendered objective is admitted whole with no advisory; (b) an objective
// just above the lane value draws the same advisory shape wave-driver draws and is not
// refused; (c) the source pin — recipes.mjs holds no byte literal for the objective and
// reads the registry row.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { FRAME_LIMITS } from '../src/limits.mjs';
import { renderMember, renderObjective } from '../src/recipes.mjs';

const LANE = 'wave.member.objective';
const laneValue = FRAME_LIMITS[LANE].value;

function memberFor(task) {
  return {
    role: 'alpha',
    exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['reports/**'],
    objectiveTemplate: { task, constraints: [] },
  };
}

test('368-a: a 5 KB rendered objective is admitted whole — no advisory, no refusal', () => {
  const advisories = [];
  const task = 'x'.repeat(5_000);
  const objective = renderObjective({
    task, constraints: [], salt: 's', role: 'alpha', onAdvisory: (entry) => advisories.push(entry),
  });
  assert.ok(objective.includes(task), 'the full task ships in the rendered objective');
  assert.ok(objective.endsWith('[attempt: s alpha]'), 'the salt line still closes the objective');
  assert.deepEqual(advisories, [], 'below the lane value there is no advisory');
});

test('368-b: an objective just above the lane value draws the wave-driver advisory shape and passes through', () => {
  const advisories = [];
  const task = 'y'.repeat(laneValue + 1);
  const objective = renderObjective({
    task, constraints: [], salt: 's', role: 'beta', onAdvisory: (entry) => advisories.push(entry),
  });
  const bytes = Buffer.byteLength(objective);
  assert.ok(bytes > laneValue, 'precondition: the rendered objective exceeds the lane value');
  assert.ok(objective.includes(task), 'the oversize objective still passes through whole');
  assert.deepEqual(
    advisories,
    [{ role: 'beta', bytes, limit: laneValue, spill: true, lane: LANE }],
    'the advisory is the wave-driver OQ5 shape over the registry value it read',
  );
  // The member render forwards the same advisory channel.
  const memberAdvisories = [];
  const rendered = renderMember(memberFor(task), '', 'salt-m', (entry) => memberAdvisories.push(entry));
  assert.equal(rendered.objective, renderObjective({ task, constraints: [], salt: 'salt-m', role: 'alpha' }));
  assert.equal(memberAdvisories.length, 1, 'renderMember forwards the oversize advisory');
  assert.deepEqual(
    memberAdvisories[0],
    {
      role: 'alpha',
      bytes: Buffer.byteLength(rendered.objective),
      limit: laneValue,
      spill: true,
      lane: LANE,
    },
  );
});

test('368-c: recipes.mjs holds no byte literal for the objective and reads the registry row', () => {
  const source = readFileSync(new URL('../src/recipes.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('RENDERED_OBJECTIVE_MAX_BYTES'), 'the re-declared literal is gone');
  assert.ok(
    source.match(/FRAME_LIMITS\['wave\.member\.objective'\]/u),
    'the renderer reads the registry lane value',
  );
  assert.ok(source.match(/from '\.\/limits\.mjs'/u), 'the registry is imported, not re-spelled');
  const literalLines = source.split('\n').filter((line) => /4096|4_096/u.test(line));
  assert.deepEqual(literalLines, [], 'no objective byte literal remains in recipes.mjs');
});
