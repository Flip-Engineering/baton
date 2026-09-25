// Issue #585 (docs/56 D6 for the seat brief; the root orchestrator's stage-3 change for the root
// wake message) — the two human renderings stage 3 lands, and the message the root reads.
//
//   (a) D6.1: the seat brief renders ONE `## Status` line of route counts directly under the goal,
//       from the same rows the `### Route usage` subsection renders, in every dialect; a brief
//       carrying no rows renders no section.
//   (b) D6.2: a brief's wake-event line opens with the class's derived status word when the class
//       derives one (brand.mjs), and an event-shaped class keeps its unprefixed line.
//   (c) the root wake message is a human message composed through the ONE mark rule: the owed
//       facts, the seat, the ask, and the command that answers the row — never a JSON payload.
//       Every rendered value is bounded, and so is the whole body.
//
// The messages are read through the real seam (`deliverRootWakeFrame`), so the class routing that
// carries `root_owed` and `root_turn_reported` is what these pins exercise.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { createBrief } from '../src/messages.mjs';
import { renderBrief } from '../src/adapter.mjs';
import { deliverRootWakeFrame } from '../src/wake-delivery.mjs';

const SMILE = '✦(◕‿◕)✦';
const TARGET = { harness: 'claude-code', sessionId: 'session-root' };
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const SWARM = 'wake-585';
const DIALECTS = ['omp-rpc', 'codex-v2', 'claude', 'cli'];

// ── the root wake message ─────────────────────────────────────────────────────────────────────

/** The delivery-red fixture's store: durable driver rows the root wake resolves through. */
function memoryStore() {
  const rows = [];
  return {
    rows,
    eventsView() { return rows; },
    recordDriver(kind, payload, auth) {
      const event = Object.freeze({
        schemaVersion: 1, seq: rows.length + 1, ts: payload.at, kind: 'driver.recorded',
        actor: auth.actor, idempotencyKey: auth.key,
        payload: Object.freeze({ kind, ...payload }),
      });
      rows.push(event);
      return { ok: true, event };
    },
  };
}

/** Record one source row, deliver the frame it resolves to, and return the message body the
 * delivery handed the transport. */
async function rootWakeBody(record, frame) {
  const store = memoryStore();
  const event = record(store);
  let body = null;
  const result = await deliverRootWakeFrame({
    store,
    frame: { ...frame, seq: event.seq },
    target: TARGET,
    deliver: async (context) => { body = context.body; return { delivered: true }; },
  });
  assert.equal(result.delivered, true, 'the frame is delivered through the root class routing');
  return body;
}

const owed = (store, payload, key) => store.recordDriver('swarm.root_attention_owed', payload,
  { actor: 'baton-runtime', key }).event;

test('585-1: a review_owed wake names the swarm, the seat, the contribution and the check command', async () => {
  const body = await rootWakeBody((store) => owed(store, {
    swarmId: 'swarm-40e6', participantId: 'ada', contributionId: 'contribution-ada-1',
    owed: 'review_owed', ask: null,
    next: { command: 'swarm.check', swarmId: 'swarm-40e6', participantId: 'ada',
      contributionId: 'contribution-ada-1' },
  }, '585-review-owed'), { wakeClass: 'root_owed', swarmId: 'swarm-40e6' });

  assert.equal(body, [
    `${SMILE} ▲ needs you — root owed: review_owed in swarm-40e6`,
    '  seat: ada · contribution-ada-1',
    '  next: baton swarm check swarm-40e6 ada contribution-ada-1 CHECK_ID',
  ].join('\n'));
  assert.equal(body.includes('{'), false, 'the root reads no JSON blob');
  assert.equal(body.includes('"'), false, 'no JSON string carries a field into the message');
  assert.ok(body.split('\n').length <= 6, 'the message stays within six lines');
});

test('585-2: a needs_root wake carries the ask and the view command', async () => {
  const body = await rootWakeBody((store) => owed(store, {
    swarmId: 'swarm-564', participantId: 'lead', contributionId: 'contribution-564',
    owed: 'needs_root', ask: 'the root: inspect contribution-564',
    next: { command: 'swarm.view', swarmId: 'swarm-564' },
  }, '585-needs-root'), { wakeClass: 'root_owed', swarmId: 'swarm-564' });

  assert.equal(body, [
    `${SMILE} ▲ needs you — root owed: needs_root in swarm-564`,
    '  seat: lead · contribution-564',
    '  ask: the root: inspect contribution-564',
    '  next: baton swarm view swarm-564',
  ].join('\n'));
  assert.equal(body.includes('{'), false);
  assert.equal(body.includes('"'), false);
});

test('585-3: a turn report names its result, the worker, the run and the run view command', async () => {
  const body = await rootWakeBody((store) => store.recordDriver('worker.turn_reported', {
    runId: 'run-root-585', worker: 'worker-root-585', taskId: 'task-root-585',
    turnSeq: 12, turnEpoch: 3,
    report: { status: 'completed', summary: 'The deployment turn is ready for root.' },
    assignmentDone: true,
  }, { actor: 'baton-runtime', key: '585-turn-reported' }).event,
  { wakeClass: 'root_turn_reported', runId: 'run-root-585' });

  assert.equal(body, [
    `${SMILE} turn reported: completed · worker-root-585`,
    '  run: run-root-585',
    '  next: baton run view run-root-585',
  ].join('\n'),
  'an event-shaped class carries no invented status word, and the run view reads the report');
  assert.equal(body.includes('{'), false);
  assert.equal(body.includes('"'), false);
});

