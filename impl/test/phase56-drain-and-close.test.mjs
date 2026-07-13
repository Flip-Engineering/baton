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

import {
  CoordinationStore, McpFleetServer, MockAdapter, WebNorthbound, createBrief, createDriver,
} from '../src/index.mjs';

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
  git(['init', '-q'], directory); git(['config', 'user.name', 'Baton Phase 56'], directory); git(['config', 'user.email', 'phase56@example.invalid'], directory);
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
    drainPolicy: { maxWorkers: 2, timeoutMs: 5_000, pollMs: 5 }, watchdog: { stallMs: 0 },
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

test('DC4: drain cannot attest while worktree creation or native spawn remains pending', async (t) => {
  const f = repo('late-spawn-boundary'); let driver; const worktreeGate = deferred(); const spawnGate = deferred();
  t.after(() => { worktreeGate.resolve(); spawnGate.resolve(); try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = async (...args) => { const ack = await nativeSpawn(...args); await spawnGate.promise; return ack; };
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 }, watchdog: { stallMs: 0 },
  });
  await driver.ready;
  const createWorktree = driver.coordinator._worktrees.create.bind(driver.coordinator._worktrees);
  const removeWorktree = driver.coordinator._worktrees.remove.bind(driver.coordinator._worktrees);
  let created = false; let earlyRemovals = 0; let lateRemovals = 0;
  driver.coordinator._worktrees.create = async (...args) => { await worktreeGate.promise; const value = await createWorktree(...args); created = true; return value; };
  driver.coordinator._worktrees.remove = async (...args) => {
    if (!created) { earlyRemovals += 1; return; }
    lateRemovals += 1; return removeWorktree(...args);
  };
  const worker = await driver.coordinator.spawn('mock', brief('late boundaries'), { taskId: 'late-boundaries' });
  await until(() => driver.coordinator._workers.get(worker.id)?.nativeSpawnPending === true, 'native spawn reservation');
  let settled = false; const closing = driver.drainAndClose().finally(() => { settled = true; });
  await until(() => earlyRemovals > 0, 'early stop cleanup'); await sleep(25);
  assert.equal(settled, false); assert.equal(driver.coordinator._workers.get(worker.id).worktreeCreationPending, true);
  assert.equal(driver.coordinator._workers.get(worker.id).nativeSpawnPending, true);
  worktreeGate.resolve(); spawnGate.resolve();
  const receipt = await closing;
  assert.equal(receipt.state, 'closed'); assert.ok(lateRemovals > 0, 'late-created checkout is reaped before attestation');
  assert.equal(existsSync(join(f.directory, '.baton', 'wt', 'late-boundaries')), false);
  assert.equal(git(['branch', '--list', 'baton/late-boundaries'], f.directory), '');
});

test('DC4: a process start after spawn Ack is quarantined behind a fresh exact kill/close boundary', async (t) => {
  const f = repo('late-process-start'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 }, watchdog: { stallMs: 0 } });
  const worker = await driver.coordinator.spawn('mock', brief('late native start'), { taskId: 'late-process-start' });
  await until(() => driver.coordinator._workers.get(worker.id)?.nativeSpawnPending === false && adapter._sessions.has(worker.id), 'spawn Ack boundary');
  const session = adapter._sessions.get(worker.id); const generation = session.opts.processGeneration;
  adapter._emit(session, 'lifecycle.process_started', { schemaVersion: 1, generation, pid: 424242, processGroupId: 424242, phase: 'initializing' });
  assert.equal(driver.coordinator._workers.get(worker.id).processRef?.state, 'initializing');
  adapter._emit(session, 'lifecycle.process_closed', { schemaVersion: 1, generation, pid: 424242, processGroupId: 424242, code: null, signal: 'SIGKILL', ready: false });
  await until(() => driver.coordinator._workers.get(worker.id)?.processRef?.state === 'closed' && driver.coordinator._workers.get(worker.id)?.localAuthority === false, 'late-start quarantine kill');
  const events = driver.log.read(worker.id);
  assert.equal(events.some((event) => event.kind === 'lifecycle.process_attribution_refused' && event.payload.code === 'invalid_process_start'), true);
  assert.equal(events.some((event) => event.kind === 'lifecycle.process_started'), false);
  assert.equal(driver.coordinator._workers.get(worker.id).processRef.state, 'closed');
  assert.equal((await driver.drainAndClose()).state, 'closed');
});

