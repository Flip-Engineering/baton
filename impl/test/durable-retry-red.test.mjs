import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';

// Issue #201 — the durable member retry/session-restore contract (cross-ref #225 death certs,
// #228 omp rpc adapter, #163 no-clocks law). Pins the three seams at the adapter/coordinator/store
// level with fakes — NO real omp:
//
//   A1 adapter:     a crashed session with a persisted session-file carries its resume handle
//                   (sessionId, sessionFile) in the death-cert event — today it does not.
//   A2 coordinator: a task whose worker died WITH a death cert and retry authority transitions
//                   to 'retry_pending' carrying the evidence digest — NOT straight to 'failed'.
//   A3 store:       the successor incarnation replay (fresh store over the fixture ledger)
//                   surfaces orphaned claimed tasks (claimed by a dead generation) as
//                   reclaimable via orphans() — today no scan exists.
//
// Contract: docs/reference/evidence/durable-member-retry-2026-08-15/contract.md

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// A1 — the adapter death cert carries the resume handle
// ---------------------------------------------------------------------------

class FakeStream extends EventEmitter {
  setEncoding() { /* fake */ }
  write() { return true; }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new FakeStream();
    this.stdout = new FakeStream();
    this.stderr = new FakeStream();
    this.pid = 424242;
    this.killed = false;
    this.kill = (signal) => { this.killed = signal ?? true; };
  }
}

const READY = JSON.stringify({ type: 'ready', protocolVersion: 1 }) + '\n';

/** Fake omp child that answers get_session_stats over the rpc lane (the measured v17.3.4 shape:
 * response frames are `{id, type:'response', command, success, data}` with data carrying
 * {sessionId, sessionFile}). */
function sessionedChild({ sessionId = 'sess-a1b2c3', sessionFile = '/home/w/sess-a1b2c3.jsonl' } = {}) {
  const child = new FakeChild();
  const writes = [];
  child.stdin.write = (line) => {
    writes.push(line);
    let frame = null;
    try { frame = JSON.parse(line); } catch { return true; }
    if (frame?.type === 'get_session_stats') {
      setImmediate(() => {
        child.stdout.write(`${JSON.stringify({
          id: frame.id, type: 'response', command: 'get_session_stats', success: true,
          data: { sessionId, sessionFile, tokens: { input: 1, output: 1, total: 2 }, cost: 0 },
        })}\n`);
      });
    }
    return true;
  };
  return { child, writes };
}