test('585-4: every rendered value and the whole body are bounded', async () => {
  const long = 'x'.repeat(5000);
  const body = await rootWakeBody((store) => owed(store, {
    swarmId: long, participantId: long, contributionId: long, owed: 'needs_root', ask: long,
    next: { command: 'swarm.check', swarmId: long, participantId: long, contributionId: long },
  }, '585-bounds'), { wakeClass: 'root_owed', swarmId: long });

  assert.ok(body.length <= 2000, `the body is bounded: ${body.length} characters`);
  assert.ok(body.includes(`${'x'.repeat(200)}…`), 'a value is sliced at the bound and says so');
  assert.equal(body.includes('x'.repeat(201)), false, 'no value renders past the bound');
});

// ── the seat brief ────────────────────────────────────────────────────────────────────────────

const routeRow = (state, extra = {}) => ({
  route: { harness: 'mock', model: `model-${state}`, effort: 'low' }, state,
  usage: { turns: 1, tokens: 10, usd: 0 }, ...extra,
});

const briefWithRoutes = () => ({
  ...createBrief({
    goal: 'Do the thing', constraints: [], pathScope: [], definitionOfDone: 'It is done',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 10 },
  }),
  routeUsage: [
    routeRow('ready', { recruitable: true }),
    routeRow('ready', { recruitable: true }),
    routeRow('degraded', { quota: { state: 'ok' } }),
    routeRow('blocked', { quota: { state: 'exhausted', resetAt: null } }),
    // A state this table does not know renders after the three it does, in alphabetical order.
    routeRow('stale', { quota: { state: 'exhausted', resetAt: null } }),
  ],
});

test('585-5 (D6.1): the brief renders one ## Status line under the goal, in every dialect', () => {
  const brief = briefWithRoutes();
  const before = JSON.stringify(brief);
  for (const dialect of DIALECTS) {
    const lines = renderBrief(brief, dialect).split('\n');
    // The canonical dialects open on `## Goal`; the CLI dialect's goal is its `Task:` line.
    const goalAt = dialect === 'cli' ? 0 : lines.indexOf('## Goal');
    assert.equal(lines[goalAt + 2], '## Status', `${dialect}: the summary follows the goal`);
    assert.equal(lines[goalAt + 3],
      'Routes: 2 ready · 1 degraded · 1 blocked · 1 stale · 2 exhausted · 2 recruitable',
      `${dialect}: the counts are the rows' own, in the fixed order`);
  }
  assert.equal(JSON.stringify(brief), before, 'the rendering never mutates the brief it reads');
});

test('585-6 (D6.1): a brief with no route rows renders no ## Status section', () => {
  const brief = createBrief({
    goal: 'Do the thing', constraints: [], pathScope: [], definitionOfDone: 'It is done',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 10 },
  });
  for (const dialect of DIALECTS) {
    const lines = renderBrief(brief, dialect).split('\n');
    assert.equal(lines.includes('## Status'), false, `${dialect}: no rows, no section`);
    assert.equal(renderBrief({ ...brief, routeUsage: [] }, dialect).includes('## Status'), false,
      `${dialect}: an empty table renders no section`);
  }
});

// ── the seat brief's wake-event lines (D6.2) ───────────────────────────────────────────────────

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue585-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers, pausedTurns: () => [], routeCards: () => [],
      guideParticipant: async () => ({ ok: true }),
    },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async (runId) => {
      const worker = workers.find((row) => row.runId === runId);
      if (worker) worker.status = 'dead';
      return { state: 'closed' };
    },
    lastCrash: () => null,
  });
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM, idempotencyKey: `wake585-${++key}`, ...args }, owner);
  return { call, seat: (id) => store.swarm(SWARM)?.participants?.[id] ?? null };
}

test('585-7 (D6.2): a wake line opens with the derived status; an event-shaped class stays bare', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Test the wake-line status prefix' });
  await f.call('recruit', { participantId: 'alpha', objective: 'Work as alpha' });
  await f.call('stop', { participantId: 'alpha', reason: 'Done' });
  await f.call('recruit', { participantId: 'gamma', objective: 'Work as gamma' });

  const brief = f.seat('gamma').brief;
  const block = brief.slice(brief.indexOf('Recent wake events'));
  const lineFor = (wakeClass) => {
    const line = block.split('\n').find((entry) => entry.includes(` · ${wakeClass} · `));
    assert.ok(line, `the block carries a ${wakeClass} line`);
    return line;
  };
  // `left` derives (done), so the seat reads the same word the rest of Baton spells for it.
  assert.match(lineFor('left'), /^- ✓ done — \[seq \d+ · left · ts /u);
  assert.match(lineFor('left'), /· next: baton swarm view wake-585$/u, 'the follow-up command stays');
  // `recruited` is an event, not a state: the line keeps its unprefixed shape.
  assert.match(lineFor('recruited'), /^- \[seq \d+ · recruited · ts /u);
});
