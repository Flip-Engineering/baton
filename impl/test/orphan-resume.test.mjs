import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

// Issue #201 roadmap row-resume-wiring — the successor incarnation's orphan re-dispatch
// projection. The seams landed at 3d9b5550 (store.orphans(), retry_pending parks, death-cert
// sessionId/sessionFile, --resume/--session-dir argv); the MISSING wiring is turning orphan
// rows into durable resume INTENTS for the successor: coordinator.resumeOrphans({liveWorkers}).
//
//   R1 RED PIN  coordinator.resumeOrphans({liveWorkers}) exists — a pure projection over
//               store.orphans() rows + each row's LAST death-cert evidence. At HEAD the method
//               does not exist — its ABSENCE is the RED reason.
//   R2          a working orphan (claim held by a dead generation) whose worker stream ends
//               with a death-cert lifecycle.crashed projects {taskId, workerId, sessionId,
//               sessionDir, retry:null} — the cert's resume handle, sessionDir = the session
//               file's directory (the --session-dir argv coordinate).
//   R3          a working orphan with NO crash evidence projects sessionId:null (a FRESH
//               retry — never invented), sessionDir null, retry null.
//   R4          a retry_pending orphan projects the parked transition's death-cert evidence +
//               retry counters {attempt, of}.
//   R5          a retry_pending park WITHOUT transition evidence (legacy store seed) projects
//               sessionId null + retry null — never synthesized.
//   R6          liveWorkers exclusion: a live claim never surfaces; unclaimed/terminal tasks
//               never surface.
//   R7          PURE: NO spawn is executed, NO durable event is appended, task statuses are
//               untouched.
//
// Contract: docs/reference/evidence/durable-member-retry-2026-08-15/contract.md (D1/D3/D4)
// + docs/reference/evidence/baton-builds-baton-2026-08-19/wave-a/row-resume-wiring-brief.md.

// ---------------------------------------------------------------------------
// Fixture — the successor-incarnation shape.
// ---------------------------------------------------------------------------
//
// A dead generation's ledger/streams are seeded AFTER coordinator construction: the
// constructor's replay sweep (`_terminalizeUnattachedCoordinationTasks` / the
// session_not_reattached replay fold) durably fails working claims that carry no live handle,
// so a seed-before-construction working orphan would be consumed before resumeOrphans ever
// runs. Seeding after construction pins the PROJECTION itself — resumeOrphans is a pure read
// over the store + the worker's operational stream at call time, exactly the successor's
// recovery-scan posture.

function makeCoordinator() {
  const logDir = mkdtempSync(join(tmpdir(), 'orphan-resume-log-'));
  const log = new Log(logDir, () => new Date().toISOString());
  const coordination = coordinationForLog(log);
  const spawnCalls = [];
  const adapters = {
    stub: {
      _cb: null,
      onEvent(cb) { this._cb = cb; },
      card: () => ({
        harness: 'stub', version: '1', authPosture: 'subscription', concurrencyCeiling: 4,
        maxContext: 1000,
        verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
        sessions: { multiTurn: 'native', resume: 'native', fork: 'unsupported' },
      }),
      spawn: async (...args) => { spawnCalls.push(args); return { ok: true }; },
      prompt: async () => ({ ok: true }),
      interrupt: async () => ({ ok: true }),
      kill: async () => ({ ok: true, terminal: true }),
      approve: async () => ({ ok: true }),
      answer: async () => ({ ok: true }),
    },
  };
  const worktrees = {
    create: async (taskId) => ({ path: mkdtempSync(join(tmpdir(), `orphan-resume-wt-${taskId}-`)), branch: 'b', baseSha: 'x' }),
    capture: async () => ({ sha: 'deadbeef', snapshotted: false }),
    createVerifyWorktree: async () => ({ path: mkdtempSync(join(tmpdir(), 'orphan-resume-vf-')) }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters, worktrees, repoRoot: tmpdir(),
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: (task, cards) => Object.keys(cards)[0],
    now: Date.now, approvalTimeoutMs: 2000, stopDeadlineMs: 2000,
  });
  return { coordinator, coordination, log, spawnCalls };
}

const auth = (key) => ({ actor: 'orchestrator', key });

function seedClaim(store, id, worker, { retryEvidence = null, parkWithoutEvidence = false } = {}) {
  store.createTask({
    id, brief: { objective: `pin ${id}` }, deps: [], refines: null, runId: 'run:orphan-resume',
    taskType: 'general', reservedWorkerId: worker, vendorRequested: 'stub', modelRequested: null,
    modelPolicy: null, effortRequested: null, sessionRequest: { mode: 'new' }, relation: 'general',
  }, auth(`pin:create:${id}`));
  store.claimTask(id, worker, 1, auth(`pin:claim:${id}`));
  store.recordWorkerGeneration({
    workerId: worker, taskId: id, taskVersion: 2, runId: 'run:orphan-resume', processGeneration: 3,
  }, { actor: 'hub', key: `worker.generation_bound:${worker}:3` });
  if (retryEvidence !== null || parkWithoutEvidence) {
    store.transitionTask(id, 'retry_pending', 2, auth(`pin:retry:${id}`), retryEvidence);
  }
  return worker;
}

