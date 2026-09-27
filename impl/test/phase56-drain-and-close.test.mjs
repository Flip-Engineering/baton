import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CoordinationStore, McpFleetServer, MockAdapter, WebNorthbound, createBrief, createDriver } from '../src/index.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPL = resolve(HERE, '..');
const RUN_EVIDENCE = join(IMPL, 'scripts', 'run-evidence.mjs');
const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const deferred = () => { let resolvePromise; const promise = new Promise((resolve) => { resolvePromise = resolve; }); return { promise, resolve: resolvePromise }; };
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase56-${label}-`));

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
}

function repo(label) {
  const world = root(label); const directory = join(world, 'repo'); mkdirSync(directory);
  git(['init', '-q'], directory); Object.assign(process.env, { GIT_AUTHOR_NAME: 'Baton Phase 56', GIT_COMMITTER_NAME: 'Baton Phase 56' }); Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'phase56@example.invalid', GIT_COMMITTER_EMAIL: 'phase56@example.invalid' });
  writeFileSync(join(directory, 'README.md'), '# fixture\n'); git(['add', 'README.md'], directory); git(['commit', '-qm', 'fixture'], directory);
  return { world, directory, logDir: join(world, 'log') };
}

function brief(goal = 'hold') {
  return createBrief({
    goal, constraints: [], pathScope: ['README.md'], definitionOfDone: 'stopped by drain',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10_000, usd: 1, wallMin: 5 },
  });
}

async function until(fn, label, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(5); }
  throw new Error(`timeout waiting for ${label}`);
}

/** The coordination ledger's own settlement event for each task — never a wall-clock completion
 *  budget. `waitAfter` wakes on the next durable append; a wake without a terminal status simply
 *  re-checks, so a loaded machine delays the observation instead of failing it. */
async function settledTasks(driver, taskIds) {
  const terminal = new Set(['completed', 'failed', 'cancelled']);
  for (;;) {
    const tasks = taskIds.map((id) => driver.coordination.task(id));
    if (tasks.every((task) => task && terminal.has(task.status))) return tasks;
    await driver.coordination.waitAfter(driver.coordination.eventCursor(), 250);
  }
}

function drainReceipt(overrides = {}) {
  const core = {
    schemaVersion: 1, state: 'drained', scope: 'local-controller', repoId: 'repo-a',
    targetCount: 0, remainingCount: 0, targetDigest: digest([]),
    counts: { pendingCancelled: 0, killConfirmed: 0, alreadyTerminal: 0, processesObserved: 0, processesClosed: 0 },
    checks: { admissionClosed: true, authorityOpsDrained: true, stopWaitersDrained: true, cleanupDrained: true, localWorkerAuthorityReleased: true },
    effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
    ...overrides,
  };
  return Object.freeze({ ...core, receiptDigest: digest(core) });
}

test('DC1: drain policy is closed and bounded before writer admission', async (t) => {
  const valid = repo('policy-valid'); let driver; t.after(() => { try { driver?.close(); } catch {} rmSync(valid.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: valid.directory, logDir: valid.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  assert.equal(typeof driver.drainAndClose, 'function');
  assert.throws(() => createDriver({ repoRoot: valid.directory, logDir: join(valid.world, 'unknown'), repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5, path: '/tmp/forged' } }), /drain policy/i);
  assert.throws(() => createDriver({ repoRoot: valid.directory, logDir: join(valid.world, 'max'), repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 100_001, timeoutMs: 1_000, pollMs: 5 } }), /drain policy/i);
  const receipt = await driver.drainAndClose(); assert.equal(receipt.state, 'closed');
});

test('DC2-DC7: one drain cancels pending work, kill-confirms active work, fences effects, and exactly closes the writer', async (t) => {
  const f = repo('driver'); let driver; t.after(async () => {
    try { for (const row of driver?.coordinator.list?.() ?? []) await driver.coordinator.kill(row.id); } catch {}
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ concurrencyCeiling: 1, scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  let nativeKills = 0; const kill = adapter.kill.bind(adapter); adapter.kill = async (...args) => { nativeKills += 1; return kill(...args); };
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 2, timeoutMs: 5_000, pollMs: 5 }, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const active = await driver.coordinator.spawn('mock', brief('active'), { taskId: 'active' });
  const pending = await driver.coordinator.spawn('mock', brief('pending'), { taskId: 'pending' });
  await until(() => driver.coordinator.list().find((row) => row.id === active.id)?.status === 'working', 'active worker');
  assert.equal(driver.coordinator.list().find((row) => row.id === pending.id)?.status, 'pending');
  assert.throws(() => driver.coordinator.closeAuthority(), (error) => error.code === 'coordinator_not_drained');
  assert.equal(driver.coordinator._drainState, 'open', 'a refused legacy close cannot fence later drain authority');

  const first = driver.drainAndClose(); const second = driver.drainAndClose();
  assert.equal(first, second, 'concurrent close callers share the exact Promise');
  await assert.rejects(driver.coordinator.kill(active.id), (error) => error.code === 'coordinator_draining');
  await assert.rejects(driver.coordinator.spawn('mock', brief('late'), { taskId: 'late' }), (error) => error.code === 'coordinator_draining');
  const readDuringDrain = driver.coordinator.result(active.id);
  assert.equal(driver.coordinator.list().length, 2); assert.ok(Array.isArray(driver.coordinator.capabilityCards()));
  assert.equal((await readDuringDrain).taskId, 'active');
  const receipt = await first;
  assert.equal(nativeKills, 1, 'pending work never reaches the adapter kill path');
  assert.equal(receipt.state, 'closed'); assert.equal(receipt.fleet.state, 'drained');
  assert.equal(receipt.fleet.targetCount, 2); assert.equal(receipt.fleet.counts.pendingCancelled, 1); assert.equal(receipt.fleet.counts.killConfirmed, 1);
  assert.deepEqual(receipt.authority, { coordinatorClosed: true, writerReleased: true });
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'wt', 'active')), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'wt', 'pending')), false);
  assert.equal(git(['branch', '--list', 'baton/active'], f.directory), '');
  assert.equal(git(['branch', '--list', 'baton/pending'], f.directory), '');
  assert.equal(driver.drainAndClose(), first, 'a completed close returns its memoized Promise');
  assert.deepEqual(await driver.drainAndClose(), receipt);
  assert.equal(JSON.stringify(receipt).includes(f.world), false);
});

test('DC4: linked-worktree controllers start and drain without reconciling each other\'s live branch authority', async (t) => {
  const world = root('controller-isolation'); const main = join(world, 'main'); mkdirSync(main);
  git(['init', '-q'], main); Object.assign(process.env, { GIT_AUTHOR_NAME: 'Baton Phase 56', GIT_COMMITTER_NAME: 'Baton Phase 56' }); Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'phase56@example.invalid', GIT_COMMITTER_EMAIL: 'phase56@example.invalid' });
  writeFileSync(join(main, 'README.md'), '# fixture\n'); git(['add', 'README.md'], main); git(['commit', '-qm', 'fixture'], main);
  const sha = git(['rev-parse', 'HEAD'], main); const controllerA = join(world, 'controller-a'); const controllerB = join(world, 'controller-b');
  git(['worktree', 'add', '--detach', controllerA, sha], main); git(['worktree', 'add', '--detach', controllerB, sha], main);
  let driverA; let driverB;
  t.after(async () => {
    try { await driverB?.closeAsync(); } catch {}
    try { await driverA?.closeAsync(); } catch {}
    rmSync(world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driverA = createDriver({ repoRoot: controllerA, logDir: join(world, 'log-a'), repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 5_000, pollMs: 5 }, watchdog: { stallMs: 60_000 } }); // valid positive stallMs; watchdog never fires in this window
  const worker = await driverA.coordinator.spawn('mock', brief('controller A live work'), { taskId: 'controller-a-live' });
  await until(() => driverA.coordinator.list().find((row) => row.id === worker.id)?.status === 'working', 'controller A worker');
  const liveContext = await until(() => driverA.coordinator.list().find((row) => row.id === worker.id)?.sessionContext, 'controller A workspace');
  const livePath = liveContext.worktree;
  driverB = createDriver({ repoRoot: controllerB, logDir: join(world, 'log-b'), repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 5_000, pollMs: 5 } });
  await driverB.ready;
  assert.equal(existsSync(livePath), true);
  assert.equal(git(['branch', '--list', liveContext.branch, '--format=%(refname:short)'], controllerB), liveContext.branch);
  assert.equal((await driverB.drainAndClose()).state, 'closed');
  assert.equal(existsSync(livePath), true);
  assert.equal(git(['branch', '--list', liveContext.branch, '--format=%(refname:short)'], controllerB), liveContext.branch);
  assert.equal((await driverA.drainAndClose()).state, 'closed');
  assert.equal(existsSync(livePath), false);
  assert.equal(git(['branch', '--list', liveContext.branch], controllerA), '');
});

test('DC4: drain cannot attest while worktree creation or native spawn remains pending', async (t) => {
  const f = repo('late-spawn-boundary'); let driver; const worktreeGate = deferred(); const spawnGate = deferred();
  t.after(() => { worktreeGate.resolve(); spawnGate.resolve(); try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = async (...args) => { const ack = await nativeSpawn(...args); await spawnGate.promise; return ack; };
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 }, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  await driver.ready;
  // The subject is the drain's pending-boundary attestation, not the cost of `git worktree`: the
  // fixture checkout materializes and reaps under the gates (the legacy/embedder create+remove
  // shape, so progress preservation is 'unsupported' rather than a second real git effect), and
  // the gate release — never a git race against the deployment deadline — ends the wait. The real
  // reap is DC2-DC7's and the historical-residue row's subject, whose budgets cover it.
  const checkout = join(f.directory, '.baton', 'wt', 'late-boundaries');
  let created = false; let earlyRemovals = 0; let lateRemovals = 0;
  driver.coordinator._worktrees = {
    create: async (taskId) => {
      await worktreeGate.promise;
      mkdirSync(checkout, { recursive: true });
      created = true;
      return { path: checkout, branch: `baton/${taskId}`, baseSha: 'sha-base' };
    },
    remove: async () => {
      if (!created) { earlyRemovals += 1; return; }
      lateRemovals += 1;
      rmSync(checkout, { recursive: true, force: true });
    },
  };
  const worker = await driver.coordinator.spawn('mock', brief('late boundaries'), { taskId: 'late-boundaries' });
  await until(() => driver.coordinator._workers.get(worker.id)?.nativeSpawnPending === true, 'native spawn reservation');
  let settled = false; const closing = driver.drainAndClose().finally(() => { settled = true; });
  await until(() => earlyRemovals > 0, 'early stop cleanup');
  assert.equal(settled, false, 'the drain cannot attest while a target boundary is pending'); assert.equal(driver.coordinator._workers.get(worker.id).worktreeCreationPending, true);
  assert.equal(driver.coordinator._workers.get(worker.id).nativeSpawnPending, true);
  worktreeGate.resolve(); spawnGate.resolve();
  const receipt = await closing;
  assert.equal(receipt.state, 'closed'); assert.ok(lateRemovals > 0, 'late-created checkout is reaped before attestation');
  assert.equal(existsSync(checkout), false);
  assert.equal(git(['branch', '--list', 'baton/late-boundaries'], f.directory), '');
});

test('DC4: a process start after spawn Ack is refused and re-acquired, and the refusal kills nothing', async (t) => {
  const f = repo('late-process-start'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 }, watchdog: { stallMs: 60_000 } }); // valid positive stallMs; watchdog never fires in this window
  const worker = await driver.coordinator.spawn('mock', brief('late native start'), { taskId: 'late-process-start' });
  await until(() => driver.coordinator._workers.get(worker.id)?.nativeSpawnPending === false && adapter._sessions.has(worker.id), 'spawn Ack boundary');
  const session = adapter._sessions.get(worker.id); const generation = session.opts.processGeneration;
  adapter._emit(session, 'lifecycle.process_started', { schemaVersion: 1, generation, pid: 424242, processGroupId: 424242, phase: 'initializing' });
  assert.equal(driver.coordinator._workers.get(worker.id).processRef?.state, 'initializing');
  adapter._emit(session, 'lifecycle.process_closed', { schemaVersion: 1, generation, pid: 424242, processGroupId: 424242, code: null, signal: 'SIGKILL', ready: false });
  await until(() => driver.coordinator._workers.get(worker.id)?.processRef?.state === 'closed', 'refused late start close');
  const events = driver.log.read(worker.id);
  assert.equal(events.some((event) => event.kind === 'lifecycle.process_attribution_refused' && event.payload.code === 'invalid_process_start'), true);
  assert.equal(events.some((event) => event.kind === 'lifecycle.process_started'), false);
  assert.equal(driver.coordinator._workers.get(worker.id).processRef.state, 'closed');
  assert.equal(events.some((event) => event.kind === 'kill.requested'), false,
    'issue #611: the refused start is recorded and kills nothing');
  assert.equal((await driver.drainAndClose()).state, 'closed');
});

test('DC4: drain reconciles historical worktree, branch, metadata, and runtime residue outside live handles', async (t) => {
  const f = repo('historical-residue'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 } });
  await driver.ready;
  const worktree = await driver.coordinator._worktrees.create('historical');
  driver.coordinator._runtimeScopes.create('historical', 'mock');
  assert.equal(existsSync(worktree.path), true); assert.equal(git(['branch', '--list', worktree.branch, '--format=%(refname:short)'], f.directory), worktree.branch);
  const receipt = await driver.drainAndClose();
  assert.equal(receipt.state, 'closed'); assert.equal(existsSync(worktree.path), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'wt', `${worktree.ownerTaskId}.meta.json`)), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'runtime', 'historical')), false);
  assert.equal(git(['branch', '--list', worktree.branch], f.directory), '');
});

test('DC2/DC4: drain policy-resolves pending interaction and publication authority and discards late asks', async (t) => {
  const f = repo('pending-authority'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 }, watchdog: { stallMs: 60_000 } }); // valid positive stallMs; watchdog never fires in this window
  // The row proves pending interaction/publication authority resolution and late-ask discard, not
  // the cost of a live stop: a deterministic checkout double keeps the reap inside the drain's
  // deployment budget (DC2-DC7 proves the real reap).
  const checkout = join(f.directory, '.baton', 'wt', 'pending-authority');
  driver.coordinator._worktrees = {
    create: async (taskId) => { mkdirSync(checkout, { recursive: true }); return { path: checkout, branch: `baton/${taskId}`, baseSha: 'sha-base' }; },
    remove: async () => { rmSync(checkout, { recursive: true, force: true }); },
    reconcile: async () => ({}),
  };
  const worker = await driver.coordinator.spawn('mock', brief('pending authority'), { taskId: 'pending-authority' });
  await until(() => driver.coordinator.list().find((row) => row.id === worker.id)?.status === 'working', 'pending-authority worker');
  const handle = driver.coordinator._workers.get(worker.id);
  for (const [requestId, kind] of [['question-pending', 'question'], ['approval-pending', 'approval'], ['publication-pending', 'publication']]) {
    driver.coordinator._pending.set(requestId, { worker: worker.id, kind, state: 'pending', consumer: null, resolution: null });
    driver.coordinator._activeInteractionIds.add(requestId);
  }
  handle.pendingQuestionId = 'question-pending'; handle.pendingApprovalId = 'approval-pending';
  const closing = driver.drainAndClose();
  adapter._emit(adapter._sessions.get(worker.id), 'question.asked', { requestId: 'late-question', blocking: true });
  const receipt = await closing; assert.equal(receipt.state, 'closed');
  assert.deepEqual(driver.coordinator._pending.get('question-pending').resolution, { decision: 'cancel', reason: 'fleet_drain' });
  assert.deepEqual(driver.coordinator._pending.get('approval-pending').resolution, { decision: 'cancel', reason: 'fleet_drain' });
  assert.deepEqual(driver.coordinator._pending.get('publication-pending').resolution, { decision: 'deny', reason: 'fleet_drain' });
  assert.equal(driver.coordinator._pending.has('late-question'), false);
  assert.equal(driver.log.read(worker.id).some((event) => event.kind === 'control.drain_interaction_discarded'), true);
});

test('DC1/DC5: max+1 refuses before fencing and an exact retry can still close', async (t) => {
  const f = repo('max-plus-one'); let driver; t.after(async () => { try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  // This row proves capacity-before-fencing and the exact retry close: the workers run the real
  // pipeline to a durable settlement first, and the reap of their checkouts is deterministic here
  // (DC2-DC7 proves the physical reap — real `git worktree` cost outlives any fixed drain budget
  // under load, and that budget is not what this row asserts).
  driver.coordinator._worktrees.remove = async () => {};
  driver.coordinator._worktrees.reconcile = async () => ({});
  await driver.coordinator.spawn('mock', brief('one'), { taskId: 'one' }); await driver.coordinator.spawn('mock', brief('two'), { taskId: 'two' });
  await settledTasks(driver, ['one', 'two']);
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordinator_drain_capacity');
  assert.equal(driver.coordinator.list().length, 2, 'capacity refusal occurs before admission closes');
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), true);
  driver.coordinator._drainPolicy = Object.freeze({ maxWorkers: 2, timeoutMs: 1_000, pollMs: 5 });
  const receipt = await driver.drainAndClose(); assert.equal(receipt.state, 'closed');
});

test('DC1/DC5: active interaction max+1 refuses before fencing without scanning historical records', async (t) => {
  const f = repo('interaction-max-plus-one'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  await driver.ready;
  for (let index = 0; index < 17; index += 1) {
    const requestId = `bounded-${index}`; driver.coordinator._pending.set(requestId, { worker: 'historical', kind: 'question', state: 'pending' }); driver.coordinator._activeInteractionIds.add(requestId);
  }
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordinator_drain_capacity');
  assert.equal(driver.coordinator._drainState, 'open');
  driver.coordinator._activeInteractionIds.clear();
  const receipt = await driver.drainAndClose(); assert.equal(receipt.state, 'closed');
});

test('DC4/DC5: a hung cleanup is deadline-bounded, stays red, and retains writer authority', async (t) => {
  const f = repo('hung-cleanup'); let driver; t.after(() => {
    try { driver?.coordination.releaseWriterLease(); } catch {}
    rmSync(f.world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 1, timeoutMs: 40, pollMs: 5 }, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
  });
  const handle = await driver.coordinator.spawn('mock', brief('hung cleanup'), { taskId: 'hung-cleanup' });
  await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.status === 'working', 'hung-cleanup worker');
  driver.coordinator._worktrees.remove = () => new Promise(() => {});
  // The bound is the drain's own deployment deadline — named, with the hung worker on the wait —
  // never a stopwatch racing how fast the machine happens to be.
  const failure = await driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'hung-cleanup' }).catch((error) => error);
  assert.equal(failure?.code, 'coordinator_drain_incomplete');
  assert.equal(failure.detail?.reason, 'deadline', 'the refusal names the deadline that bounded the cleanup');
  assert.equal(failure.detail?.timeoutMs, 40, 'the bound is the deployment drain policy, not a test budget');
  assert.deepEqual(failure.detail?.waitingOn?.map((row) => row.workerId), [handle.id], 'the wait names the hung worker');
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), true);
  assert.equal(driver.coordinator._workers.get(handle.id).localAuthority, true);
});

test('DC5: synchronous durable admission crossing the deadline is red and retryable, never late success', async (t) => {
  const f = repo('slow-admission'); const coordinationDir = root('slow-admission-coordination'); const coordination = new CoordinationStore(coordinationDir); let driver;
  t.after(() => { try { coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); rmSync(coordinationDir, { recursive: true, force: true }); });
  const admit = coordination.admitFleetDrain.bind(coordination); let delayed = true;
  coordination.admitFleetDrain = (...args) => { if (delayed) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_150); return admit(...args); };
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', coordination, adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const started = Date.now();
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordinator_drain_incomplete');
  assert.ok(Date.now() - started >= 1_100); assert.equal(existsSync(coordination._writerLease.path), true);
  // #277 G-2: a deadline hit at admission fences nothing — no physical drain exists that could
  // clear a latched state, so the coordinator stays open and the retry replays the admission.
  assert.equal(driver.coordinator._drainState, 'open');
  delayed = false; coordination.admitFleetDrain = admit;
  assert.equal((await driver.drainAndClose()).state, 'closed');
});

test('DC4/DC5: a timed-out historical reconciliation remains owned and retries join it', async (t) => {
  const f = repo('historical-reconcile-timeout'); let driver; const gate = deferred();
  t.after(() => { gate.resolve(); try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  await driver.ready; let reconciliations = 0; let lateMutation = false;
  driver.coordinator._worktrees.reconcile = async () => { reconciliations += 1; await gate.promise; lateMutation = true; };
  // Only the first attempt runs on a shrink-to-40ms deadline — proof that a timeout retains the
  // cleanup it could not finish. The retry then keeps the deployment policy's own budget and the
  // gate, not a wall clock, decides when it can converge.
  driver.coordinator._drainPolicy = Object.freeze({ maxWorkers: 1, timeoutMs: 40, pollMs: 5 });
  await assert.rejects(
    driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'historical-timeout' }),
    (error) => error.code === 'coordinator_drain_incomplete' && error.detail?.reason === 'historical_reconciliation_pending',
  );
  driver.coordinator._drainPolicy = Object.freeze({ maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 });
  assert.equal(reconciliations, 1); assert.equal(lateMutation, false); assert.ok(driver.coordinator._drainHistoricalReconcilePromise);
  const retained = driver.coordinator._drainHistoricalReconcilePromise;
  let settled = false; const closing = driver.drainAndClose().finally(() => { settled = true; });
  await until(() => driver.coordinator._drainState === 'draining' && driver.coordinator._drainPromise !== null, 'retry drain joins the held cleanup');
  assert.equal(settled, false, 'the retry cannot attest while the retained cleanup is pending');
  assert.equal(driver.coordinator._drainHistoricalReconcilePromise, retained, 'the retry joins the original cleanup rather than starting a second mutation');
  assert.equal(reconciliations, 1);
  gate.resolve(); const receipt = await closing;
  assert.equal(receipt.state, 'closed'); assert.equal(lateMutation, true); assert.equal(reconciliations, 1);
});

for (const [label, retryKey] of [['same identity', 'disposition-first'], ['new identity', 'disposition-second']]) {
  test(`DC5/DC6: ${label} retry preserves the durable kill disposition across a later timeout`, async (t) => {
    const f = repo(`disposition-${retryKey}`); const gate = deferred(); let driver;
    t.after(() => { gate.resolve(); try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
    const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
    let nativeKills = 0; const nativeKill = adapter.kill.bind(adapter); adapter.kill = async (...args) => { nativeKills += 1; return nativeKill(...args); };
    driver = createDriver({
      repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
      drainPolicy: { maxWorkers: 1, timeoutMs: 100, pollMs: 5 }, watchdog: { stallMs: 60_000 }, // valid positive stallMs; watchdog never fires in this window
    });
    await driver.ready;
    // The row proves the durable kill disposition across a timeout, so the live stop it drives must
    // not race the 100 ms attempt budget against real `git worktree` reap cost: the fixture checkout
    // reaps deterministically (DC2-DC7 proves the real reap).
    const checkout = join(f.directory, '.baton', 'wt', `disposition-${retryKey}`);
    driver.coordinator._worktrees = {
      create: async (taskId) => { mkdirSync(checkout, { recursive: true }); return { path: checkout, branch: `baton/${taskId}`, baseSha: 'sha-base' }; },
      remove: async () => { rmSync(checkout, { recursive: true, force: true }); },
      reconcile: async () => ({}),
    };
    const reconcile = driver.coordinator._worktrees.reconcile.bind(driver.coordinator._worktrees); let reconciliations = 0;
    driver.coordinator._worktrees.reconcile = async (...args) => { reconciliations += 1; await gate.promise; return reconcile(...args); };
    const handle = await driver.coordinator.spawn('mock', brief('durable disposition'), { taskId: `disposition-${retryKey}` });
    await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.status === 'working', 'durable-disposition worker');
    await assert.rejects(driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'disposition-first' }), (error) => error.code === 'coordinator_drain_incomplete');
    assert.equal(nativeKills, 1); assert.equal(driver.coordinator._workers.get(handle.id).localAuthority, false);
    assert.equal(driver.log.read(handle.id).filter((event) => event.kind === 'kill.confirmed').length, 1);
    const physical = driver.coordination.fleetDrain(driver.coordinator._drainPhysicalId);
    assert.deepEqual(physical.dispositions, [{ workerId: handle.id, disposition: 'killConfirmed' }]);
    let settled = false;
    driver.coordinator._drainPolicy = Object.freeze({ ...driver.coordinator._drainPolicy, timeoutMs: 1_000 });
    const retry = driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: retryKey }).finally(() => { settled = true; });
    await sleep(10); assert.equal(settled, false); assert.equal(nativeKills, 1); assert.equal(reconciliations, 1);
    gate.resolve(); const receipt = await retry;
    assert.equal(receipt.targetCount, 1); assert.equal(receipt.counts.killConfirmed, 1); assert.equal(receipt.counts.alreadyTerminal, 0);
    assert.equal(nativeKills, 1); assert.equal(reconciliations, 1);
  });
}

test('DC5/DC7: driver close can retry exact writer release after coordinator authority closed', async (t) => {
  const f = repo('driver-writer-retry'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const owned = driver.coordination._writerLease;
  const releaseWriterLease = driver.coordination.releaseWriterLease.bind(driver.coordination);
  driver.coordination.releaseWriterLease = (options) => {
    if (options?.requireOwned === true) writeFileSync(owned.path, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'replacement', acquiredAt: new Date().toISOString() })}\n`);
    return releaseWriterLease(options);
  };
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordination_writer_lost');
  driver.coordination.releaseWriterLease = releaseWriterLease;
  writeFileSync(owned.path, `${JSON.stringify({ schemaVersion: 1, pid: owned.pid, token: owned.token, acquiredAt: new Date().toISOString() })}\n`);
  const receipt = await driver.drainAndClose();
  assert.equal(receipt.state, 'closed'); assert.equal(receipt.authority.writerReleased, true); assert.equal(existsSync(owned.path), false);
});

