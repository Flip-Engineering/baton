// Issue #311: the situation projection — the brief renders it and `swarm.view` serves it.
//
// The issue's first requirement: a DEPLOYMENT-level situation projection — the sibling
// participants across the repository's swarms with their scopes (the #301 rows), the
// contributions and contracts they published (subject + a reference, never the body), the
// commits landed on the target since the base, and the predecessor's last checkpoint when the
// viewing seat is a successor. #318 landed the brief half (per-swarm); this file pins the rest:
//   311-a  `situation` is a declared projection in the ONE table every surface derives from
//   311-b  the full record carries `situation`; the `situation` slice serves it with the frame
//   311-c  peers: this swarm's can-act seats with their scopes, the viewer excluded
//   311-d  siblings: the can-act seats of the repository's OTHER swarms, named with their swarm
//          and scope; a seat that left is absent
//   311-e  published: the sibling swarms' published contributions and contracts — subject +
//          reference (contributionId + seq), never the body
//   311-f  commits landed on the target since the swarm's base; no git authority says so; no
//          base omits the block
//   311-g  a successor's situation names its predecessor — last checkpoint and published
//          contracts; a non-successor and a root caller read null
//   311-h  the recruit brief renders the same sibling/published blocks (only when non-empty,
//          so a one-swarm brief composes byte-identically)
//   311-i  slicer parity: the slice is exactly projectSwarmView(full, 'situation'); no other
//          slice carries the field
// Fixture pattern from swarm-view-slices.test.mjs (a real CoordinationStore under a controllable
// coordinator), extended to two swarms in one deployment and a stubbed situationGit authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SWARM_COMMAND_ROWS, SWARM_VIEW_PROJECTIONS, SWARM_VIEW_PROJECTION_NAMES,
  projectSwarmView, validateSwarmCommand } from '../src/swarm-contract.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const workerPrincipal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const BASE = 'a'.repeat(40);
const SHA = 'b'.repeat(40);
const LANDED = [
  { sha: 'c'.repeat(40), subject: 'landed change one' },
  { sha: 'd'.repeat(40), subject: 'landed change two' },
];

const contractBody = (subject, carriedForward = []) => ({
  subject,
  base: { observedHead: BASE, rebasedOnto: BASE },
  // commit null: the light fixture's seats hold no checkout, so a named commit could not
  // resolve on a lane branch (the admission's sha-resolves rule) — the read-only contract
  // spelling is the one this fixture can honestly publish.
  commit: null,
  items: [{ id: 'i-1', status: 'delivered', change: 'the change', files: ['impl/src/x.mjs'],
    test: 'node --test impl/test/x.test.mjs', evidence: 'green' }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward,
  needsFromOthers: [],
});

function fixture(t, { git = 'full' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue311-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    guideParticipant: async (workerId) => { workers.find((row) => row.id === workerId).paused = false; return { ok: true }; },
    captureContribution: async (workerId, { contributionId }) => ({ contributionId, workerId, sha: SHA, ref: `refs/baton/checkpoints/${SHA}` }),
    checkContribution: async () => ({ passed: true, sha: SHA, attempt: { cleanup: { state: 'closed' } } }),
  };
  const situationGit = git === 'full' ? { head: () => BASE, commitsSince: () => LANDED.map((row) => ({ ...row })) }
    : git === 'head-only' ? { head: () => BASE }
      : null;
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
    situationGit,
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...args, ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }) }, caller);
  const workerOf = (swarmId, participantId) => workers.find((row) => row.runId === store.swarm(swarmId).participants[participantId].runId);
  const asParticipant = (swarmId, participantId) => workerPrincipal(workerOf(swarmId, participantId).id);
  return { store, runtime, workers, call, workerOf, asParticipant };
}

/** A deployment with two swarms: s-one (lead + builder, scopes under impl/src) and s-two
 * (other, scope impl/test), with s-two's seat having published one contract contribution and
 * one plain finding. */