function makeAdapter(child, { requestTimeoutMs = 1_000 } = {}) {
  const adapter = new OmpRpcCli({
    requestTimeoutMs,
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['low'] },
    spawnFn: () => child,
    versionProbe: () => 'omp test',
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  return { adapter, events };
}

test('A1 DEATH-CERT RESUME HANDLE: a crashed session with a persisted session-file carries sessionId + sessionFile on lifecycle.crashed', async () => {
  const { child, writes } = sessionedChild();
  const { adapter, events } = makeAdapter(child);
  const spawnArgs = [];
  const realAdapterSpawn = adapter.spawn.bind(adapter);
  // record argv through the process spawn seam (spawnFn only sees command/args)
  const spawnFn = adapter; // spawnFn is fixed at construction; capture argv via env of _args — instead assert flags below via a resume-mode spawn
  void spawnFn; void realAdapterSpawn; void spawnArgs;

  const outcome = await adapter.spawn('w-durable', { goal: 'g' }, {
    model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'low', worktree: '/tmp',
    processGeneration: 1, sessionDir: '/home/w/sessions',
  });
  assert.equal(outcome.ok, true);
  // the observation is fire-and-forget after ready; give the fake answer a tick to land
  await sleep(60);
  await adapter.prompt('w-durable', 'work', 'turn');
  child.emit('exit', 137, null);
  await sleep(60);

  const crash = events.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(crash, 'crash emitted on real process exit');
  assert.equal(crash.payload.exitCode, 137, 'the death cert names the exit code (#225)');
  assert.equal(crash.payload.phase, 'process_exit');
  assert.equal(crash.payload.sessionId, 'sess-a1b2c3', 'the death cert carries the persisted session id');
  assert.equal(crash.payload.sessionFile, '/home/w/sess-a1b2c3.jsonl', 'the death cert carries the session-file path');
  // the resume-handle discovery rode the rpc lane exactly once (one get_session_stats command)
  const statsCommands = writes.map((w) => { try { return JSON.parse(w); } catch { return null; } })
    .filter((f) => f?.type === 'get_session_stats');
  assert.equal(statsCommands.length, 1, 'exactly one get_session_stats observation per session');
});

test('A1b RESUME ARGV: spawn with options.session {id} resumes by session id; sessionDir pins the isolated session store', async () => {
  const { child, writes } = sessionedChild();
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 1_000,
    modelCatalog: { 'deepseek/deepseek-v4-flash': ['low'] },
    spawnFn: (command, args) => { writes.__argv = args; return child; },
    versionProbe: () => 'omp test',
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  const outcome = await adapter.spawn('w-resume', { goal: 'g' }, {
    model: 'deepseek/deepseek-v4-flash', reasoningEffort: 'low', worktree: '/tmp',
    processGeneration: 1,
    sessionDir: '/home/w/sessions',
    session: { id: 'sess-prior', mode: 'resume' },
  });
  assert.equal(outcome.ok, true);
  await sleep(60);
  const argv = writes.__argv ?? [];
  assert.ok(argv.includes('--resume'), `resume spawns pass --resume (argv=${JSON.stringify(argv)})`);
  assert.equal(argv[argv.indexOf('--resume') + 1], 'sess-prior', 'the resume flag carries the prior session id');
  assert.ok(argv.includes('--session-dir'), 'the isolated session store is pinned');
  assert.equal(argv[argv.indexOf('--session-dir') + 1], '/home/w/sessions');
});

// ---------------------------------------------------------------------------
// A2 — the coordinator retry_pending transition (evidence, not failure)
// ---------------------------------------------------------------------------

function stubAdapter(over = {}) {
  return {
    _cb: null,
    onEvent(cb) { this._cb = cb; },
    emit(e) { if (this._cb) this._cb(e); },
    card: () => ({
      harness: over.harness ?? 'stub',
      version: '1',
      authPostulse: 'subscription',
      authPosture: 'subscription',
      concurrencyCeiling: 4,
      maxContext: 1000,
      verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
      ...(over.card ?? {}),
    }),
    spawn: over.spawn ?? (async () => ({ ok: true })),
    prompt: async () => ({ ok: true }),
    interrupt: async () => ({ ok: true }),
    kill: async () => ({ ok: true, terminal: true }),
    approve: async () => ({ ok: true }),
    answer: async () => ({ ok: true }),
  };
}

function brief(goal) {
  return {
    goal,
    constraints: [],
    pathScope: ['**'],
    definitionOfDone: 'fake completes',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 1, wallMin: 5 },
  };
}

function makeCoordinator({ adapters, memberRetryAttempts } = {}) {
  const logDir = mkdtempSync(join(tmpdir(), 'durable-retry-log-'));
  const log = new Log(logDir, () => new Date().toISOString());
  const coordination = coordinationForLog(log);
  const worktrees = {
    create: async (taskId) => ({ path: mkdtempSync(join(tmpdir(), `durable-retry-wt-${taskId}-`)), branch: 'b', baseSha: 'x' }),
    capture: async () => ({ sha: 'deadbeef', snapshotted: false }),
    createVerifyWorktree: async () => ({ path: mkdtempSync(join(tmpdir(), 'durable-retry-vf-')) }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters, worktrees, repoRoot: tmpdir(),
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: (task, cards) => Object.keys(cards)[0],
    now: Date.now, approvalTimeoutMs: 2000, stopDeadlineMs: 2000,
    ...(memberRetryAttempts !== undefined ? { memberRetryAttempts } : {}),
  });
  return { coordinator, coordination, log, logDir };
}