test('DC7: each driver incarnation owns a fresh nested drain and closes after restart', async (t) => {
  const f = repo('driver-restart'); let first; let second; t.after(() => { try { first?.coordination.releaseWriterLease(); } catch {} try { second?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  first = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const one = await first.drainAndClose('host:first'); assert.equal(one.state, 'closed');
  second = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const two = await second.drainAndClose();
  assert.equal(two.state, 'closed'); assert.equal(two.authority.coordinatorClosed, true); assert.equal(two.authority.writerReleased, true);
  assert.notEqual(two.fleet.receiptDigest, undefined);
});

test('DC7: a direct-only driver without an explicit northbound repo ID drains under a fixed local identity', async (t) => {
  const f = repo('driver-local-id'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const receipt = await driver.drainAndClose();
  assert.equal(receipt.state, 'closed'); assert.equal(receipt.fleet.repoId, 'local');
});

test('DC2/DC6: identical direct drain callers share the exact request Promise', async (t) => {
  const f = repo('direct-promise'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const ctx = { actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'direct-promise' };
  const first = driver.coordinator.drain(ctx); const second = driver.coordinator.drain(ctx);
  assert.equal(first, second); assert.equal((await first).state, 'drained');
});

test('DC6: direct in-flight and completed drain replay is bound to the original actor', async (t) => {
  const f = repo('direct-actor'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const original = { actor: 'orchestrator:first', repoId: 'repo-a', idempotencyKey: 'actor-bound' };
  const first = driver.coordinator.drain(original);
  assert.throws(() => driver.coordinator.drain({ ...original, actor: 'orchestrator:second' }), (error) => error.code === 'coordinator_drain_incomplete');
  assert.equal((await first).state, 'drained');
  assert.throws(() => driver.coordinator.drain({ ...original, actor: 'orchestrator:second' }), (error) => error.code === 'coordinator_drain_incomplete');
  assert.deepEqual(await driver.coordinator.drain(original), await first);
});

test('DC6/DC7: replaying a completed old drain cannot capture a fresh controller physical epoch', async (t) => {
  const f = repo('completed-replay-epoch'); let first; let second;
  t.after(() => { try { first?.coordination.releaseWriterLease(); } catch {} try { second?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const old = { actor: 'orchestrator:old', repoId: 'repo-a', idempotencyKey: 'completed-old' };
  first = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  const oldReceipt = await first.coordinator.drain(old); assert.equal(oldReceipt.state, 'drained');
  assert.equal(first.coordinator.closeAuthority(), true); assert.equal(first.coordination.releaseWriterLease({ requireOwned: true }), true);
  second = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  assert.equal((await second.coordinator.drain(old)).state, 'drained');
  assert.equal(second.coordinator._drainPhysicalId, null); assert.equal(second.coordinator._drainState, 'open');
  const closed = await second.drainAndClose('orchestrator:fresh');
  assert.equal(closed.state, 'closed'); assert.equal(closed.fleet.receiptDigest, oldReceipt.receiptDigest, 'path-free empty-fleet receipts may be value-identical');
  const admissions = second.coordination.events().filter((event) => event.kind === 'fleet.drain_admitted');
  assert.equal(admissions.length, 2); assert.notEqual(admissions[0].payload.drainId, admissions[1].payload.drainId);
});

test('DC4/DC7: startup reconciliation failure can never become a drain attestation', async (t) => {
  const f = repo('startup-cleanup-red'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {},
    runtimeScopes: { reconcile() { throw new Error('private cleanup detail'); }, remove() {}, create() { return null; } },
    drainPolicy: { maxWorkers: 1, timeoutMs: 100, pollMs: 5 },
  });
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordinator_drain_incomplete' && !String(error.message).includes('private cleanup detail'));
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), true);
});

test('DC6: nested drain admission/completion is replay-validated and constant-shape', (t) => {
  const directory = root('durable'); t.after(() => rmSync(directory, { recursive: true, force: true })); const store = new CoordinationStore(directory, { clock: () => new Date(NOW).toISOString() });
  const targetWorkerIds = ['w-1', 'w-2']; const targetDigest = digest(targetWorkerIds); const requestDigest = digest({ repoId: 'repo-a', idempotencyKey: 'direct-1' });
  const fields = { schemaVersion: 1, drainId: `fleet-drain:${requestDigest}`, repoId: 'repo-a', requestDigest, targetWorkerIds, targetDigest };
  const auth = { actor: 'orchestrator', key: 'fleet.drain:direct-1' };
  assert.equal(store.admitFleetDrain(fields, auth).result, 'admitted');
  assert.throws(() => store.admitFleetDrain(fields, { ...auth, actor: 'different-actor' }), (error) => error.code === 'fleet_drain_conflict');
  assert.throws(() => store.completeFleetDrain(fields.drainId, drainReceipt({ targetCount: 2, targetDigest }), { actor: 'orchestrator', key: 'fleet.drain.complete:direct-1' }), (error) => error.code === 'fleet_drain_integrity');
  for (const workerId of targetWorkerIds) {
    const key = `fleet.drain.disposition:${digest({ drainId: fields.drainId, workerId })}`;
    assert.equal(store.recordFleetDrainDisposition(fields.drainId, workerId, 'alreadyTerminal', { actor: 'orchestrator', key }).result, 'recorded');
  }
  assert.throws(() => store.recordFleetDrainDisposition(fields.drainId, 'w-1', 'killConfirmed', {
    actor: 'orchestrator', key: `fleet.drain.disposition:${digest({ drainId: fields.drainId, workerId: 'w-1' })}`,
  }), (error) => error.code === 'fleet_drain_conflict');
  const receipt = drainReceipt({ targetCount: 2, targetDigest, counts: { pendingCancelled: 0, killConfirmed: 0, alreadyTerminal: 2, processesObserved: 0, processesClosed: 0 } });
  assert.equal(store.completeFleetDrain(fields.drainId, receipt, { actor: 'orchestrator', key: 'fleet.drain.complete:direct-1' }).result, 'completed');
  assert.deepEqual(store.fleetDrain(fields.drainId).receipt, receipt);
  store.releaseWriterLease({ requireOwned: true });
  const replay = new CoordinationStore(directory); assert.deepEqual(replay.fleetDrain(fields.drainId).receipt, receipt); replay.releaseWriterLease({ requireOwned: true });
});

test('DC5/DC7: strict writer release never deletes or blesses a replacement lease', (t) => {
  const directory = root('writer'); t.after(() => rmSync(directory, { recursive: true, force: true })); const store = new CoordinationStore(directory); const owned = store.claimWriterLease();
  writeFileSync(owned.path, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'replacement', acquiredAt: new Date().toISOString() })}\n`);
  assert.throws(() => store.releaseWriterLease({ requireOwned: true }), (error) => error.code === 'coordination_writer_lost');
  assert.equal(JSON.parse(readFileSync(owned.path, 'utf8')).token, 'replacement');
  writeFileSync(owned.path, `${JSON.stringify({ schemaVersion: 1, pid: owned.pid, token: owned.token, acquiredAt: new Date().toISOString() })}\n`);
  assert.equal(store.releaseWriterLease({ requireOwned: true }), true); assert.equal(existsSync(owned.path), false);
});

const webPrincipal = (capabilities = ['observe', 'emergency_stop'], sessionId = 'session-1') => ({
  userId: 'user-1', sessionId, credentialId: `credential-${sessionId}`, authMethod: 'cookie', csrfToken: 'csrf-1',
  capabilities, repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
});
const webContext = (principal = webPrincipal()) => ({ principal, origin: 'https://control.example.test', csrfToken: 'csrf-1', remoteAddress: '127.0.0.1', transport: 'https' });
const webDrain = (overrides = {}) => ({
  schemaVersion: 1, commandId: 'drain-command-1', idempotencyKey: 'drain-idem-1', command: 'drain', args: {}, repoId: 'repo-a', origin: 'https://control.example.test', ...overrides,
});

test('DC8/DC10: authenticated web drain is closed, joins admitted replay, and never closes transport/writer authority', async (t) => {
  const directory = root('web'); const coordination = new CoordinationStore(directory); const receipt = drainReceipt();
  let calls = 0; let release; const gate = new Promise((resolveGate) => { release = resolveGate; });
  t.after(() => { release(); try { coordination.releaseWriterLease(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  const coordinator = { async drain(ctx) { calls += 1; assert.deepEqual(ctx, { actor: 'web:user-1:session-1', repoId: 'repo-a', idempotencyKey: 'web.command:drain-command-1' }); await gate; return receipt; } };
  const web = new WebNorthbound({ coordinator, coordination, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => NOW });
  const first = web.execute(webContext(), webDrain()); await until(() => coordination.events().some((event) => event.kind === 'web.command_admitted'), 'web drain admission');
  const second = web.execute(webContext(), webDrain({ commandId: 'drain-command-retry' }));
  await sleep(20); release();
  const [one, two] = await Promise.all([first, second]); assert.equal(one.status, 200); assert.equal(two.status, 200); assert.equal(calls, 1);
  assert.deepEqual(one.body.result, receipt); assert.deepEqual(two.body.result, receipt); assert.equal(two.body.replayed, true);
  const forbidden = await web.execute(webContext(webPrincipal(['observe'])), webDrain({ commandId: 'drain-forbidden', idempotencyKey: 'drain-forbidden' })); assert.equal(forbidden.status, 403);
  const unknown = await web.execute(webContext(), webDrain({ commandId: 'drain-unknown', idempotencyKey: 'drain-unknown', args: { timeoutMs: 99 } })); assert.equal(unknown.status, 400);
  assert.equal(coordination.releaseWriterLease({ requireOwned: true }), true, 'web drain retained writer authority');
});

test('DC8/DC10: admitted web drain replay preserves the original authenticated actor across session reconnect', async (t) => {
  const directory = root('web-reconnect'); const coordination = new CoordinationStore(directory); const receipt = drainReceipt(); const actors = []; let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; }); let physical = null;
  t.after(() => { release(); try { coordination.releaseWriterLease(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  const coordinator = { drain(ctx) { actors.push(ctx.actor); physical ??= gate.then(() => receipt); return physical; } };
  const firstServer = new WebNorthbound({ coordinator, coordination, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => NOW });
  const secondServer = new WebNorthbound({ coordinator, coordination, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => NOW });
  const first = firstServer.execute(webContext(webPrincipal(undefined, 'session-1')), webDrain());
  await until(() => coordination.events().some((event) => event.kind === 'web.command_admitted'), 'web reconnect admission');
  const second = secondServer.execute(webContext(webPrincipal(undefined, 'session-2')), webDrain({ commandId: 'drain-command-session-2' }));
  await until(() => actors.length === 2, 'web reconnect dispatch'); release();
  const [one, two] = await Promise.all([first, second]); assert.equal(one.status, 200); assert.equal(two.status, 200);
  assert.deepEqual(actors, ['web:user-1:session-1', 'web:user-1:session-1']); assert.equal(two.body.replayed, true);
  coordination.releaseWriterLease({ requireOwned: true });
});

const mcpPrincipal = (capabilities = ['observe', 'emergency_stop'], sessionId = 'stdio') => ({ userId: 'operator', sessionId, capabilities, repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false });
async function initialized(server) {
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase56', version: '1' } } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

test('DC9/DC10: MCP fleet_drain has emergency authority, exact schema, admitted replay, and transport parity', async (t) => {
  const directory = root('mcp'); const coordination = new CoordinationStore(directory); const receipt = drainReceipt(); let calls = 0; let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  t.after(() => { release(); try { coordination.releaseWriterLease(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  const coordinator = { async drain(ctx) { calls += 1; assert.match(ctx.idempotencyKey, /^mcp\.call:/); assert.equal(ctx.actor, 'mcp:operator:stdio'); assert.equal(ctx.repoId, 'repo-a'); await gate; return receipt; } };
  const server = new McpFleetServer({ coordinator, coordination, principal: mcpPrincipal(), repoIds: ['repo-a'], now: () => NOW, maxWaitMs: 1_000, maxMessageBytes: 64 * 1024, takeToolQuota: () => ({ ok: true }) }); await initialized(server);
  const tools = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); const drainTool = tools.result.tools.find((tool) => tool.name === 'fleet_drain');
  assert.deepEqual(drainTool.inputSchema.required, ['repoId', 'idempotencyKey']); assert.equal(drainTool.execution.taskSupport, 'forbidden'); assert.equal(drainTool.annotations.destructiveHint, true);
  const args = { repoId: 'repo-a', idempotencyKey: 'drain-mcp-1' };
  const first = server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_drain', arguments: args } });
  await until(() => coordination.events().some((event) => event.kind === 'mcp.call_admitted'), 'MCP drain admission');
  const second = server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fleet_drain', arguments: args } });
  await sleep(20); release(); const [one, two] = await Promise.all([first, second]);
  assert.equal(one.result.isError, false); assert.equal(two.result.isError, false); assert.equal(calls, 1); assert.deepEqual(one.result.structuredContent, two.result.structuredContent);
  const ping = await server.handle({ jsonrpc: '2.0', id: 5, method: 'ping' }); assert.deepEqual(ping.result, {});
  const extra = await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'fleet_drain', arguments: { ...args, idempotencyKey: 'extra', expectedFence: 1 } } }); assert.equal(extra.result.isError, true);
  coordination.releaseWriterLease({ requireOwned: true });
});

test('DC9/DC10: admitted MCP drain replay preserves the original injected actor across transport restart', async (t) => {
  const directory = root('mcp-reconnect'); const coordination = new CoordinationStore(directory); const receipt = drainReceipt(); const actors = []; let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; }); let physical = null;
  t.after(() => { release(); try { coordination.releaseWriterLease(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  const coordinator = { drain(ctx) { actors.push(ctx.actor); physical ??= gate.then(() => receipt); return physical; } };
  const options = { coordinator, coordination, repoIds: ['repo-a'], now: () => NOW, maxWaitMs: 1_000, maxMessageBytes: 64 * 1024, takeToolQuota: () => ({ ok: true }) };
  const firstServer = new McpFleetServer({ ...options, principal: mcpPrincipal(undefined, 'stdio-1') }); const secondServer = new McpFleetServer({ ...options, principal: mcpPrincipal(undefined, 'stdio-2') });
  await initialized(firstServer); await initialized(secondServer); const args = { repoId: 'repo-a', idempotencyKey: 'mcp-reconnect' };
  const first = firstServer.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fleet_drain', arguments: args } });
  await until(() => coordination.events().some((event) => event.kind === 'mcp.call_admitted'), 'MCP reconnect admission');
  const second = secondServer.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_drain', arguments: args } });
  await until(() => actors.length === 2, 'MCP reconnect dispatch'); release(); const [one, two] = await Promise.all([first, second]);
  assert.equal(one.result.isError, false); assert.equal(two.result.isError, false); assert.deepEqual(actors, ['mcp:operator:stdio-1', 'mcp:operator:stdio-1']);
  coordination.releaseWriterLease({ requireOwned: true });
});

test('DC11: canonical evidence wrapper owns root, process-group exit truth, and sibling safety on semantic red', (t) => {
  const world = root('evidence-wrapper'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.txt'); const sibling = join(world, 'sibling'); mkdirSync(sibling);
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { mkdtempSync, statSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';\nconst nested = mkdtempSync(join(process.env.TMPDIR, 'child-')); writeFileSync(process.argv[2], process.env.TMPDIR + '\\n' + nested + '\\n' + (statSync(process.env.TMPDIR).mode & 0o777)); process.exitCode = 7;\n`);
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, observed], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(outcome.status, 7, outcome.stderr); const [owned, nested, mode] = readFileSync(observed, 'utf8').trim().split('\n');
  assert.equal(Number(mode), 0o700);
  assert.equal(existsSync(owned), false); assert.equal(existsSync(nested), false); assert.equal(existsSync(sibling), true);
});

test('DC11: evidence wrapper rejects max+1 arguments before allocating an owner root', (t) => {
  const world = root('evidence-argv-bound'); const fixture = join(world, 'fixture.mjs');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, 'throw new Error("must not execute");\n');
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, ...Array.from({ length: 256 }, (_, index) => String(index))], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world },
  });
  assert.equal(outcome.status, 1); assert.match(outcome.stderr, /arguments exceed 256/);
  assert.equal(readdirSync(world).some((entry) => entry.startsWith('baton-evidence-')), false);
});

