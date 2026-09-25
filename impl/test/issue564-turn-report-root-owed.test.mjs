// issue564-turn-report-root-owed.test.mjs — issue #572's top-level turn end, reconciled onto
// issue #564's root-owed path (the hook rigidity-lead8 asked for).
//
// A turn report whose nearest active ancestor is null has no parent seat to deliver to, so it
// waits on the root: the addressing reconciler turns each such durable `swarm.turn_reported` row
// into one durable `swarm.root_attention_owed` row with `owed: 'turn_reported'`, under the
// reporter's own deterministic key. Three properties are pinned: a null-parent report is owed to
// the root and rides the reporting half's attention join; a report with a live parent is that
// parent's and never the root's; and a second observation repairs rather than duplicates (the
// reconciler rule the reviewer enforced on the reviewer-loss rows).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-564-turn-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const turn = (payload) => store.recordDriver('swarm.turn_reported', { swarmId: 'baton', ...payload },
    { actor: owner.actor, key: `turn-${++key}` });
  const owedRows = () => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.root_attention_owed')
    .map((event) => event.payload);
  return { directory, store, runtime, call, turn, owedRows };
}

test('564-t1: a top-level turn end (parentId null) is owed to the root, and rides the attention join', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'top-level turn end waits on the root (#572)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  f.turn({ participantId: 'lead', workerId: 'w-1', turnSeq: 7, turnEpoch: 1, parentId: null,
    report: 'the lane is green and the landing waits on the operator' });

  const recorded = f.runtime._reconcileTurnReportedRows(f.store.swarm('baton'), 'test');
  assert.equal(recorded.length, 1, 'one turn report with no parent produces exactly one owed row');
  const owed = f.owedRows();
  assert.equal(owed.length, 1, 'the owed row is durable, not derived in memory');
  assert.equal(owed[0].owed, 'turn_reported', 'the trigger is named in the owed vocabulary');
  assert.equal(owed[0].participantId, 'lead', 'the row names the reporting seat');
  assert.equal(owed[0].contributionId, undefined, 'a turn report comes from a turn, not a contribution');
  assert.equal(owed[0].ask, 'the lane is green and the landing waits on the operator', 'the report rides the row');
  assert.deepEqual(owed[0].next, { command: 'swarm.view', swarmId: 'baton' }, 'and the act that answers it');

  // The reporting half's join surfaces it as attention with no delivery record yet.
  const view = await f.call('view', { projection: 'attention' });
  const attention = (Array.isArray(view.attention) ? view.attention : view.attention?.rows ?? [])
    .filter((row) => row.kind === 'root_attention_owed' && row.owed === 'turn_reported');
  assert.equal(attention.length, 1, 'the reporting half renders the turn_reported owed row');
  assert.deepEqual(attention[0].delivery, { state: 'none', code: null }, 'no delivery attempt yet');
  assert.equal(attention[0].participantId, 'lead');
});

test('564-t2: a report with a live parent is that parent\'s, never the root\'s', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'parented turn end (#572)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  f.turn({ participantId: 'worker-a', workerId: 'w-2', turnSeq: 3, turnEpoch: 1, parentId: 'lead',
    report: 'the child finished its slice' });
  assert.equal(f.runtime._reconcileTurnReportedRows(f.store.swarm('baton'), 'test').length, 0,
    'a parented report is delivered to its parent seat and never re-addressed to the root');
  assert.equal(f.owedRows().length, 0, 'and nothing durable is recorded for the root');
});

test('564-t3: a second observation repairs rather than duplicates', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'replay adds nothing (#572)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  f.turn({ participantId: 'lead', workerId: 'w-1', turnSeq: 9, turnEpoch: 1, parentId: null, report: 'done' });
  assert.equal(f.runtime._reconcileTurnReportedRows(f.store.swarm('baton'), 'test').length, 1, 'first pass records');
  const second = f.runtime._reconcileTurnReportedRows(f.store.swarm('baton'), 'test');
  assert.equal(f.owedRows().length, 1, 'the deterministic key makes the replay a repair, not a duplicate');
  // The replayed call answers the row the replay already holds (the store replays the recorded one).
  assert.equal(second.length, 1, 'the pass still answers the row it holds');
});