const DEATH_CERT = Object.freeze({
  phase: 'process_exit',
  exitCode: 137,
  signal: null,
  error: 'omp rpc process exited during an active turn',
  sessionId: 'sess-a1b2c3',
  sessionFile: '/home/w/sessions/sess-a1b2c3.jsonl',
});

async function crashAfterSpawn(adapter, coordinator, coordination) {
  const h = await coordinator.spawn('v', brief('durable retry pin'));
  await sleep(30);
  const emit = (kind, payload) => adapter.emit({ worker: h.id, harness: 'stub', turnEpoch: 1, kind, actor: 'worker', payload });
  emit('lifecycle.spawned', { phase: 'spawn' });
  await sleep(10);
  emit('lifecycle.crashed', { ...DEATH_CERT });
  await sleep(60);
  const task = coordination.snapshot().tasks.find((t) => t.assignee === h.id || t.reservedWorkerId === h.id);
  return { h, task, handle: coordinator._workers.get(h.id) };
}

test('A2 RETRY_PENDING: a death-cert crash under retry authority transitions the task to retry_pending with the evidence digest — not failed', async () => {
  const adapter = stubAdapter({ card: { sessions: { multiTurn: 'native', resume: 'native', fork: 'unsupported' } } });
  const { coordinator, coordination } = makeCoordinator({ adapters: { v: adapter }, memberRetryAttempts: 1 });
  const { task, handle } = await crashAfterSpawn(adapter, coordinator, coordination);

  assert.ok(task, 'the spawned task exists durably');
  assert.equal(task.status, 'retry_pending',
    `a death-cert crash under retry authority must park the task retry_pending (got ${task?.status})`);

  const transition = coordination.events().find((e) => e.kind === 'task.transitioned'
    && e.payload?.id === task.id && e.payload?.to === 'retry_pending');
  assert.ok(transition, 'the retry_pending transition is durable');
  const evidence = transition.payload.evidence ?? {};
  assert.ok(Number.isSafeInteger(evidence.coordinationSeq), 'the transition cites the death event (evidence digest)');
  assert.equal(evidence.deathCert?.exitCode, 137, 'the evidence digest carries the death-cert exit code');
  assert.equal(evidence.deathCert?.sessionId, 'sess-a1b2c3', 'the evidence digest carries the resume handle');
  assert.equal(evidence.retry?.attempt, 1, 'the first admitted retry is attempt 1');
  assert.equal(task.status, 'failed', false === true ? 'unreachable' || task.status : task.status);

  const failed = coordination.events().find((e) => e.kind === 'task.transitioned'
    && e.payload?.id === task.id && e.payload?.to === 'failed');
  assert.equal(failed, undefined, 'no failed transition was minted for the death');

  assert.ok(handle?.sessionRef, 'the death cert binds the resume handle onto the worker sessionRef');
  assert.equal(handle.sessionRef.id, 'sess-a1b2c3');
  assert.equal(handle.sessionRef.persistence, 'native');
});

test('A2b DEFAULT-OFF: without retry authority the same death settles failed exactly as today (typed, never silent)', async () => {
  const adapter = stubAdapter({ card: { sessions: { multiTurn: 'native', resume: 'native', fork: 'unsupported' } } });
  const { coordinator, coordination } = makeCoordinator({ adapters: { v: adapter } });
  const { task } = await crashAfterSpawn(adapter, coordinator, coordination);
  assert.ok(task, 'the spawned task exists durably');
  assert.equal(task.status, 'failed', `no-authority death settles failed (got ${task?.status})`);
  const retrying = coordination.events().find((e) => e.kind === 'task.transitioned'
    && e.payload?.to === 'retry_pending');
  assert.equal(retrying, undefined, 'no retry_pending transition without authority');
});

// ---------------------------------------------------------------------------
// A3 — the successor-incarnation orphan scan
// ---------------------------------------------------------------------------

function orphanLedgerDir() {
  return mkdtempSync(join(tmpdir(), 'durable-retry-store-'));
}