test('DC11: evidence wrapper reaps a live descendant left behind by a successful runner', (t) => {
  const world = root('evidence-descendant'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.json');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';\nconst child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>process.exit(0)); setInterval(()=>{},1000)'], { stdio: 'ignore' }); child.unref(); writeFileSync(process.argv[2], JSON.stringify({ owner: process.env.TMPDIR, pid: child.pid }));\n`);
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, observed], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world },
  });
  assert.equal(outcome.status, 0, outcome.stderr);
  const evidence = JSON.parse(readFileSync(observed, 'utf8'));
  assert.equal(existsSync(evidence.owner), false);
  assert.throws(() => process.kill(evidence.pid, 0), (error) => error.code === 'ESRCH');
});

test('DC11: evidence wrapper forwards TERM, reports signal status, and reaps the full group', async (t) => {
  const world = root('evidence-signal'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.json');
  const runnerSignal = join(world, 'runner.signal'); const descendantSignal = join(world, 'descendant.signal'); const descendantReady = join(world, 'descendant.ready');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs';\nconst child = spawn(process.execPath, ['-e', 'const fs=require("node:fs"); process.on("SIGTERM",()=>{fs.writeFileSync(process.argv[1],"TERM");process.exit(0)}); fs.writeFileSync(process.argv[2],"ready"); setInterval(()=>{},1000)', process.argv[4], process.argv[5]], { stdio: 'ignore' }); process.on('SIGTERM',()=>{writeFileSync(process.argv[3],'TERM');setTimeout(()=>process.exit(0),50)}); writeFileSync(process.argv[2], JSON.stringify({ owner: process.env.TMPDIR, runnerPid: process.pid, descendantPid: child.pid })); setInterval(()=>{},1000);\n`);
  const wrapper = spawn(process.execPath, [RUN_EVIDENCE, fixture, observed, runnerSignal, descendantSignal, descendantReady], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world },
  });
  const stderr = []; wrapper.stderr.on('data', (chunk) => stderr.push(chunk));
  const terminalPromise = new Promise((resolveTerminal, rejectTerminal) => {
    wrapper.once('error', rejectTerminal); wrapper.once('close', (code, signal) => resolveTerminal({ code, signal }));
  });
  await until(() => existsSync(observed) && existsSync(descendantReady), 'evidence signal fixture readiness');
  wrapper.kill('SIGTERM');
  const terminal = await terminalPromise;
  assert.deepEqual(terminal, { code: 143, signal: null }, Buffer.concat(stderr).toString('utf8'));
  const evidence = JSON.parse(readFileSync(observed, 'utf8'));
  assert.equal(readFileSync(runnerSignal, 'utf8'), 'TERM'); assert.equal(readFileSync(descendantSignal, 'utf8'), 'TERM');
  assert.equal(existsSync(evidence.owner), false);
  for (const pid of [evidence.runnerPid, evidence.descendantPid]) assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
});