test('a root guide can reply to a turn report without recording business resolution', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'root decides the next turn' });
  await f.call('recruit', { participantId: 'lead', objective: 'work on the lane' });
  const report = f.turn({ participantId: 'lead', workerId: 'w-1', turnEpoch: 1, turnSeq: 7,
    parentId: null, report: 'Ready for review.' });
  f.runtime._reconcileTurnReportedRows(f.store.swarm('baton'), 'test');
  await f.call('guide', { participantId: 'lead', inReplyTo: report.event.seq, message: 'Continue with the dispatcher.' });
  const view = await f.call('view', { projection: 'attention' });
  const rows = Array.isArray(view.attention) ? view.attention : view.attention?.rows ?? [];
  assert.equal(rows.filter((row) => row.owed === 'turn_reported').length, 1);
});

test('564-t4: the participant_left update path reconciles the turn rows too', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'update path reconciles (#572)' });
  await f.call('recruit', { participantId: 'lead', objective: 'hold the lane' });
  await f.call('recruit', { participantId: 'other', objective: 'leave' });
  f.turn({ participantId: 'lead', workerId: 'w-1', turnSeq: 11, turnEpoch: 1, parentId: null, report: 'waiting' });
  await f.call('update', { event: 'swarm.participant_left', payload: {
    swarmId: 'baton', participantId: 'other', reason: 'lane done',
  } });
  assert.equal(f.owedRows().filter((row) => row.owed === 'turn_reported').length, 1,
    'the departure path reconciles the turn-report rows, so a report never waits for a later observation');
});

test("564-t5: a parent-guidance failure re-addressed to the root wakes it too, keyed by the reporter epoch", async (t) => {
  const f = fixture(t);
  await f.call("create", { purpose: "parent guidance failed (#572 fallback)" });
  await f.call("recruit", { participantId: "lead", objective: "hold the lane" });
  f.turn({ participantId: "worker-a", workerId: "w-3", turnSeq: 4, turnEpoch: 2, parentId: null,
    report: "", assignmentDone: true,
    deliveryFailure: { parentId: "lead", reason: "guidance refused: the parent is gone" } });
  const recorded = f.runtime._reconcileTurnReportedRows(f.store.swarm("baton"), "test");
  assert.equal(recorded.length, 1, "the fallback row is a root-addressed turn report and wakes the root");
  const owed = f.owedRows();
  assert.equal(owed[0].owed, "turn_reported");
  assert.equal(owed[0].ask, "guidance refused: the parent is gone", "the failure reason rides the ask when the report is empty");
  f.turn({ participantId: "worker-a", workerId: "w-3", turnSeq: 4, turnEpoch: 9, parentId: null, report: "second epoch" });
  f.runtime._reconcileTurnReportedRows(f.store.swarm("baton"), "test");
  assert.equal(f.owedRows().length, 2, "turnEpoch is part of the turn identity, exactly as the reporter keys it");
});

test("564-t6: reportTurnEnd drives the reconciler when the runtime provides it (their call site)", async (t) => {
  const f = fixture(t);
  if (typeof f.runtime.reportTurnEnd !== "function") {
    t.skip("reportTurnEnd is rigidity-lead8 #572 half; this row exercises it the moment it lands");
    return;
  }
  await f.call("create", { purpose: "reportTurnEnd call site (#572)" });
  await f.call("recruit", { participantId: "lead", objective: "hold the lane" });
  await f.runtime.reportTurnEnd({ swarmId: "baton", participantId: "lead", workerId: "w-1",
    turnSeq: 21, turnEpoch: 5, report: { summary: "turn finished, nothing waits on a parent" } });
  assert.equal(f.owedRows().filter((row) => row.owed === "turn_reported").length, 1,
    "the reporter own call reconciles the root-owed row at the turn end, never at a later observation");
  const keys = f.store.eventsView().filter((e) => e.payload?.kind === "swarm.turn_reported").length;
  assert.equal(keys, 1, "and the owed record never collides with the reporter own swarm.turn_reported row");
});
