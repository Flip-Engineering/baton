import assert from 'node:assert/strict';
import test from 'node:test';

import { FRAME_LIMITS, FRAME_LIMITS_VERSION } from '../src/limits.mjs';

// Issue #499 cataloged the item/row/member-count family as registry rows; #598 F08 removed
// that COUNTS block — waves, recipe cards, scopes, routes, teams and constraint lists carry
// no fixed request-admission ceilings (measured resource admission governs what starts).
// This suite pins the removal and the registry's surviving shape:
//   R — no COUNTS lane is cataloged anymore;
//   S — the registry is still the one deep-frozen table, and the byte lanes that were never
//       counts stay declared.
const REMOVED_COUNT_LANES = Object.freeze([
  'wave.members', 'wave.member.scope', 'recipe.members', 'recipe.scope',
  'deployment.routes', 'workflow.team.members', 'recipe.constraints',
]);

test('499-R: the COUNTS lanes are no longer cataloged in the registry', () => {
  for (const lane of REMOVED_COUNT_LANES) {
    assert.equal(Object.hasOwn(FRAME_LIMITS, lane), false,
      `${lane} is gone — the count family carries no registry row`);
  }
});

test('499-S: the registry stays the one frozen table and keeps its byte lanes', () => {
  assert.equal(typeof FRAME_LIMITS_VERSION, 'string', 'the registry still publishes its version');
  assert.ok(Object.keys(FRAME_LIMITS).length > 0, 'the registry is non-empty');
  assert.ok(Object.isFrozen(FRAME_LIMITS), 'the registry is frozen at the top level');
  for (const lane of ['wave.member.objective', 'wave.run.spec_path', 'deployment.publish_remote']) {
    const row = FRAME_LIMITS[lane];
    assert.ok(row, `the surviving lane ${lane} stays cataloged`);
    assert.ok(Object.isFrozen(row), `${lane} is frozen`);
  }
});