test('DC11: evidence wrapper refuses cleanup when its owner-root identity is replaced', (t) => {
  const world = root('evidence-identity'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.json');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { mkdirSync, renameSync, writeFileSync } from 'node:fs';\nconst owner=process.env.TMPDIR; const moved=owner+'.original'; renameSync(owner,moved); mkdirSync(owner,{mode:0o700}); writeFileSync(owner+'/replacement','do-not-delete'); writeFileSync(process.argv[2],JSON.stringify({owner,moved}));\n`);
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, observed], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world },
  });
  assert.equal(outcome.status, 1); assert.match(outcome.stderr, /owner root identity changed/);
  const evidence = JSON.parse(readFileSync(observed, 'utf8'));
  assert.equal(readFileSync(join(evidence.owner, 'replacement'), 'utf8'), 'do-not-delete');
  assert.equal(existsSync(evidence.moved), true);
});

test('DC11: nested evidence and suite roots remain descendants of the outer owner root', (t) => {
  const world = root('evidence-nested'); const outerFixture = join(world, 'outer.mjs'); const nestedFixture = join(world, 'nested.mjs');
  const outerObserved = join(world, 'outer.json'); const nestedObserved = join(world, 'nested.json');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(nestedFixture, `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2],JSON.stringify({owner:process.env.TMPDIR,evidenceParent:process.env.BATON_EVIDENCE_TMP_PARENT,testParent:process.env.BATON_TEST_TMP_PARENT}));\n`);
  writeFileSync(outerFixture, `import { execFileSync } from 'node:child_process'; import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[4],JSON.stringify({owner:process.env.TMPDIR,evidenceParent:process.env.BATON_EVIDENCE_TMP_PARENT,testParent:process.env.BATON_TEST_TMP_PARENT})); execFileSync(process.execPath,[process.argv[2],process.argv[3],process.argv[5]],{stdio:'ignore'});\n`);
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, outerFixture, RUN_EVIDENCE, nestedFixture, outerObserved, nestedObserved], {
    encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world, BATON_TEST_TMP_PARENT: world },
  });
  assert.equal(outcome.status, 0, outcome.stderr);
  const outer = JSON.parse(readFileSync(outerObserved, 'utf8')); const nested = JSON.parse(readFileSync(nestedObserved, 'utf8'));
  assert.equal(outer.evidenceParent, outer.owner); assert.equal(outer.testParent, outer.owner);
  assert.equal(nested.evidenceParent, nested.owner); assert.equal(nested.testParent, nested.owner);
  assert.equal(resolve(nested.owner).startsWith(`${resolve(outer.owner)}${sep}`), true);
  assert.equal(existsSync(outer.owner), false); assert.equal(existsSync(nested.owner), false);
});

