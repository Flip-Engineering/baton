// Issue #464 (the SECOND half, lane ds-464b) — a participant row's `workspace.commits` is a
// BOUNDED TAIL, and a bridge PAGE carries no commit rows at all.
//
// MEASURED by lane ds-464 on the live swarm (swarm-primary-20260918, 2026-09-18 12:17Z): once the
// row's role/brief text was bounded, the biggest field left on a participant page was
// `workspace.commits` — 202 315 B on one row, of which 195 049 B was the commit list (1 241
// wrapper-attributed rows on a single seat). The participants projection still served 6 of 36 rows
// per frame, so a seat walking its peers still paged six times.
//
// The law this file pins (issue #464's Required items 1–3):
//   (a) a participant row carries the NEWEST `view.workspace.commits` registry-row's worth of a
//       seat's attributed commits, NEWEST FIRST, beside `commitsTotal` — the whole count, so a
//       bounded row is never mistaken for a complete history. The reach for the rest is the seat's
//       OWN participantId-scoped read (the #343/#349 ladder: heavy per-row fields ride a read that
//       names the participant), and it carries the whole list;
//   (b) a bridge PAGE drops the commit rows entirely (they are heavy per-row fields, like
//       lastToolRows and the native record) and keeps `commitsTotal` — the count and the reach are
//       what a page carries;
//   (c) a 36-seat fixture whose seats each carry 60 commits answers its participants projection in
//       ONE page — served 36, no cursor — which is the acceptance ds-464 could not reproduce-fix.
//
// Red-first at HEAD (f5fc6c40): the row carried all 200 commits with no count at all, a page
// carried every commit row it paged, and the 36-seat participants page served 29 of 36 rows with
// `next: swarm-page:full:29`.
//
// Hermetic: a real CoordinationStore and the real SwarmRuntime (plus the real native bridge for
// (b)/(c)); commit attribution is written through the SAME `recordDriver('worktree.commit_recorded')`
// row the projected git wrapper's spool drain writes (#425) — no git binary is needed, because
// this lane's whole subject is the READ side of rows already on the ledger.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { SWARM_VIEW_PROJECTIONS, projectSwarmView } from '../src/swarm-contract.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand } from '../src/swarm-native-bridge.mjs';
import { swarmViewBridgeFrameBytes } from '../src/web-northbound.mjs';

const COMMIT_ROW = FRAME_LIMITS['view.workspace.commits'];
/** The row's value — the ONE bound every assertion below reads (undefined at HEAD, where the
 * registry row does not exist yet, so each row reports its own failure rather than the file's). */
const COMMIT_BOUND = COMMIT_ROW?.value;
const owner = { actor: 'direct:issue464b-root', principalId: 'issue464b-root', sessionId: 'issue464b-root' };
const SWARM = 'commit-budget-464b';
/** The bridge ceiling the issue was measured against — the registry's own wire frame, never a literal. */
const WIRE_FRAME = FRAME_LIMITS['wire.frame'].value;
const BRIDGE_FRAME = 64 * 1024;
const wsId = (index) => `ws-${String(index).padStart(2, '0').repeat(16)}`.slice(0, 35);

/** One attributed commit row as the runtime's fold reads it: the payload the projected wrapper's
 * spool drain records (`worktree.commit_recorded`, swarm-runtime.mjs `_settleCheckoutWriterState`). */