function seedOrphanLedger(dir) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'durable-retry-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  const store = new CoordinationStore(dir, { repoId: 'repo-durable-retry', clock: () => '2026-08-15T00:00:00.000Z' });
  const auth = (key) => ({ actor: 'orchestrator', key });
  const mkTask = (id, worker) => store.createTask({
    id, brief: { objective: `pin ${id}` }, deps: [], refines: null, runId: 'run-orphans',
    taskType: 'general', reservedWorkerId: worker, vendorRequested: 'stub', modelRequested: null,
    modelPolicy: null, effortRequested: null, sessionRequest: { mode: 'new' }, relation: 'general',
  }, auth(`pin:create:${id}`));
  mkTask('t-orphan', 'w-orphan');
  store.claimTask('t-orphan', 'w-orphan', 1, auth('pin:claim:t-orphan'));
  store.recordWorkerGeneration({ workerId: 'w-orphan', taskId: 't-orphan', taskVersion: 2, runId: 'run-orphans', processGeneration: 3 }, { actor: 'hub', key: 'worker.generation_bound:w-orphan:3' });
  mkTask('t-live', 'w-live');
  store.claimTask('t-live', 'w-live', 1, auth('pin:claim:t-live'));
  mkTask('t-pending', null);
  mkTask('t-done', 'w-done');
  store.claimTask('t-done', 'w-done', 1, auth('pin:claim:t-done'));
  store.transitionTask('t-done', 'completed', 2, auth('pin:done:t-done'));
  return store;
}

test('A3 ORPHAN SCAN: the successor incarnation (fresh store replaying the ledger) surfaces claimed-by-dead-generation tasks as reclaimable', () => {
  const dir = orphanLedgerDir();
  seedOrphanLedger(dir);

  // THE SUCCESSOR: a brand-new store instance over the same durable ledger.
  const successor = new CoordinationStore(dir, { repoId: 'repo-durable-retry', clock: () => '2026-08-15T00:00:01.000Z' });

  // RED today: orphans is not a function — the scan does not exist.
  assert.equal(typeof successor.orphans, 'function', 'the store exposes the orphan reclaim scan');

  const rows = successor.orphans({ liveWorkers: ['w-live'] });
  assert.ok(Array.isArray(rows), 'orphans() returns rows');
  const ids = rows.map((row) => row.taskId).sort();
  assert.deepEqual(ids, ['t-orphan'], `only the dead-generation claim is reclaimable (got ${JSON.stringify(ids)})`);
  const orphan = rows.find((row) => row.taskId === 't-orphan');
  assert.equal(orphan.workerId, 'w-orphan');
  assert.equal(orphan.status, 'working');
  assert.equal(orphan.processGeneration, 3, 'the row carries the dead durable generation (worker.generation_bound)');
  // the live claim and the terminal/unclaimed tasks never surface
  assert.equal(rows.some((row) => row.taskId === 't-live'), false, 'a task claimed by a LIVE worker is not an orphan');
  assert.equal(rows.some((row) => row.taskId === 't-pending'), false, 'an unclaimed task is not an orphan');
  assert.equal(rows.some((row) => row.taskId === 't-done'), false, 'a terminal task is not an orphan');
});

test('A3b ORPHAN SCAN: retry_pending tasks are reclaimable too (the successor re-enters the same gate)', () => {
  const dir = orphanLedgerDir();
  const store = seedOrphanLedger(dir);
  store.transitionTask('t-orphan', 'retry_pending', 2, { actor: 'policy', key: 'pin:retry:t-orphan' });
  const successor = new CoordinationStore(dir, { repoId: 'repo-durable-retry', clock: () => '2026-08-15T00:00:02.000Z' });
  const rows = successor.orphans({ liveWorkers: [] });
  const orphan = rows.find((row) => row.taskId === 't-orphan');
  assert.ok(orphan, `a retry_pending task claimed by a dead generation is reclaimable (got ${JSON.stringify(rows.map((r) => r.taskId))})`);
  assert.equal(orphan.status, 'retry_pending');
});