test('DC11: thrown and startup-refused runners both reap their allocated owner roots', (t) => {
  const world = root('evidence-startup-red'); const fixture = join(world, 'throw.mjs'); const observed = join(world, 'observed.txt');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2],process.env.TMPDIR); throw new Error('scripted runner failure');\n`);
  const thrown = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, observed], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world } });
  assert.equal(thrown.status, 1); assert.equal(existsSync(readFileSync(observed, 'utf8')), false);
  const missing = spawnSync(process.execPath, [RUN_EVIDENCE, join(world, 'missing.mjs')], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world } });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /MODULE_NOT_FOUND/);
  assert.equal(readdirSync(world).some((entry) => entry.startsWith('baton-evidence-')), false);
});

test('DC11: SIGINT forwarding preserves exit 130 and owned-root cleanup', async (t) => {
  const world = root('evidence-int'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.json'); const marker = join(world, 'int.signal');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { writeFileSync } from 'node:fs'; process.on('SIGINT',()=>{writeFileSync(process.argv[3],'INT');process.exit(0)}); writeFileSync(process.argv[2],JSON.stringify({owner:process.env.TMPDIR,pid:process.pid})); setInterval(()=>{},1000);\n`);
  const wrapper = spawn(process.execPath, [RUN_EVIDENCE, fixture, observed, marker], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world } });
  const terminalPromise = new Promise((resolveTerminal, rejectTerminal) => { wrapper.once('error', rejectTerminal); wrapper.once('close', (code, signal) => resolveTerminal({ code, signal })); });
  await until(() => existsSync(observed), 'evidence INT fixture readiness'); wrapper.kill('SIGINT'); const terminal = await terminalPromise;
  assert.deepEqual(terminal, { code: 130, signal: null }); assert.equal(readFileSync(marker, 'utf8'), 'INT');
  const evidence = JSON.parse(readFileSync(observed, 'utf8')); assert.equal(existsSync(evidence.owner), false); assert.throws(() => process.kill(evidence.pid, 0), (error) => error.code === 'ESRCH');
});