const commitPayload = (participantId, workspaceId, index) => ({
  swarmId: SWARM, participantId, workspaceId,
  sha: `${String(index).padStart(8, '0')}${'a'.repeat(32)}`,
  paths: [`impl/src/part-${index}.mjs`, `impl/test/issue464b-${index}.test.mjs`],
  at: new Date(Date.UTC(2026, 8, 18, 12, 0, index % 60)).toISOString(),
});
const shaAt = (index) => commitPayload('', '', index).sha;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue464b-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      liveWorkspaceHolders: () => [],
      // The binding's own durable workspace identity: a seat's row derives its checkout from it
      // after a restart, when no worker handle is left to answer (#428/#438).
      workspaceAttachment: (workerId) => {
        const index = workers.findIndex((candidate) => candidate.id === workerId);
        return index < 0 ? null : { workspaceId: wsId(index), holderCount: 1 };
      },
    },
    authorize: async () => {},
    prepareRun: async (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  t.after(() => runtime.close());

  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM, ...(command === 'view' ? {} : { idempotencyKey: `i464b:${++key}` }), ...args }, caller);
  const seatName = (index) => (index === 0 ? 'alpha' : `p${index}`);
  const recruit = async (index) => call('recruit', {
    participantId: seatName(index), objective: `Build as ${seatName(index)}`, permissions: SWARM_PERMISSIONS,
  });
  const recordCommits = (index, count, offset = 0) => {
    for (let c = 0; c < count; c += 1) {
      store.recordDriver('worktree.commit_recorded',
        commitPayload(seatName(index), wsId(index), offset + c),
        { actor: 'baton-runtime', key: `i464b:commit:${index}:${offset + c}` });
    }
  };
  return { directory, store, workers, runtime, call, recruit, recordCommits, seatName };
}

/** The bridge fixture of issue #457 (the same real runtime and the real native bridge), with this
 * issue's own load: seats whose attributed commit lists are big enough to matter. */
async function linked(t, { seats = 1, commitsPerSeat = 0, maxFrameBytes = BRIDGE_FRAME } = {}) {
  const f = fixture(t);
  await f.call('create', { purpose: 'A participant row carries a bounded commit tail (#464)' });
  for (let index = 0; index < seats; index += 1) await f.recruit(index);
  for (let index = 0; index < seats; index += 1) f.recordCommits(index, commitsPerSeat);
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => f.runtime.command(command, args, principal, context),
    maxFrameBytes,
  });
  t.after(async () => { await bridge.close(); });
  const runId = f.store.swarm(SWARM).participants.alpha.runId;
  const issued = await bridge.issue({ swarmId: SWARM, participantId: 'alpha', runId });
  const send = (command, args) => swarmBridgeCommand({ command, args }, { env: issued.env });
  return { ...f, bridge, issued, send, runId };
}

const rowOf = (view, participantId) => view.participants.find((row) => row.participantId === participantId);

test('464b-a: a participant row carries the NEWEST bounded tail with commitsTotal, and the seat\'s own scoped read is the reach for the rest', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'the row carries a bounded tail' });
  await f.recruit(0);
  f.recordCommits(0, 200);
  await f.recruit(1);
  f.recordCommits(1, 3);
  const view = await f.call('view', { projection: 'participants' });
  const row = rowOf(view, 'alpha');
  assert.equal(row.workspace.commits.length, COMMIT_BOUND,
    `the row carries exactly the ${COMMIT_ROW?.lane} bound`);
  assert.equal(row.workspace.commitsTotal, 200,
    'commitsTotal is the WHOLE count — a bounded row never reads as a complete history');
  assert.equal(row.workspace.commits[0].sha, shaAt(199),
    'the carried slice is the TAIL, newest first');
  assert.equal(row.workspace.commits.at(-1).sha, shaAt(200 - COMMIT_BOUND),
    'the oldest carried row is the bound-th newest — the tail is contiguous, not sampled');
  assert.ok(row.workspace.commits.every((commit) => Array.isArray(commit.paths) && Number.isSafeInteger(commit.seq)),
    'the carried rows are the durable attribution rows themselves (paths, at, seq)');

  const short = rowOf(view, 'p1');
  assert.equal(short.workspace.commits.length, 3, 'a history under the bound rides whole');
  assert.equal(short.workspace.commits[0].sha, shaAt(2), 'and it reads newest first too');
  assert.equal(short.workspace.commitsTotal, 3);

  // The reach: the read that NAMES the seat carries the list whole (#343/#349 — the same ladder
  // lastToolRows and the native record ride).
  const scoped = await f.call('view', { participantId: 'alpha' });
  const scopedRow = rowOf(scoped, 'alpha');
  assert.equal(scopedRow.workspace.commits.length, 200,
    'a participantId-scoped read carries the whole attributed history — the reach for the rest');
  assert.equal(scopedRow.workspace.commits[0].sha, shaAt(199), 'in the same newest-first order');
  assert.equal(scopedRow.workspace.commitsTotal, 200);
});

