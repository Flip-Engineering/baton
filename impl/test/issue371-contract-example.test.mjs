// Issue #371: the contribution report example a brief prints.
//
// The strict validator this file once pinned is gone (#598: no mechanism without an observed
// failure) — the runtime records what a seat reports. What remains to pin is the tolerant
// behavior every surface depends on:
//
//   example   the brief's example is the documented shape with a commit, and the read-only
//             variant swaps commit for null
//   claim     an object body claiming the report shape (any of the shape's own keys) is a
//             contribution; a bare string is a note; the legacy hand-off is neither
//   render    the view projection reads subject, commit, item statuses and the verification
//             counts defensively from whatever the body carries
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRIBUTION_CONTRACT_EXAMPLE, contributionContractExample, isContributionContractBody,
  projectContributionContract,
} from '../src/contribution-contract.mjs';

test('#371: the printed example carries the documented shape, and read_only swaps commit for null', () => {
  assert.equal(typeof CONTRIBUTION_CONTRACT_EXAMPLE.subject, 'string');
  assert.ok(CONTRIBUTION_CONTRACT_EXAMPLE.commit, 'the contributing example names a commit');
  assert.equal(CONTRIBUTION_CONTRACT_EXAMPLE.commit.sha.length, 40);
  const readOnly = contributionContractExample({ readOnly: true });
  assert.equal(readOnly.commit, null);
  assert.equal(readOnly.subject, CONTRIBUTION_CONTRACT_EXAMPLE.subject);
});

test('#371: a body claiming any of the report shape keys is a contribution; a string is not', () => {
  assert.equal(isContributionContractBody({ subject: 'x' }), true);
  assert.equal(isContributionContractBody({ items: [] }), true);
  assert.equal(isContributionContractBody({ verification: { targeted: true } }), true);
  assert.equal(isContributionContractBody('a bare finding'), false);
  assert.equal(isContributionContractBody({ contract: 'x', carriedForward: [] }), false,
    'the pre-#310 minimal hand-off is ordinary evidence, never a contract claimant');
  assert.equal(isContributionContractBody(null), false);
});

test('#371: the view projection reads the report defensively', () => {
  const row = projectContributionContract({
    subject: 'Work',
    commit: { sha: 'a'.repeat(40), branch: 'baton/lane-1' },
    items: [{ id: 'one', status: 'delivered' }, { id: 'two' }],
    verification: { targeted: true, gates: ['g'], fullSuite: false, environmentRed: [] },
    carriedForward: ['c'],
    needsFromOthers: [],
    unknownField: { anything: true },
  });
  assert.equal(row.subject, 'Work');
  assert.equal(row.commit.sha, 'a'.repeat(40));
  assert.deepEqual(row.items.map((item) => item.id), ['one', 'two']);
  assert.deepEqual(row.verification, { targeted: true, gates: 1, fullSuite: false, environmentRed: 0 });
  assert.equal(row.carriedForward, 1);
  assert.equal(projectContributionContract('not a report'), null);
});