test('DC11: an unforwarded child signal maps to exact conventional exit status', (t) => {
  const world = root('evidence-hup'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.txt');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2],process.env.TMPDIR); setTimeout(()=>process.kill(process.pid,'SIGHUP'),20);\n`);
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, observed], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world } });
  assert.equal(outcome.status, 129, outcome.stderr); assert.equal(existsSync(readFileSync(observed, 'utf8')), false);
});

test('DC11: TERM-ignoring runner and descendant are escalated to KILL and fully reaped', async (t) => {
  const world = root('evidence-escalation'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.json'); const ready = join(world, 'ready');
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'}); process.on('SIGTERM',()=>{}); writeFileSync(process.argv[2],JSON.stringify({owner:process.env.TMPDIR,runnerPid:process.pid,descendantPid:child.pid})); writeFileSync(process.argv[3],'ready'); setInterval(()=>{},1000);\n`);
  const wrapper = spawn(process.execPath, [RUN_EVIDENCE, fixture, observed, ready], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world } });
  const terminalPromise = new Promise((resolveTerminal, rejectTerminal) => { wrapper.once('error', rejectTerminal); wrapper.once('close', (code, signal) => resolveTerminal({ code, signal })); });
  await until(() => existsSync(ready), 'evidence escalation fixture readiness'); const started = Date.now(); wrapper.kill('SIGTERM'); const terminal = await terminalPromise;
  assert.deepEqual(terminal, { code: 143, signal: null }); assert.ok(Date.now() - started >= 4_500 && Date.now() - started < 8_000);
  const evidence = JSON.parse(readFileSync(observed, 'utf8')); assert.equal(existsSync(evidence.owner), false);
  for (const pid of [evidence.runnerPid, evidence.descendantPid]) assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
});

