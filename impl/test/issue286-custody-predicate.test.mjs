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

import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTODY_PREDICATE_DEFINITION, CUSTODY_PREDICATE_TOKEN,
  checkCustodyPredicateLiteral,
} from '../scripts/surface-gate.mjs';
import { PHYSICAL_WORKSPACE_ID, isPhysicalWorkspaceId } from '../src/shared-workspace-custody.mjs';

const COORDINATOR = new URL('../src/coordinator.mjs', import.meta.url);
const STORE = new URL('../src/coordination-store.mjs', import.meta.url);
const CUSTODY_MODULE = new URL('../src/shared-workspace-custody.mjs', import.meta.url);
const LITERAL = CUSTODY_PREDICATE_TOKEN;
const copies = (count) => `${LITERAL}\n`.repeat(count);

/** A synthetic tree: the one definition plus governed files that import the helper (zero inline
 * copies — issue #582 removed the PENDING count-pin exemptions). A scenario perturbs exactly one
 * entry, so the finding it produces is that entry's. */
function censusTree(overrides = {}) {
  const sources = [{
    path: CUSTODY_PREDICATE_DEFINITION,
    text: `export const PHYSICAL_WORKSPACE_ID = /^${LITERAL}$/u;\n`,
  }];
  for (const path of ['impl/src/application.mjs', 'impl/src/index.mjs', 'impl/src/swarm-state.mjs', 'impl/src/worktree.mjs']) {
    sources.push({ path, text: `import { isPhysicalWorkspaceId } from './shared-workspace-custody.mjs';\n` });
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