async function built(t) {
  const f = fixture(t);
  await f.call('create', { swarmId: 's-one', purpose: 'First swarm' });
  await f.call('recruit', { swarmId: 's-one', participantId: 'lead', objective: 'Coordinate', options: { scope: ['impl/src'] } });
  await f.call('recruit', { swarmId: 's-one', participantId: 'builder', objective: 'Build', options: { scope: ['impl/src/impl.mjs'] } });
  await f.call('create', { swarmId: 's-two', purpose: 'Second swarm' });
  await f.call('recruit', { swarmId: 's-two', participantId: 'other', objective: 'Sibling lane', options: { scope: ['impl/test'] } });
  await f.call('update', { swarmId: 's-two', event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-other', participantId: 'other', body: contractBody('Sibling lane contract', ['keep the scope guard']) } });
  await f.call('update', { swarmId: 's-two', event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-note', participantId: 'other', body: 'a plain finding' } });
  return f;
}

test('311-a: situation is a declared projection the surfaces derive from the ONE table', () => {
  assert.ok(SWARM_VIEW_PROJECTION_NAMES.includes('situation'), 'the closed projection set carries situation');
  assert.deepEqual([...SWARM_VIEW_PROJECTIONS.situation.rows], ['situation']);
  assert.equal(SWARM_VIEW_PROJECTIONS.situation.participant, null);
  assert.equal(validateSwarmCommand('swarm.view', { swarmId: 's', projection: 'situation' }), true,
    'the argument validator admits the name');
  const row = SWARM_COMMAND_ROWS.find((entry) => entry.command === 'swarm.view');
  assert.ok(row.properties.projection.enum.includes('situation'), 'the MCP/bridge schema teaches the name');
});

test('311-b: the full record carries the situation; the slice serves it with the frame', async (t) => {
  const f = await built(t);
  const full = await f.call('view', { swarmId: 's-one' });
  assert.ok(full.situation !== null && typeof full.situation === 'object', 'the whole record carries the situation');
  const slice = await f.call('view', { swarmId: 's-one', projection: 'situation' });
  assert.equal(slice.projection, 'situation');
  assert.deepEqual(slice.situation, full.situation, 'the slice serves the same block the full record carries');
  for (const frame of ['swarmId', 'status', 'caller', 'availableActions', 'updates', 'cursor']) {
    assert.ok(frame in slice, `${frame} rides the slice's frame`);
  }
  assert.equal('participants' in slice, false, 'the slice drops the roster');
  assert.equal('contributions' in slice, false, 'the slice drops the contributions family');
});

test('311-c: peers are this swarm\'s can-act seats with their scopes, the viewer excluded', async (t) => {
  const f = await built(t);
  const asOwner = (await f.call('view', { swarmId: 's-one' })).situation;
  assert.deepEqual(asOwner.peers.map((row) => row.participantId), ['builder', 'lead'],
    'a caller with no seat reads every can-act seat, canonically ordered');
  const builderScope = asOwner.peers.find((row) => row.participantId === 'builder');
  assert.deepEqual(builderScope.scope, ['impl/src/impl.mjs'], 'the peer row carries the scope it was recruited with');
  const asLead = (await f.call('view', { swarmId: 's-one' }, f.asParticipant('s-one', 'lead'))).situation;
  assert.deepEqual(asLead.peers.map((row) => row.participantId), ['builder'],
    'the viewing seat is not its own peer');
});

test('311-d: siblings are the can-act seats of the repository\'s other swarms', async (t) => {
  const f = await built(t);
  const situation = (await f.call('view', { swarmId: 's-one' })).situation;
  assert.deepEqual(situation.siblings, [{ swarmId: 's-two', participantId: 'other', scope: ['impl/test'] }],
    'the sibling row names the seat, its swarm and its scope');
  await f.call('update', { swarmId: 's-two', event: 'swarm.participant_left', payload: { participantId: 'other', reason: 'turn complete' } });
  const after = (await f.call('view', { swarmId: 's-one' })).situation;
  assert.deepEqual(after.siblings, [], 'a seat that left is not a sibling any more');
});

test('311-e: published rows are subject + a reference, never the body', async (t) => {
  const f = await built(t);
  const situation = (await f.call('view', { swarmId: 's-one' })).situation;
  const contractRow = situation.published.find((row) => row.contributionId === 'c-other');
  assert.ok(contractRow, 'the sibling swarm\'s contract contribution is published into this swarm\'s situation');
  assert.equal(contractRow.swarmId, 's-two');
  assert.equal(contractRow.participantId, 'other');
  assert.equal(contractRow.subject, 'Sibling lane contract');
  assert.equal(contractRow.contract, true, 'a contract-claiming body says so');
  assert.ok(Number.isSafeInteger(contractRow.seq), 'the reference carries the ledger seq');
  const keys = Object.keys(contractRow).sort();
  assert.deepEqual(keys, ['contract', 'contributionId', 'participantId', 'seq', 'subject', 'swarmId'],
    'subject + a reference — never the body, the items, or the contract text');
  const note = situation.published.find((row) => row.contributionId === 'c-note');
  assert.ok(note, 'a plain finding publishes too');
  assert.equal(note.subject, null, 'a string body has no subject — absence, never a guess');
  assert.equal(note.contract, false);
  assert.equal(situation.published.some((row) => row.swarmId === 's-one'), false,
    'the swarm\'s own publications already ride the contributions family — they are not repeated here');
});

test('311-f: commits landed since the base ride the situation; unavailable git and absent base say so', async (t) => {
  const f = await built(t);
  const situation = (await f.call('view', { swarmId: 's-one' })).situation;
  assert.equal(situation.baseCommit, BASE, 'the base the swarm recorded at create');
  assert.deepEqual(situation.commits, LANDED, 'the commits the target gained since the base, derived from git at read time');
  assert.equal(situation.commitsOmitted, 0);

  const noAuthority = fixture(t, { git: 'head-only' });
  await noAuthority.call('create', { swarmId: 's-one', purpose: 'No log authority' });
  const withoutLog = (await noAuthority.call('view', { swarmId: 's-one' })).situation;
  assert.equal(withoutLog.baseCommit, BASE);
  assert.equal(withoutLog.commits, null, 'a base without a log authority says so instead of inventing a line');

  const noGit = fixture(t, { git: null });
  await noGit.call('create', { swarmId: 's-one', purpose: 'No git at all' });
  const withoutGit = (await noGit.call('view', { swarmId: 's-one' })).situation;
  assert.equal(withoutGit.baseCommit, null, 'no recorded base');
  assert.equal(withoutGit.commits, null);
});

test('311-g: a successor\'s situation names its predecessor — last checkpoint and published contracts', async (t) => {
  const f = await built(t);
  await f.call('update', { swarmId: 's-one', event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-lead', participantId: 'lead', body: contractBody('Lead contract', ['carry the guard forward']) } });
  await f.call('capture', { swarmId: 's-one', participantId: 'lead', contributionId: 'c-lead' });
  await f.call('recruit', { swarmId: 's-one', participantId: 'successor', objective: 'Continue the lane', resumeFrom: 'lead' });

  const asSuccessor = (await f.call('view', { swarmId: 's-one' }, f.asParticipant('s-one', 'successor'))).situation;
  assert.ok(asSuccessor.predecessor !== null, 'the viewing seat is a successor — its predecessor is named');
  assert.equal(asSuccessor.predecessor.participantId, 'lead');
  assert.equal(asSuccessor.predecessor.lastCheckpoint.sha, SHA,
    'the predecessor\'s last checkpoint is the newest captured revision');
  assert.equal(typeof asSuccessor.predecessor.lastCheckpoint.ref, 'string');
  assert.ok(Number.isSafeInteger(asSuccessor.predecessor.lastCheckpoint.seq));
  assert.deepEqual(asSuccessor.predecessor.contracts.map((row) => row.contributionId), ['c-lead'],
    'the predecessor\'s published contracts ride the block');
  assert.deepEqual(asSuccessor.predecessor.contracts[0].carriedForward, ['carry the guard forward'],
    'the hand-off items are cited verbatim');

  const asLead = (await f.call('view', { swarmId: 's-one' }, f.asParticipant('s-one', 'lead'))).situation;
  assert.equal(asLead.predecessor, null, 'a seat that resumed from nobody has no predecessor block');
  const asOwner = (await f.call('view', { swarmId: 's-one' })).situation;
  assert.equal(asOwner.predecessor, null, 'a caller with no seat has no predecessor block');
});

test('311-h: the recruit brief renders the sibling and published blocks when other swarms are at work', async (t) => {
  const f = await built(t);
  await f.call('recruit', { swarmId: 's-one', participantId: 'late', objective: 'Late seat', options: { scope: ['docs'] } });
  const brief = f.store.swarm('s-one').participants.late.brief;
  assert.equal(typeof brief, 'string', 'the composed brief rides the join');
  assert.ok(brief.includes('other') && brief.includes('s-two'),
    'the brief names the sibling seat and the swarm it sits in');
  assert.ok(brief.includes('c-other') && brief.includes('Sibling lane contract'),
    'the brief cites what the sibling swarm published — subject + reference');
  assert.ok(!brief.includes('a plain finding') || brief.includes('c-note'),
    'a plain finding is cited by reference, never by body');

  const solo = fixture(t);
  await solo.call('create', { swarmId: 's-one', purpose: 'Alone' });
  await solo.call('recruit', { swarmId: 's-one', participantId: 'first', objective: 'Only seat' });
  const soloBrief = solo.store.swarm('s-one').participants.first.brief;
  assert.ok(!soloBrief.includes('other swarms'), 'a one-swarm deployment renders no sibling block — briefs compose byte-identically');
});

test('311-i: the slicer is the one definition of the slice; no other projection carries the situation', async (t) => {
  const f = await built(t);
  const full = await f.call('view', { swarmId: 's-one' });
  for (const projection of SWARM_VIEW_PROJECTION_NAMES) {
    const view = await f.call('view', { swarmId: 's-one', projection });
    assert.deepEqual(view, projectSwarmView(full, projection),
      `${projection} is exactly what the shared slicer says it is`);
    if (projection !== 'full' && projection !== 'situation') {
      assert.equal('situation' in view, false, `${projection} does not carry the situation`);
    }
  }
});
