// Issue #486 — the probe observation reads the ledger where a route is read, never per command.
//
// 89eaf822 (#475) closed a probe's episode from the seat's own answering turn (`route.observed`),
// and did it at the runtime ENTRY: the first thing every command did was read the coordination
// ledger's delta to see whether a probe had answered. One delta read per command is still a read on
// a read path: `run.contributions.read` derives from the FOLD and promises zero ledger scans
// (docs/47 §3, docs/46 §7), and issue441-reading-half-red row (d) counts the calls. The observation
// now rides the ROUTE reads that stand on it — `_routeUsageRows` (the recruit comparison, the
// refusal, the brief, the #443 re-route ranking) and the deployment facts `inspect` publishes — from
// the ONE derivation `_settleRouteProbes` and the delta index it shares with every other probe
// reader (the seq this incarnation has consumed). A command that touches no route reads no row for
// one, and the row that lands when the provider answers is still settled, still at the instant the
// turn was OBSERVED, still before any refusal can be minted against it.
//
// These rows are the red-before pins:
//
//   (a) N read commands after startup scan the ledger ZERO times;
//   (b) an answer folded onto the ledger is settled by the NEXT ROUTE READ through ONE delta read —
//       the one that starts exactly at the row which landed since the cursor, never a scan — while
//       a read that touches no route pays nothing for it;
//   (c) the index is rebuilt ONCE on open (the probe a previous incarnation admitted is still held,
//       by the seat and the attempt its durable row carries) and is never scanned again afterwards.
//
// Hermetic: a temp directory under os.tmpdir(), in-process fixtures, no provider process, no timers
// and no wait on the wall clock. The expectations are counts and instants, never durations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const SWARM_ID = 'baton';
const owner = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
// A seat's bridge identity is the WORKER its Run is bound to (the #318/#441 spelling): the verb
// resolves the participant from the worker id, never from a caller-chosen participantId.
const workerPrincipal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

const PROBED = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const READY = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
const HOUR_MS = 3_600_000;

/** ONE row of the deployment's own route table, the shape `_routeUsageRows` compares. `episodeAt`
 * non-null publishes the incident's episode: a degrade whose clear has already passed, so a probe
 * is due and the episode's identity (`clearsAt`) is a stable instant the fixture holds once. */
function usageRow(route, episodeAt) {
  const base = { route: { ...route }, code: null, resetAt: null, usage: { turns: 0 },
    concurrency: null, profile: null };
  if (episodeAt === null) {
    return { ...base, state: 'ready', degraded: null, quota: { state: 'ok', resetAt: null } };
  }
  const cleared = new Date(Date.parse(episodeAt) - HOUR_MS).toISOString();
  return { ...base, state: 'degraded', quota: { state: 'ok', resetAt: null },
    degraded: { route: { ...route }, faultClass: 'quota', since: episodeAt,
      clearsAt: cleared, probeAfter: cleared, count: 3, participants: ['lane-probe'] } };
}

const refusalOf = async (promise) => {
  try { await promise; return null; } catch (error) { return error; }
};

/** The light SwarmRuntime harness (the issue475-probe-clears-degrade.test.mjs shape, without a
 * deployment): the fleet the coordinator answers for, the route table the deployment publishes, and
 * the LEDGER READ SEAM every row below measures — `eventsView` records the seq each call READ FROM,
 * so a delta read (`cursor + 1`) is told apart from a full scan (no argument at all). */