function appendOperational(coordinator, worker, kind, payload) {
  coordinator._log.append({
    worker, harness: 'stub', turnEpoch: 1, kind,
    actor: kind === 'lifecycle.crashed' ? 'worker' : 'orchestrator', payload,
  });
}

const CRASH_CERT = Object.freeze({
  phase: 'process_exit', exitCode: 137, signal: null,
  error: 'omp rpc process exited during an active turn',
  sessionId: 'sess-orphan-crash', sessionFile: '/iso/w-crash/sess-orphan-crash.jsonl',
});

const PARKED_EVIDENCE = Object.freeze({
  coordinationSeq: 7, worker: 'w-retry', workerSeq: 5, digest: 'a'.repeat(64),
  kind: 'lifecycle.crashed', ts: '2026-08-15T00:00:00.000Z',
  deathCert: {
    exitCode: 137, signal: null, sessionId: 'sess-retry-parked',
    sessionFile: '/iso/w-retry/sess-retry-parked.jsonl',
  },
  retry: { attempt: 2, of: 3 },
});

// ---------------------------------------------------------------------------
// R1 — the RED pin: the method exists (at HEAD it does not)
// ---------------------------------------------------------------------------

test('R1 RESUME-ORPHANS EXISTS: coordinator.resumeOrphans({liveWorkers}) is the successor\'s orphan re-dispatch projection', () => {
  const { coordinator, coordination } = makeCoordinator();
  seedClaim(coordinator._coordination, 't-crash', 'w-crash');
  appendOperational(coordinator, 'w-crash', 'lifecycle.spawned', { phase: 'spawn' });
  appendOperational(coordinator, 'w-crash', 'lifecycle.crashed', CRASH_CERT);

  // RED at HEAD: the method does not exist — typeof throws `resumeOrphans is not a function`
  // on access. The absence IS the RED reason (nothing to implement, nothing to wire).
  assert.equal(typeof coordinator.resumeOrphans, 'function',
    'the successor coordinator exposes the orphan re-dispatch projection');
  const intents = coordinator.resumeOrphans({ liveWorkers: [] });
  assert.deepEqual(intents.map((row) => row.taskId), ['t-crash']);
});

// ---------------------------------------------------------------------------
// R2/R3 — dead-generation working claims: cert-backed resume vs fresh retry
// ---------------------------------------------------------------------------

test('R2 RESUME HANDLE: a working orphan whose worker died WITH a death cert projects the resume intent (sessionId + sessionDir, retry null)', () => {
  const { coordinator } = makeCoordinator();
  seedClaim(coordinator._coordination, 't-crash', 'w-crash');
  appendOperational(coordinator, 'w-crash', 'lifecycle.spawned', { phase: 'spawn' });
  appendOperational(coordinator, 'w-crash', 'lifecycle.crashed', CRASH_CERT);

  const intents = coordinator.resumeOrphans({ liveWorkers: [] });
  assert.equal(intents.length, 1, `exactly the dead-generation claim surfaces (got ${JSON.stringify(intents)})`);
  const intent = intents[0];
  assert.equal(intent.taskId, 't-crash');
  assert.equal(intent.workerId, 'w-crash');
  assert.equal(intent.sessionId, 'sess-orphan-crash', 'the death-cert resume handle rides the intent');
  assert.equal(intent.sessionDir, '/iso/w-crash', 'the isolated session store is the session file\'s directory (the --session-dir argv coordinate)');
  assert.equal(intent.retry, null, 'a never-parked claim carries no retry counters');
});

test('R3 FRESH RETRY: a working orphan with NO death-cert evidence projects sessionId null — never invented', () => {
  const { coordinator } = makeCoordinator();
  seedClaim(coordinator._coordination, 't-fresh', 'w-fresh');
  // The host died mid-run (GT2 shape): spawned, worked, but no crash cert was ever written.
  appendOperational(coordinator, 'w-fresh', 'lifecycle.spawned', { phase: 'spawn' });
  appendOperational(coordinator, 'w-fresh', 'lifecycle.turn_started', { turnEpoch: 1 });

  const intents = coordinator.resumeOrphans({ liveWorkers: [] });
  assert.equal(intents.length, 1);
  const intent = intents[0];
  assert.equal(intent.taskId, 't-fresh');
  assert.equal(intent.workerId, 'w-fresh');
  assert.equal(intent.sessionId, null, 'no resume handle exists — the retry is FRESH, never a fabricated session id');
  assert.equal(intent.sessionDir, null);
  assert.equal(intent.retry, null);
});

// ---------------------------------------------------------------------------
// R4/R5 — retry_pending parks: transition evidence vs evidence-less legacy
// ---------------------------------------------------------------------------