test('DC11: aggregate argument bytes are refused before owner-root allocation', (t) => {
  const world = root('evidence-argv-bytes'); const fixture = join(world, 'fixture.mjs'); t.after(() => rmSync(world, { recursive: true, force: true })); writeFileSync(fixture, 'process.exitCode=0;\n');
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, 'x'.repeat(64 * 1024)], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, BATON_EVIDENCE_TMP_PARENT: world } });
  assert.equal(outcome.status, 1); assert.match(outcome.stderr, /arguments exceed 65536 bytes/); assert.equal(readdirSync(world).some((entry) => entry.startsWith('baton-evidence-')), false);
});

// --- #277 drain convergence (G-1, G-2 covered at DC5 above, G-3, G-20, G-21, G-22, G-24, G-28) ---

test('DC1/#277 G-1: maxInteractions is a deployment field, or a fleet derivation — never milliseconds over four', async (t) => {
  // Coordinator boundary: the policy accepts a named interaction bound and derives the default
  // from the fleet.
  const coordinationFixture = (drainPolicy) => {
    const dir = root(`policy-${drainPolicy.maxWorkers}-${drainPolicy.timeoutMs}-${drainPolicy.maxInteractions ?? 'derived'}`);
    const coordination = new CoordinationStore(dir);
    const log = new Log(join(dir, 'worker-log'));
    const coordinator = new Coordinator({ log, coordination, adapters: {}, drainPolicy });
    t.after(() => { try { coordination.releaseWriterLease(); } catch {} rmSync(dir, { recursive: true, force: true }); });
    return coordinator._drainPolicy;
  };
  assert.equal(coordinationFixture({ maxWorkers: 3, timeoutMs: 1_000, pollMs: 5, maxInteractions: 7 }).maxInteractions, 7,
    'a named bound is honored exactly');
  assert.throws(() => coordinationFixture({ maxWorkers: 3, timeoutMs: 1_000, pollMs: 5, maxInteractions: 0 }), /drain policy/i);
  assert.equal(coordinationFixture({ maxWorkers: 3, timeoutMs: 60_000, pollMs: 5 }).maxInteractions, 48,
    'the default bound derives from the fleet (16 interactions per reserved worker)');
  // Deployment surface: the derivation is fleet-scaled, not a duration quotient — at the default
  // fleet size the old `timeoutMs/4` reading and the literal 15_000 both disagree with the fleet.
  const valid = repo('policy-interactions'); let driver;
  t.after(() => { try { driver?.close(); } catch {} try { driver?.closeAsync?.(); } catch {} rmSync(valid.world, { recursive: true, force: true }); });
  driver = createDriver({
    repoRoot: valid.directory, logDir: valid.logDir, repoId: 'repo-a', adapters: {},
  });
  assert.equal(driver.coordinator._drainPolicy.maxInteractions, 1024 * 16,
    'the default policy derives its interaction bound from its fleet size');
  const longWindow = createDriver({
    repoRoot: valid.directory, logDir: join(valid.world, 'log-2'), repoId: 'repo-a', adapters: {},
    drainPolicy: { maxWorkers: 1024, timeoutMs: 240_000, pollMs: 10 },
  });
  assert.equal(longWindow.coordinator._drainPolicy.maxInteractions, 1024 * 16,
    'a longer deadline never buys a larger interaction bound: the fleet sets it');
  longWindow.close();
});
test('DC8/#277 G-20: the drain attempts every worker its own success test counts', async (t) => {
  const f = repo('g20-global-attempt'); let driver; t.after(async () => {
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  const killed = [];
  const nativeKill = adapter.kill.bind(adapter);
  adapter.kill = async (workerId, ...rest) => { killed.push(workerId); return nativeKill(workerId, ...rest); };
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 4, timeoutMs: 5_000, pollMs: 5 }, watchdog: { stallMs: 60_000 },
  });
  await driver.ready;
  const active = await driver.coordinator.spawn('mock', brief('active holder'), { taskId: 'g20-active' });
  const outsider = await driver.coordinator.spawn('mock', brief('holder outside the target set'), { taskId: 'g20-outsider' });
  await until(() => driver.coordinator.list().find((row) => row.id === active.id)?.status === 'working', 'active worker');
  await until(() => driver.coordinator.list().find((row) => row.id === outsider.id)?.status === 'working', 'outsider worker');
  // The durable admission pins the target set to the active worker alone. The outsider still
  // holds local resources: the drain's own success test counts it (globalRemaining), so the
  // drain must attempt it — not merely observe it until the deadline (#277 G-20).
  const store = driver.coordination;
  const physicalDrain = { status: 'admitted', targetWorkerIds: [active.id], dispositions: [] };
  store.fleetDrain = (drainId) => ({
    status: physicalDrain.status, targetWorkerIds: [...physicalDrain.targetWorkerIds],
    dispositions: physicalDrain.dispositions.map((row) => ({ ...row })),
    ...(physicalDrain.receipt ? { receipt: physicalDrain.receipt } : {}),
  });
  store.admitFleetDrain = (fields) => { physicalDrain.targetWorkerIds = [...fields.targetWorkerIds]; return { ok: true, result: 'replay' }; };
  store.recordFleetDrainDisposition = (drainId, workerId, disposition) => {
    physicalDrain.dispositions.push({ workerId, disposition });
    return { ok: true, result: 'recorded' };
  };
  store.completeFleetDrain = (drainId, receipt) => { physicalDrain.status = 'completed'; physicalDrain.receipt = receipt; return { ok: true, result: 'completed' }; };
  const receipt = await driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'g20-drain' });
  assert.equal(receipt.state, 'drained');
  assert.equal(receipt.targetCount, 1, 'the admitted target set is unchanged');
  assert.ok(killed.includes(outsider.id), 'the non-target holder was attempted, not merely counted');
  assert.equal(driver.coordinator._workers.get(outsider.id).localAuthority, false, 'the non-target hold is released');
});
test('DC8/#277 G-21: the drain terminal throw names its wait and is never its own cause', async (t) => {
  const f = repo('g21-named-throw'); let driver; t.after(async () => {
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 1, timeoutMs: 200, pollMs: 5 }, watchdog: { stallMs: 60_000 },
  });
  await driver.ready;
  const handle = await driver.coordinator.spawn('mock', brief('unconverged'), { taskId: 'g21-active' });
  await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.status === 'working', 'active worker');
  await driver.coordinator.kill(handle.id);
  // Attempts settle every pass, but the dead worker still holds local authority and its exact
  // cleanup keeps failing: the convergence loop exhausts the deployment deadline and throws.
  driver.coordinator._workers.get(handle.id).localAuthority = true;
  const originalCleanup = driver.coordinator._cleanupClosedTransport.bind(driver.coordinator);
  driver.coordinator._cleanupClosedTransport = async () => {
    throw Object.assign(new Error('scripted cleanup failure'), { code: 'runtime_cleanup_failed' });
  };
  await assert.rejects(driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'g21-drain' }),
    (error) => {
      assert.equal(error.code, 'coordinator_drain_incomplete');
      assert.equal(error.detail?.reason, 'deadline', 'the deadline names its stage');
      assert.ok(Array.isArray(error.detail?.waitingOn) && error.detail.waitingOn.length > 0, 'the throw carries waitingOn');
      assert.equal(error.detail.waitingOn[0].workerId, handle.id);
      assert.equal(error.detail.cause, undefined, 'a bare non-convergence is never wrapped as its own cause');
      return true;
    });
  driver.coordinator._cleanupClosedTransport = originalCleanup;
});