test('DC4: drain reconciles historical worktree, branch, metadata, and runtime residue outside live handles', async (t) => {
  const f = repo('historical-residue'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 } });
  await driver.ready;
  const worktree = await driver.coordinator._worktrees.create('historical');
  driver.coordinator._runtimeScopes.create('historical', 'mock');
  assert.equal(existsSync(worktree.path), true); assert.notEqual(git(['branch', '--list', 'baton/historical'], f.directory), '');
  const receipt = await driver.drainAndClose();
  assert.equal(receipt.state, 'closed'); assert.equal(existsSync(worktree.path), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'wt', 'historical.meta.json')), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'runtime', 'historical')), false);
  assert.equal(git(['branch', '--list', 'baton/historical'], f.directory), '');
});

test('DC2/DC4: drain policy-resolves pending interaction and publication authority and discards late asks', async (t) => {
  const f = repo('pending-authority'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 2_000, pollMs: 5 }, watchdog: { stallMs: 0 } });
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
  const adapter = new MockAdapter({ concurrencyCeiling: 0, scenario: { outcome: 'completed' } });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  await driver.coordinator.spawn('mock', brief('one'), { taskId: 'one' }); await driver.coordinator.spawn('mock', brief('two'), { taskId: 'two' });
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordinator_drain_capacity');
  assert.equal(driver.coordinator.list().length, 2, 'capacity refusal occurs before admission closes');
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), true);
  driver.coordinator._drainPolicy = Object.freeze({ maxWorkers: 2, timeoutMs: 1_000, pollMs: 5 });
  const receipt = await driver.drainAndClose(); assert.equal(receipt.state, 'closed');
});

test('DC1/DC5: active interaction max+1 refuses before fencing without scanning historical records', async (t) => {
  const f = repo('interaction-max-plus-one'); let driver; t.after(() => { try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 100, pollMs: 5 } });
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
    drainPolicy: { maxWorkers: 1, timeoutMs: 40, pollMs: 5 }, watchdog: { stallMs: 0 },
  });
  const handle = await driver.coordinator.spawn('mock', brief('hung cleanup'), { taskId: 'hung-cleanup' });
  await until(() => driver.coordinator.list().find((row) => row.id === handle.id)?.status === 'working', 'hung-cleanup worker');
  driver.coordinator._worktrees.remove = () => new Promise(() => {});
  const started = Date.now();
  await assert.rejects(driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'hung-cleanup' }), (error) => error.code === 'coordinator_drain_incomplete');
  assert.ok(Date.now() - started < 500, 'deployment deadline bounds a never-settling cleanup');
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), true);
  assert.equal(driver.coordinator._workers.get(handle.id).localAuthority, true);
});

test('DC5: synchronous durable admission crossing the deadline is red and retryable, never late success', async (t) => {
  const f = repo('slow-admission'); const coordinationDir = root('slow-admission-coordination'); const coordination = new CoordinationStore(coordinationDir); let driver;
  t.after(() => { try { coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); rmSync(coordinationDir, { recursive: true, force: true }); });
  const admit = coordination.admitFleetDrain.bind(coordination); let delayed = true;
  coordination.admitFleetDrain = (...args) => { if (delayed) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); return admit(...args); };
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', coordination, adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 100, pollMs: 5 } });
  const started = Date.now();
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordinator_drain_incomplete');
  assert.ok(Date.now() - started >= 140); assert.equal(existsSync(coordination._writerLease.path), true); assert.equal(driver.coordinator._drainState, 'draining');
  delayed = false; coordination.admitFleetDrain = admit;
  assert.equal((await driver.drainAndClose()).state, 'closed');
});

test('DC4/DC5: a timed-out historical reconciliation remains owned and retries join it', async (t) => {
  const f = repo('historical-reconcile-timeout'); let driver; const gate = deferred();
  t.after(() => { gate.resolve(); try { driver?.coordination.releaseWriterLease(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 40, pollMs: 5 } });
  await driver.ready; let reconciliations = 0; let lateMutation = false;
  driver.coordinator._worktrees.reconcile = async () => { reconciliations += 1; await gate.promise; lateMutation = true; };
  await assert.rejects(driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey: 'historical-timeout' }), (error) => error.code === 'coordinator_drain_incomplete');
  assert.equal(reconciliations, 1); assert.equal(lateMutation, false); assert.ok(driver.coordinator._drainHistoricalReconcilePromise);
  let settled = false; const closing = driver.drainAndClose().finally(() => { settled = true; }); await sleep(10);
  assert.equal(settled, false); assert.equal(reconciliations, 1, 'retry joins the original cleanup rather than starting a second mutation');
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
      drainPolicy: { maxWorkers: 1, timeoutMs: 100, pollMs: 5 }, watchdog: { stallMs: 0 },
    });
    await driver.ready;
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
