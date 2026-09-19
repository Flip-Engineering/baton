// issue286-custody-predicate.test.mjs — issue #286 G-36: ONE custody predicate.
//
// `isPhysicalWorkspaceId` (shared-workspace-custody.mjs) is the one definition of the `ws-<32 hex>`
// shape, and every inline copy of that shape is a second opinion about whether a checkout is a
// shared physical workspace — which is to say, whether cleanup may destroy a checkout another
// holder is working in. coordinator.mjs shipped fifteen copies of the regex beside the imported
// helper, and coordination-store.mjs a sixteenth. A format change would have updated the helper
// and left sixteen live custody decisions enforcing the old shape.
//
// The fix is the helper plus a surface-gate row that refuses the literal outside its one
// definition, so a drifted copy fails the gate when it is written instead of failing a checkout
// months later. This file pins BOTH halves: the row refuses an inline copy, and the real tree
// carries none in the files this change owns.
//
// Suite law: hermetic (no fixture directory, no network, no clocks) · the row is exercised through
// its injectable `sources` seam, on a synthetic tree that mirrors the pinned census, so a green
// tree and a refused tree are both provable.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CUSTODY_PREDICATE_DEFINITION, CUSTODY_PREDICATE_PENDING, CUSTODY_PREDICATE_TOKEN,
  checkCustodyPredicateLiteral,
} from '../scripts/surface-gate.mjs';
import { PHYSICAL_WORKSPACE_ID, isPhysicalWorkspaceId } from '../src/shared-workspace-custody.mjs';

const LITERAL = CUSTODY_PREDICATE_TOKEN;
const COORDINATOR = new URL('../src/coordinator.mjs', import.meta.url);
const STORE = new URL('../src/coordination-store.mjs', import.meta.url);
const CUSTODY_MODULE = new URL('../src/shared-workspace-custody.mjs', import.meta.url);
const copies = (count) => `${LITERAL}\n`.repeat(count);

/** A tree that mirrors the pinned census exactly: the definition plus every pending file at its
 * pinned count. A scenario perturbs exactly ONE entry, so the finding it produces is that entry's. */
function censusTree(overrides = {}) {
  const sources = [{
    path: CUSTODY_PREDICATE_DEFINITION,
    text: `export const PHYSICAL_WORKSPACE_ID = /^${LITERAL}$/u;\n`,
  }];
  for (const [path, entry] of Object.entries(CUSTODY_PREDICATE_PENDING)) {
    sources.push({ path, text: copies(entry.occurrences) });
  }
  return sources
    .filter((source) => !Object.hasOwn(overrides, source.path))
    .concat(Object.entries(overrides).map(([path, text]) => ({ path, text })));
}

test('G36-R0: the mirrored census is green — the scenario tree itself proves nothing else fires', () => {
  assert.deepEqual(checkCustodyPredicateLiteral({ sources: censusTree() }), []);
});

test('G36-R1: the gate refuses an inline custody predicate in a governed file', () => {
  const findings = checkCustodyPredicateLiteral({
    sources: censusTree({ 'impl/src/coordinator.mjs': `const owned = /^${LITERAL}$/u.test(id);\n` }),
  });
  assert.equal(findings.length, 1, 'exactly one finding: the inline copy');
  assert.match(findings[0], /impl\/src\/coordinator\.mjs/u, 'the finding names the drifting file');
  assert.match(findings[0], /isPhysicalWorkspaceId/u, 'the finding names the remedy');
  assert.match(findings[0], /shared-workspace-custody\.mjs/u, 'the finding names the one definition');
});

test('G36-R2: the gate refuses a second copy inside the definition file', () => {
  const findings = checkCustodyPredicateLiteral({
    sources: censusTree({
      [CUSTODY_PREDICATE_DEFINITION]: `export const PHYSICAL_WORKSPACE_ID = /^${LITERAL}$/u;\nconst COPY = /^${LITERAL}$/u;\n`,
    }),
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /shared-workspace-custody\.mjs/u);
  assert.match(findings[0], /2 copies/u, 'the finding counts the copies it found');
});

test('G36-R3: a grown pinned count is refused as an added copy', () => {
  const findings = checkCustodyPredicateLiteral({
    sources: censusTree({ 'impl/src/worktree.mjs': copies(CUSTODY_PREDICATE_PENDING['impl/src/worktree.mjs'].occurrences + 1) }),
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /worktree\.mjs/u);
  assert.match(findings[0], /PENDING pins 9/u, 'the finding names the pinned count');
  assert.match(findings[0], /added/u, 'a count that grew is an added copy, not a stale exemption');
});

test('G36-R4: a swept file and a vanished file are refused as stale exemptions', () => {
  // slice 16: application.mjs's copy moved with _admitWorkspaceAttachment to
  // application-admission.mjs and imports the shared predicate, so application.mjs left the pin.
  // The swept-entry law is exercised against index.mjs, which is still pinned.
  const swept = checkCustodyPredicateLiteral({
    sources: censusTree({ 'impl/src/index.mjs': 'import { isPhysicalWorkspaceId } from \'./shared-workspace-custody.mjs\';\n' }),
  });
  assert.equal(swept.length, 1, 'the swept entry is the one finding');
  assert.match(swept[0], /index\.mjs/u);
  assert.match(swept[0], /stale/u, 'a swept file must be removed from the exemption list');

  const vanished = censusTree();
  const withoutIndex = vanished.filter((source) => source.path !== 'impl/src/index.mjs');
  const missing = checkCustodyPredicateLiteral({ sources: withoutIndex });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /index\.mjs/u);
  assert.match(missing[0], /no longer carries/u, 'a pending file absent from the scan is a stale exemption, not a silent pass');
});

test('G36-R5: the real tree is green — the coordinator and the store carry no inline copy', () => {
  assert.deepEqual(checkCustodyPredicateLiteral(), [],
    'the gate row is clean over impl/src at this commit');
  for (const file of [COORDINATOR, STORE]) {
    assert.equal(readFileSync(file, 'utf8').includes(LITERAL), false,
      `${file.pathname} carries an inline physical-workspace-id shape; import isPhysicalWorkspaceId instead`);
  }
  assert.equal(readFileSync(CUSTODY_MODULE, 'utf8').split(LITERAL).length - 1, 1,
    'the custody module is the ONE definition');
});

test('G36-R6: the predicate names exactly the shape the removed copies named', () => {
  const physical = `ws-${'a'.repeat(32)}`;
  assert.equal(isPhysicalWorkspaceId(physical), true, 'the canonical shape is the one the copies accepted');
  assert.equal(PHYSICAL_WORKSPACE_ID.test(physical), true);
  // Every neighbour shape the inline copies refused is still refused: 31/33 hex digits, uppercase
  // hex, a missing prefix, delimiters, and a non-string. `?? ''` was dropped at the call sites, so
  // `undefined` must refuse for the same reason the empty string does.
  for (const value of [
    '', undefined, null, 42, {}, [],
    `ws-${'a'.repeat(31)}`, `ws-${'a'.repeat(33)}`,
    `ws-${'A'.repeat(32)}`, `WS-${'a'.repeat(32)}`,
    `workspace-${'a'.repeat(32)}`, `ws-${'a'.repeat(32)}x`, `ws_${'a'.repeat(32)}`,
    `baton/ws-${'a'.repeat(32)}`, ` ws-${'a'.repeat(32)}`, `ws-${'a'.repeat(32)} `,
  ]) {
    assert.equal(isPhysicalWorkspaceId(value), false, `${String(value)} is not a physical workspace id`);
  }
});