test('DC8/#277 G-22: a durable non-terminal task with no handle gets its disposition without cloning the projection', async (t) => {
  const f = repo('g22-no-handle'); let driver; t.after(async () => {
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {},
    drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 },
  });
  await driver.ready;
  driver.coordination.createTask({
    id: 'task-g22-ghost', brief: { objective: 'Durable row without a local handle' },
    deps: [], refines: null, relation: 'root', runId: 'run-g22', taskType: 'general',
    reservedWorkerId: 'w-ghost', vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:task-g22-ghost' });
  let snapshots = 0;
  const snapshot = driver.coordination.snapshot.bind(driver.coordination);
  driver.coordination.snapshot = (...args) => { snapshots += 1; return snapshot(...args); };
  const started = Date.now();
  const receipt = await driver.coordinator.stopRunTargets(['w-ghost']);
  assert.ok(Date.now() - started < 1_000, 'the stop converges instead of spinning to its deadline');
  assert.equal(receipt.targetCount, 1);
  assert.equal(receipt.counts.alreadyTerminal, 1, 'the handle-less target is disposed immediately');
  assert.equal(snapshots, 0, 'the projection is never re-cloned per poll');
});

test('DC8/#277 G-3: terminal resource release is possible during a drain', async (t) => {
  const f = repo('g3-release-during-drain'); const gate = deferred(); let driver; t.after(async () => {
    gate.resolve();
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 2, timeoutMs: 5_000, pollMs: 5 }, watchdog: { stallMs: 60_000 },
  });
  await driver.ready;
  const reconcile = driver.coordinator._worktrees.reconcile.bind(driver.coordinator._worktrees);
  driver.coordinator._worktrees.reconcile = async (...args) => { await gate.promise; return reconcile(...args); };
  const active = await driver.coordinator.spawn('mock', brief('drain blocker'), { taskId: 'g3-active', runId: 'run-g3' });
  await until(() => driver.coordinator.list().find((row) => row.id === active.id)?.status === 'working', 'active worker');
  const finished = await driver.coordinator.spawn('mock', brief('finished member'), { taskId: 'g3-finished', runId: 'run-g3' });
  await until(() => driver.coordinator.list().find((row) => row.id === finished.id)?.status === 'working', 'finished worker started');
  await driver.coordinator.kill(finished.id);
  await until(() => driver.coordination.task('g3-finished')?.status === 'cancelled', 'finished member is terminal');
  const draining = driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'g3-drain' });
  await until(() => driver.coordinator._drainState === 'draining', 'drain fenced admission');
  // The policy path frees a completed member's resources exactly while the fleet is draining.
  const release = await driver.coordinator.releaseTerminalTaskResources('g3-finished', finished.id);
  assert.equal(release.taskId, 'g3-finished');
  assert.equal(release.workerId, finished.id);
  gate.resolve();
  const receipt = await draining;
  assert.equal(receipt.state, 'drained');
});

test('DC8/#277 G-24: the run scratchpad reap yields between passes and fails loudly when partial stops advancing', async (t) => {
  const f = repo('g24-reap'); let driver; t.after(async () => {
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {},
    drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 },
  });
  await driver.ready;
  let calls = 0; let ticked = false;
  setTimeout(() => { ticked = true; }, 0);
  driver.coordination.reapRunScratchpads = (runId) => {
    calls += 1;
    if (calls === 1) return { ok: true, result: 'partial', runId, reaped: [], remainingPartitions: 1, remainingEntries: 1, nextPartition: { scope: 'worker', taskId: 't', workerId: 'w' } };
    return { ok: true, result: 'complete', runId, reaped: [{ scope: 'worker' }], remainingPartitions: 0, remainingEntries: 0, nextPartition: null };
  };
  const receipt = await driver.coordinator.reapRunScratchpads('run-g24');
  assert.equal(receipt.result, 'complete');
  assert.equal(calls, 2, 'one pass per remaining partition batch');
  assert.equal(ticked, true, 'the reap yielded the event loop between passes');
  driver.coordination.reapRunScratchpads = () => ({ ok: true, result: 'partial', remainingPartitions: 1, remainingEntries: 1, nextPartition: null });
  await assert.rejects(driver.coordinator.reapRunScratchpads('run-g24-stuck'),
    (error) => error.code === 'coordinator_scratchpad_reap_incomplete',
    'a non-advancing partial is a loud failure, never a silent spin');
});

test('DC8/#277 G-28: a poisoned coordinator still converges a stop through one exact posture', async (t) => {
  const f = repo('g28-poison'); let driver; t.after(async () => {
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 },
  });
  await driver.ready;
  const handle = await driver.coordinator.spawn('mock', brief('poisoned then stopped'), { taskId: 'g28-worker' });
  await driver.coordinator.kill(handle.id);
  // The worker still holds local authority, so the stop's attempt must reach the kill seam:
  // under one posture the drain token admits the exact-physical emergency path there.
  driver.coordinator._workers.get(handle.id).localAuthority = true;
  await until(() => driver.coordination.task('g28-worker')?.status === 'cancelled', 'worker settled');
  driver.coordinator._fatalError = Object.assign(new Error('coordination poison'), { code: 'coordination_poisoned' });
  const started = Date.now();
  const receipt = await driver.coordinator.stopRunTargets([handle.id]);
  assert.ok(Date.now() - started < 1_000, 'the stop converges instead of burning its deadline');
  assert.equal(receipt.counts.alreadyTerminal, 1);
});