function harness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue486-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(join(directory, 'coordination'));
  const worker = null;
  const rowsOf = { current: () => [usageRow(READY, null)] };
  const fleet = [];
  const reads = [];
  const raw = store.eventsView.bind(store);
  store.eventsView = (...args) => { reads.push(args[0] ?? null); return raw(...args); };
  const open = (state) => new SwarmRuntime({
    store,
    coordinator: { list: () => fleet, pausedTurns: () => [], providerFaultDeathFor: () => null },
    authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null,
      routeUsage: rowsOf.current() }),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      if (fleet.some((row) => row.runId === request.runId)) return;
      fleet.push({ id: `w-${fleet.length + 1}`, taskId: `t-${fleet.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async (runId) => {
      const row = fleet.find((candidate) => candidate.runId === runId);
      if (row) row.status = 'dead';
      return { state: 'closed' };
    },
  });
  const bind = (runtime) => {
    let key = 0;
    return {
      runtime,
      reads,
      call: (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
        { swarmId: SWARM_ID, ...(command === 'view' ? {} : { idempotencyKey: `486-${++key}` }), ...args },
        caller),
      seatCall: (verb, args = {}, caller) => runtime.command(verb, { swarmId: SWARM_ID, ...args }, caller),
    };
  };
  // The durable rows, read through the RAW seam so the fixture's own assertions are never counted
  // as the runtime reading the ledger.
  const rowsOfKind = (kind) => raw()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts, idempotencyKey: event.idempotencyKey }));
  const seatRow = (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null;
  const seatPrincipal = (participantId) => {
    const runId = seatRow(participantId).runId;
    return workerPrincipal(fleet.find((row) => row.runId === runId).id);
  };
  return { store, rowsOf, reads, rowsOfKind, seatRow, seatPrincipal, open, bind, raw };
}

/** The coordinator's own `route.observed` row (#475): the provider ANSWERED this seat's turn on the
 * route its Run was admitted on. Recorded by the fixture (the coordinator does this live), so the
 * runtime never wrote it and can only learn it from the ledger. */
function recordObserved(f, participantId) {
  const seat = f.seatRow(participantId);
  const workerId = seat.bindings.at(-1).workerId;
  return f.store.recordDriver('route.observed', {
    taskId: seat.runId, workerId, runId: seat.runId,
    harnessRequested: PROBED.harness, harnessResolved: PROBED.harness,
    modelRequested: PROBED.model, modelResolved: PROBED.model, modelObserved: PROBED.model,
    effortRequested: PROBED.effort, effortResolved: PROBED.effort, effortObserved: PROBED.effort,
  }, { actor: 'policy', key: `driver.route_observed:${seat.runId}:1` }).event;
}

/** The ledger reads that named a seq — the DELTA reads, as opposed to a command's own full pass. */
const deltas = (reads) => reads.filter((value) => typeof value === 'number');

// ── (a) a read command scans nothing ────────────────────────────────────────────────────────────

test('486-a: read commands after startup scan the ledger zero times', async (t) => {
  const f = harness(t);
  const f6 = f.bind(f.open());
  await f6.call('create', { purpose: 'no scan per command' });
  const recruited = await f6.call('recruit',
    { participantId: 'seat-1', objective: 'read the fold', options: { exact: READY } });
  assert.equal(recruited.admission?.state, 'admitted', 'the seat is admitted on the ready route');
  const seat = f.seatPrincipal('seat-1');

  // The window opens AFTER the resident's own startup work (the create and the recruit above wrote
  // the rows a delta index would have to catch up on): everything from here is a READ.
  f.reads.length = 0;
  const answers = [];
  for (let index = 0; index < 4; index += 1) {
    answers.push(await f6.seatCall('run.contributions.read', { since: 0 }, seat));
  }
  assert.equal(f.reads.length, 0,
    'a read derives from the fold — four read commands, zero ledger reads (docs/46 §7, docs/47 §3)');
  assert.ok(answers.every((answer) => Array.isArray(answer.rows)),
    'and every one of them still answers its rows');
});

// ── (b) the answer is settled where the route is read ───────────────────────────────────────────

test('486-b: a probe answer settles on the next route read, through ONE delta read', async (t) => {
  const f = harness(t);
  const episodeAt = new Date(Date.now() - 2 * HOUR_MS).toISOString();
  f.rowsOf.current = () => [usageRow(PROBED, episodeAt), usageRow(READY, null)];
  const f6 = f.bind(f.open());
  await f6.call('create', { purpose: 'the probe answers' });
  const probe = await f6.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: PROBED } });
  assert.equal(probe.admission?.kind, 'probe', 'the due probe is what is admitted');
  const admission = f.rowsOfKind('route.probe_admitted')[0];
  assert.ok(admission, 'the admission is durable');
  const seat = f.seatPrincipal('lane-probe');

  // A route read with nothing to settle catches the index up to the ledger's head, so the row the
  // provider's answer appends is the ONLY one the next delta has to carry.
  await f6.call('view', {});
  f.reads.length = 0;
  const observed = recordObserved(f, 'lane-probe');
  assert.ok(observed, 'the observation is durable');

  // A read that touches no route: it must scan nothing for the probe — the fact is not its business
  // until a route is read — and it must not settle it either.
  await f6.seatCall('run.contributions.read', { since: 0 }, seat);
  assert.deepEqual(f.reads, [],
    'the read path scans nothing, not even to settle the probe it is not about (#486)');

  // The next route read settles it: ONE delta read, starting exactly at the row that landed since
  // the cursor — never a scan of the ledger, and never a second read after the clearing was written.
  await f6.call('view', {});
  assert.deepEqual(deltas(f.reads), [observed.seq],
    'one delta read, from the row the ledger appended since the cursor (not a full scan)');
  const recovered = f.rowsOfKind('route.recovered');
  assert.equal(recovered.length, 1, 'the answered episode is closed — ONE route.recovered row');
  assert.equal(recovered[0].at, observed.ts,
    'minted at the instant the answering turn was observed, never at the instant it was read back');
  assert.equal(recovered[0].probeKey, admission.idempotencyKey, 'keyed by the admission it answers');
  assert.equal(recovered[0].probeAdmissionSeq, admission.seq, 'naming that admission\'s row');
});

// ── (c) the index is rebuilt once on open, and only once ────────────────────────────────────────

test('486-c: the delta index is rebuilt once on open, and the inherited probe still holds', async (t) => {
  const f = harness(t);
  const episodeAt = new Date(Date.now() - 2 * HOUR_MS).toISOString();
  f.rowsOf.current = () => [usageRow(PROBED, episodeAt), usageRow(READY, null)];
  const before = f.bind(f.open());
  await before.call('create', { purpose: 'a restart inherits the probe' });
  const probe = await before.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: PROBED } });
  assert.equal(probe.admission?.kind, 'probe', 'the first incarnation admits the probe');
  const admission = f.rowsOfKind('route.probe_admitted')[0];
  assert.ok(admission, 'and the admission is durable');

  // The resident restarts: a fresh runtime over the SAME ledger, with its own (cold) index.
  const after = f.bind(f.open());
  // The restart's first command touches no route: rebuilding the index is the ROUTE read's to pay,
  // never a read's (#486: a read command scans nothing, cold index or warm).
  f.reads.length = 0;
  await after.seatCall('run.contributions.read', { since: 0 }, f.seatPrincipal('lane-probe'));
  assert.deepEqual(f.reads, [], 'a read command pays nothing for the cold index');

  // The first route read of the new incarnation rebuilds the index from the ledger — ONCE.
  f.reads.length = 0;
  await after.call('view', {});
  assert.deepEqual(deltas(f.reads), [1],
    'the first route read rebuilds the index from the ledger, ONCE (from seq 1)');

  // Nothing landed since: the rebuilt cursor answers for free, so nothing is scanned a second time.
  f.reads.length = 0;
  await after.call('view', {});
  assert.deepEqual(deltas(f.reads), [], 'the index is never rebuilt again — the cursor is the head');

  // The fact it rebuilt FROM is the durable one: the probe the previous incarnation admitted still
  // holds its episode, named by the seat and the attempt its own row carries.
  f.reads.length = 0;
  const refused = await refusalOf(after.call('recruit',
    { participantId: 'lane-next', objective: 'work', options: { exact: PROBED } }));
  assert.equal(refused?.code, 'route_degraded', 'the inherited probe still holds the episode');
  assert.match(refused.message, /lane-probe/u, 'the refusal names the seat the admission row carries');
  assert.equal(refused.detail?.probeFaulted ?? null, null, 'the inherited probe has not died — it is out');
  assert.deepEqual(deltas(f.reads), [], 'and the refusal was answered from the inherited index');
});