test('R4 RETRY PARK: a retry_pending orphan projects the parked transition\'s death-cert evidence + retry counters', () => {
  const { coordinator } = makeCoordinator();
  seedClaim(coordinator._coordination, 't-retry', 'w-retry', { retryEvidence: PARKED_EVIDENCE });
  appendOperational(coordinator, 'w-retry', 'lifecycle.spawned', { phase: 'spawn' });
  appendOperational(coordinator, 'w-retry', 'lifecycle.crashed', CRASH_CERT);

  const intents = coordinator.resumeOrphans({ liveWorkers: [] });
  const intent = intents.find((row) => row.taskId === 't-retry');
  assert.ok(intent, `the retry_pending park surfaces as an orphan (got ${JSON.stringify(intents.map((r) => r.taskId))})`);
  assert.equal(intent.workerId, 'w-retry');
  assert.equal(intent.sessionId, 'sess-retry-parked', 'the retry_pending transition evidence\'s deathCert names the resume handle');
  assert.equal(intent.sessionDir, '/iso/w-retry', 'the parked cert\'s session-file directory is the isolated session store');
  assert.deepEqual(intent.retry, { attempt: 2, of: 3 }, 'the parked retry counters ride the intent (attempt of budget)');
});

test('R5 EVIDENCE-LESS PARK: a retry_pending park without transition evidence projects sessionId null + retry null — never synthesized', () => {
  const { coordinator } = makeCoordinator();
  // A3b-style legacy store seed: parked retry_pending with NO evidence argument.
  seedClaim(coordinator._coordination, 't-bare', 'w-bare', { parkWithoutEvidence: true });

  const intents = coordinator.resumeOrphans({ liveWorkers: [] });
  const intent = intents.find((row) => row.taskId === 't-bare');
  assert.ok(intent, 'the evidence-less retry_pending task still surfaces as an orphan');
  assert.equal(intent.sessionId, null, 'no death cert was ever recorded — no resume handle is invented');
  assert.equal(intent.sessionDir, null);
  assert.equal(intent.retry, null, 'no retry accounting exists — no counters are invented');
});

// ---------------------------------------------------------------------------
// R6 — liveWorkers exclusion
// ---------------------------------------------------------------------------

test('R6 LIVE-WORKER EXCLUSION: live claims, unclaimed and terminal tasks never surface as resume intents', () => {
  const { coordinator } = makeCoordinator();
  const store = coordinator._coordination;
  // Dead-generation orphan with a cert (surfaces).
  seedClaim(store, 't-crash', 'w-crash');
  appendOperational(coordinator, 'w-crash', 'lifecycle.spawned', { phase: 'spawn' });
  appendOperational(coordinator, 'w-crash', 'lifecycle.crashed', CRASH_CERT);
  // Live claim (excluded), unclaimed (excluded), terminal (excluded).
  seedClaim(store, 't-live', 'w-live');
  seedClaim(store, 't-done', 'w-done');
  store.transitionTask('t-done', 'completed', 2, auth('pin:done:t-done'));
  store.createTask({
    id: 't-pending', brief: { objective: 'pin t-pending' }, deps: [], refines: null,
    runId: 'run:orphan-resume', taskType: 'general', reservedWorkerId: null,
    vendorRequested: 'stub', modelRequested: null, modelPolicy: null, effortRequested: null,
    sessionRequest: { mode: 'new' }, relation: 'general',
  }, auth('pin:create:t-pending'));

  const intents = coordinator.resumeOrphans({ liveWorkers: ['w-live'] });
  assert.deepEqual(intents.map((row) => row.taskId), ['t-crash'],
    `only the dead-generation claim projects (got ${JSON.stringify(intents.map((r) => r.taskId))})`);
  assert.equal(intents.some((row) => row.taskId === 't-live'), false, 'a claim held by a LIVE worker is not an orphan');
  assert.equal(intents.some((row) => row.taskId === 't-done'), false, 'a terminal task is not an orphan');
  assert.equal(intents.some((row) => row.taskId === 't-pending'), false, 'an unclaimed task is not an orphan');
});

// ---------------------------------------------------------------------------
// R7 — purity: no spawn, no durable append, no status mutation
// ---------------------------------------------------------------------------

test('R7 PURE PROJECTION: resumeOrphans never spawns, never appends, never mutates task status', () => {
  const { coordinator, coordination, spawnCalls } = makeCoordinator();
  const store = coordinator._coordination;
  seedClaim(store, 't-crash', 'w-crash');
  appendOperational(coordinator, 'w-crash', 'lifecycle.spawned', { phase: 'spawn' });
  appendOperational(coordinator, 'w-crash', 'lifecycle.crashed', CRASH_CERT);

  const beforeEvents = coordination.events().length;
  const beforeTasks = JSON.stringify(coordination.snapshot().tasks.map((task) => ({ id: task.id, status: task.status })));
  const intents = coordinator.resumeOrphans({ liveWorkers: [] });
  assert.equal(intents.length, 1, 'the projection answers');
  assert.equal(spawnCalls.length, 0, 'NO spawn is executed — resumeOrphans mints intents only');
  assert.equal(coordination.events().length, beforeEvents, 'NO durable coordination event is appended');
  assert.equal(JSON.stringify(coordination.snapshot().tasks.map((task) => ({ id: task.id, status: task.status }))),
    beforeTasks, 'task statuses are untouched — the projection is read-only');
});