test('464b-b: a bridge PAGE keeps the count and drops the commit rows', async (t) => {
  const f = await linked(t, { seats: 24, commitsPerSeat: 40 });
  const whole = await f.call('view', { projection: 'participants' });
  assert.ok(swarmViewBridgeFrameBytes(projectSwarmView(whole, 'participants')) > BRIDGE_FRAME,
    'the fixture really exceeds the bridge frame');

  const first = await f.send('swarm.view', { swarmId: SWARM, projection: 'participants' });
  assert.equal(first.projection, 'participants');
  assert.ok(first.page !== null && typeof first.page === 'object', 'the over-bound read is paged');
  assert.ok(first.page.served >= 1 && first.page.served < whole.participants.length,
    'the first page serves part of the family, not all of it');
  assert.ok(first.page.next, 'the page names where the walk resumes');
  for (const row of first.participants) {
    assert.equal(Object.hasOwn(row.workspace, 'commits'), false,
      'a page carries no commit rows: they are heavy per-row fields');
    assert.equal(row.workspace.commitsTotal, 40,
      'the page keeps the count, so a reader still knows how many it did not carry');
  }

  const walked = [...first.participants];
  let page = first;
  while (page.page.next !== null) {
    page = await f.send('swarm.view', { swarmId: SWARM, projection: 'participants', cursor: page.page.next });
    walked.push(...page.participants);
  }
  assert.equal(page.page.next, null, 'the walk ends at the last row');
  assert.deepEqual([...new Set(walked.map((row) => row.participantId))].sort(),
    whole.participants.map((row) => row.participantId).sort(),
    'the walk serves every row — the commit drop costs no row');
  assert.equal(walked.length, whole.participants.length, 'and serves each of them exactly once');
});

test('464b-c: a 36-seat swarm whose seats are busier than the bound still answers its participants projection in ONE frame', async (t) => {
  // The seats carry MORE than a row may hold (200 > the registry bound), so this is the fixture
  // the issue measured: at HEAD the projection exceeded the frame, the walk paged (keeping every
  // commit row), and a seat's first look answered 11 of 36 peers. With the row bounded the whole
  // roster rides one frame again.
  const f = await linked(t, { seats: 36, commitsPerSeat: 200, maxFrameBytes: WIRE_FRAME });
  const whole = await f.call('view', { projection: 'participants' });
  assert.equal(whole.participants.length, 37, '36 seats plus the synthesized root row (docs/46 §5.1)');

  const answer = await f.send('swarm.view', { swarmId: SWARM, projection: 'participants' });
  assert.equal(answer.projection, 'participants');
  assert.equal(answer.participants.length, 37, 'every seat answers in the ONE frame, root row included');
  assert.equal(answer.page?.next ?? null, null, 'no cursor: nothing of the roster was left for a second page');
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, result: answer })) <= WIRE_FRAME,
    'and the answer fits the frame it was measured against');
  assert.equal(rowOf(whole, 'alpha').workspace.commitsTotal, 200,
    'the fixture really carries more history than one row may hold');
  assert.equal(answer.participants.find((row) => row.participantId === 'alpha').workspace.commitsTotal, 200,
    'each row still names its whole count');
});

test('464b-d: the bound is the registry row\'s, and every projection reads the ONE derivation', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'one derivation' });
  await f.recruit(0);
  f.recordCommits(0, COMMIT_BOUND + 25);

  for (const projection of ['full', 'participants', 'workspace']) {
    assert.ok(Object.hasOwn(SWARM_VIEW_PROJECTIONS, projection));
    const view = await f.call('view', { projection });
    const row = rowOf(view, 'alpha');
    assert.equal(row.workspace.commits.length, COMMIT_BOUND,
      `${projection}: every projection carries the same bounded tail`);
    assert.equal(row.workspace.commitsTotal, COMMIT_BOUND + 25, `${projection}: and the same count`);
  }
});
