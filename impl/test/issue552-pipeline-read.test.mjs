// Issues #552 and #554 — the two gates between a published contribution and a landed commit had no
// read: which contributions wait on a review (and who can give it), which accepted rows are valid
// `swarm integrate` targets, and which `needsFromOthers` obligations a contract declared are still
// open. Finding any of that out meant dry-running integrate against candidates one at a time and
// cross-referencing every commit sha by hand.
//
// The read is the `pipeline` projection: ONE bounded row derived from the contribution rows the
// view already carries (their own `reviewState` and `integration`), so it cannot disagree with the
// contributions a reader sees, and the roster that holds the review permission. Widening the
// per-contribution row instead would blow the bridge's frame budget on the rows with the most
// items — the reason this is a purpose-built row (swarm-runtime.mjs, PIPELINE_LIST_CAP).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, swarmPipelineRows } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-pipeline-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
  });
  t.after(() => runtime.close());
  return { store, runtime };
}

const contract = (subject, needs) => ({
  subject,
  base: { observedHead: 'a'.repeat(40), rebasedOnto: 'b'.repeat(40) },
  commit: { sha: 'c'.repeat(40), branch: 'baton/lane-1' },
  items: [{
    id: 'pipeline', status: 'delivered', change: 'publish the read',
    files: ['impl/src/swarm-runtime.mjs'], test: 'node --test test/issue552-pipeline-read.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [], needsFromOthers: needs,
});

test('552a: the pipeline projection names what waits on review, who can review, and what is ready to land', async (t) => {
  const f = fixture(t);
  await f.runtime.command('swarm.create', { swarmId: 'baton', purpose: 'pipeline', idempotencyKey: 'p:create' }, owner);
  const record = (kind, payload, key) => f.store.recordSwarm(kind, { swarmId: 'baton', ...payload },
    { actor: owner.actor, key: `p:${key}` });
  record('swarm.participant_joined', { participantId: 'reviewer', role: 'Reviewer', permissions: ['read', 'review', 'contribute'] }, 'join-reviewer');
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join-lane');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contract('Waiting on review', ['reviewer: read the closed schema before this lands']),
  }, 'c1');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:2', participantId: 'lane-a', workId: 'w1',
    body: contract('Already accepted', []),
  }, 'c2');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:2', decision: 'accept', reviewerId: 'reviewer', reason: 'verified' }, 'review-c2');

  const view = await f.runtime.command('swarm.view', { swarmId: 'baton', projection: 'pipeline' }, owner);

  assert.deepEqual(view.pipeline.reviewAuthority, ['reviewer'],
    'the seats that hold the review permission are named beside the work');
  assert.deepEqual(view.pipeline.awaitingReview.map((row) => row.contributionId), ['contribution:1'],
    'an unreviewed contribution is listed as awaiting review');
  assert.equal(view.pipeline.awaitingReview[0].subject, 'Waiting on review');
  assert.deepEqual(view.pipeline.readyToLand.map((row) => row.contributionId), ['contribution:2'],
    'an accepted, unlanded contribution is listed as a landing target');
  assert.equal(view.pipeline.readyToLand[0].commit.sha, 'c'.repeat(40),
    'the landing target carries the commit the contribution named');
  assert.deepEqual(view.pipeline.openNeeds.map((row) => row.need),
    ['reviewer: read the closed schema before this lands'],
    'the declared obligation is carried as open');
  assert.deepEqual(view.pipeline.omitted, { awaitingReview: 0, readyToLand: 0, openNeeds: 0 });

  const outline = await f.runtime.command('swarm.view', { swarmId: 'baton', projection: 'outline' }, owner);
  assert.equal('pipeline' in outline, false, 'the projection is opt-in, like every other slice');
});

test('552b: the derivation caps each list, counts what it dropped, and a landing closes the obligation', () => {
  const waiting = (count) => Array.from({ length: count }, (_, index) => ({
    contributionId: `contribution:${index}`, participantId: 'lane-a', workId: 'w1',
    reviewState: 'unreviewed', subject: `subject ${index}`, commit: null, integration: null,
    body: { needsFromOthers: [`need ${index}`] },
  }));
  const capped = swarmPipelineRows(waiting(25), [{ participantId: 'r', permissions: ['review'] }]);
  assert.equal(capped.awaitingReview.length, capped.caps.list, 'the list stops at the cap');
  assert.equal(capped.omitted.awaitingReview, 25 - capped.caps.list, 'and counts what it dropped');
  assert.equal(capped.openNeeds.length, capped.caps.list);
  assert.equal(capped.omitted.openNeeds, 25 - capped.caps.list);

  const landed = [{
    contributionId: 'contribution:9', participantId: 'lane-a', workId: 'w1', reviewState: 'accepted',
    subject: 'Landed', commit: { sha: 'c'.repeat(40), branch: 'baton/lane-1' },
    integration: { squashSha: 'd'.repeat(40) }, body: { needsFromOthers: ['need before landing'] },
  }];
  const closed = swarmPipelineRows(landed, []);
  assert.deepEqual(closed.readyToLand, [], 'a landed row is no longer a landing target');
  assert.deepEqual(closed.openNeeds, [], 'the landing receipt closes the obligation');

  const long = swarmPipelineRows([{
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1', reviewState: 'unreviewed',
    subject: 'x'.repeat(400), commit: null, integration: null, body: null,
  }], []);
  assert.ok(Buffer.byteLength(long.awaitingReview[0].subject) <= long.caps.textBytes,
    'a long subject is capped to the row budget');
  assert.deepEqual(long.openNeeds, [], 'a body with no contract declares no obligation');
});
