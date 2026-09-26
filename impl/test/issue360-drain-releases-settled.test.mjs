// Issue #360 — `baton serve` exited SIGTERM with application_host_shutdown_failed after every
// seat was stopped: the fleet drain waited its whole deadline (reason deadline, stage
// convergence, deadline 90000ms) on resources a dead worker with a closed process still held
// (local_resources:localAuthority + local_resources:worktree + local_resources:cleanupPending),
// and nobody would ever release them.
//
// The contract this file pins:
//   (a) a seat stopped through swarm.stop whose worker process is closed is RELEASED by the
//       drain itself — the reap goes through the #428/#435 custody boundary (capture-or-retain,
//       never a bare delete) — the drain converges within the deployment's own policy bound and
//       the shutdown exits zero; a hold nothing could ever release is released with reason
//       `orphaned`, never waited on;
//   (b) a capacity reservation the settled holder left behind is released through the capacity
//       authority and NAMED in the released rows;
//   (c) waitingOn[].waiting entries carry {resource, reaper, since} so an operator reads which
//       release is pending, while the drain's deadline stays the deployment's own policy row;
//   (d) the enriched fields replay byte-for-byte from the durable worker log.
//
// Every row is red at HEAD (the drain waits out its deadline; no released rows, no reaper or
// since names exist anywhere) and green after the repair.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import { Log } from '../src/log.mjs';

const repoId = 'repo-issue360-drain';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const selection = Object.freeze({
  exact: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

// One reservation per physical checkout (the shared-workspace-custody policy row).
const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024,
  maxReservedInodes: 10_000,
  minFreeBytes: 1,
  minFreeInodes: 1,
  runtimeReserveBytes: 4 * 1024,
  runtimeReserveInodes: 4,
});

const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});
const orchestrator = principal('orchestrator');
const command = (app, name, args) => app.command(name, args, orchestrator);

const DRAIN_TIMEOUT_MS = 1_500;

function workingAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', delayMs: 120_000, summary: 'still working', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function initRepo(repo) {
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 360 drain', GIT_COMMITTER_NAME: 'Issue 360 drain' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue360@example.invalid', GIT_COMMITTER_EMAIL: 'issue360@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

async function fixture(t, { capacity = false, label = 'seat' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue360-${label}-`));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(directory, 'log'),
    adapters: { mock: workingAdapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 4_000,
    drainPolicy: { maxWorkers: 8, timeoutMs: DRAIN_TIMEOUT_MS, pollMs: 10 },
    ...(capacity ? {
      worktreeCapacity: capacityPolicy,
      worktreeCapacityEstimate: () => ({ bytes: 16 * 1024, inodes: 32 }),
      worktreeCapacityObserve: () => ({ freeBytes: 1024 * 1024 * 1024, freeInodes: 1_000_000 }),
    } : {}),
  });
  const app = new BatonApplication({
    driver, repoId,
    profiles: { standard: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    await app.shutdown(principal('cleanup')).catch(() => {});
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  return { app, driver, repo };
}

const createSwarm = (app, swarmId) => command(app, 'swarm.create', {
  purpose: 'Hold a settled seat through the fleet drain',
  swarmId, idempotencyKey: `create:${swarmId}`,
});

const recruit = (app, { swarmId, participantId, objective, key = null }) => command(app, 'swarm.recruit', {
  swarmId, participantId, objective, options: selection,
  idempotencyKey: key ?? `recruit:${swarmId}:${participantId}`,
});

const stopParticipant = (app, { swarmId, participantId, reason, key = null }) => command(app, 'swarm.stop', {
  swarmId, participantId, reason, idempotencyKey: key ?? `stop:${swarmId}:${participantId}`,
});

async function working(driver, runId) {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const worker = driver.coordinator.list().find((row) => row.runId === runId) ?? null;
    if (worker && worker.status === 'working') return worker;
    if (Date.now() >= deadline) throw new Error(`seat never started working: ${runId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const releasedRows = (driver, workerId) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'drain.resource_released'
    && event.payload?.workerId === workerId)
  .map((event) => event.payload);

test('360a: the drain releases a settled stopped seat through the custody boundary and the shutdown exits zero', async (t) => {
  const { app, driver } = await fixture(t, { label: 'a' });
  const swarmId = 'issue360a';
  await createSwarm(app, swarmId);
  const seat = await recruit(app, { swarmId, participantId: 'builder', objective: 'Hold work through a stop and a drain' });
  const worker = await working(driver, seat.runId);
  const ownerId = worker.sessionContext.ownerTaskId;
  const cwd = worker.worktree;
  writeFileSync(join(cwd, 'carried.txt'), 'uncommitted seat work that must survive the drain\n');

  // The preservation outage: every capture fails, so neither the stop chain nor the exact
  // cleanup can settle the checkout — the production shape behind the 90s wedge.
  driver.coordinator._worktrees.capture = async () => {
    throw Object.assign(new Error('capture authority unavailable'), { code: 'capture_unavailable' });
  };
  await stopParticipant(app, { swarmId, participantId: 'builder', reason: 'Seat stopped seconds before SIGTERM' }).catch((error) => error);

  const handle = driver.coordinator._workers.get(worker.id);
  assert.equal(handle.status, 'dead', 'the seat stop killed the worker');
  assert.ok(!handle.processRef || handle.processRef.state === 'closed',
    'the process is exactly closed (or settled to absent)');
  assert.equal(driver.coordinator._ownsLocalResources(handle), true,
    'the dead worker still holds its local resources');
  assert.equal(driver.coordinator._stopWaiters.has(worker.id), false,
    'no stop chain is left that could ever release them');
  assert.equal(handle.cleanupPromise, null, 'no in-flight cleanup is left that could release them');
  assert.ok(driver.coordination.runStop(seat.runId), 'the seat stop is durably admitted');

  // The drain must reap the settled holder itself — through the #428/#435 custody boundary,
  // never a bare delete — converge within the deployment's own policy bound, and let the
  // shutdown exit zero.
  const application = await app.shutdown(principal('drain'));
  assert.equal(application.state, 'closed', 'the shutdown exits zero after the drain released the settled holder');

  // Capture-or-retain: the capture failed, so the checkout is RETAINED with its custody row —
  // the seat's work is still on disk, and the handle no longer holds it.
  assert.equal(existsSync(cwd), true, 'the retained checkout keeps the seat work on disk');
  const custody = driver.coordination.eventsView().find((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'worktree.custody_retained'
    && event.payload?.workspaceId === ownerId && event.payload?.reason === 'drain');
  assert.ok(custody, 'the retention rides the coordination ledger, never silent');
  assert.ok(driver.log.read(worker.id).some((event) => event.kind === 'worktree.custody_content_retained'
    && event.payload?.physicalOwnerId === ownerId),
    'the custody retention is recorded on the worker log with its physical owner');
  assert.equal(handle.worktree, null, 'the handle released the checkout');
  assert.equal(driver.coordinator._ownsLocalResources(handle), false, 'the settled holder holds nothing');

  const released = releasedRows(driver, worker.id);
  assert.deepEqual(
    released.filter((row) => row.resource === 'local_resources:worktree').map((row) => row.how),
    ['retained'],
    'the worktree hold is released by the drain itself through the custody boundary');
  for (const resource of ['local_resources:localAuthority', 'local_resources:cleanupPending']) {
    assert.ok(released.some((row) => row.resource === resource && row.how === 'orphaned'),
      `${resource} had no reaper and is released with reason orphaned, never waited on`);
  }
});

test('360b: the drain releases and names the capacity reservation a stopped seat left behind', async (t) => {
  const { app, driver } = await fixture(t, { capacity: true, label: 'b' });
  const swarmId = 'issue360b';
  await createSwarm(app, swarmId);
  const seat = await recruit(app, { swarmId, participantId: 'builder', objective: 'Hold a reservation through a stop and a drain' });
  const worker = await working(driver, seat.runId);
  const ownerId = worker.sessionContext.ownerTaskId;
  const cwd = worker.worktree;
  writeFileSync(join(cwd, 'carried.txt'), 'uncommitted seat work\n');
  const capacityId = `worker:${ownerId}`;

  // The preservation outage lives only while the stop is converging: the stop chain cannot
  // settle the checkout, and the SIGTERM-scale drain takes it over once the outage ends.
  const worktrees = driver.coordinator._worktrees;
  const realCapture = worktrees.capture.bind(worktrees);
  let outage = true;
  worktrees.capture = async (...args) => {
    if (outage) throw Object.assign(new Error('capture authority unavailable'), { code: 'capture_unavailable' });
    return realCapture(...args);
  };
  await stopParticipant(app, { swarmId, participantId: 'builder', reason: 'Seat stopped seconds before SIGTERM' }).catch((error) => error);
  outage = false;

  const handle = driver.coordinator._workers.get(worker.id);
  assert.equal(handle.status, 'dead');
  assert.ok(!handle.processRef || handle.processRef.state === 'closed');
  assert.equal(driver.coordinator._ownsLocalResources(handle), true);
  assert.ok(driver.worktreeCapacity.snapshot().reservations.some((row) => row.id === capacityId),
    'the stopped seat left its capacity reservation behind');

  const application = await app.shutdown(principal('drain'));
  assert.equal(application.state, 'closed', 'the shutdown exits zero with no owned reservation left');
  assert.equal(existsSync(cwd), false, 'the drain reaped the checkout (the capture succeeded)');
  assert.equal(driver.worktreeCapacity.snapshot().reservations.some((row) => row.id === capacityId), false,
    'the reservation was released through the capacity authority');

  const released = releasedRows(driver, worker.id);
  assert.deepEqual(
    released.filter((row) => row.resource === 'local_resources:worktree').map((row) => row.how),
    ['custody_reaped'],
    'the checkout went through the capture-then-remove custody boundary');
  assert.ok(released.some((row) => row.resource === capacityId && row.how === 'capacity'),
    'the capacity reservation release is named in the released rows');
});

// --- (c)/(d): the deadline row names the reaper it waits on ------------------------------

function drainFixture(t, { timeoutMs = 400, label = 'c' } = {}) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue360-${label}-`));
  const repo = join(world, 'repo');
  initRepo(repo);
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } },
  });
  const driver = createDriver({
    repoRoot: repo, logDir: join(world, 'log'), repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 4, timeoutMs, pollMs: 5 }, watchdog: { stallMs: 60_000 },
  });
  t.after(async () => {
    try { await driver.closeAsync(); } catch {}
    rmSync(world, { recursive: true, force: true });
  });
  return { driver, timeoutMs };
}

const brief360 = (goal) => createBrief({
  goal, constraints: [], pathScope: ['README.md'], definitionOfDone: 'stopped by drain',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10_000, usd: 1, wallMin: 5 },
});

// G-21's construction: a settled dead worker whose exact cleanup keeps failing, with no run
// stop behind it (a bare operator kill — the seat never left). The drain still waits its
// deadline — and the deadline row must name WHICH release is pending, per resource.
async function wedgedDrainFixture(t, label, idempotencyKey) {
  const { driver, timeoutMs } = drainFixture(t, { label });
  const handle = await driver.coordinator.spawn('mock', brief360('unconverged'), { taskId: `issue360-${label}` });
  const deadline = Date.now() + 8_000;
  while (driver.coordinator.list().find((row) => row.id === handle.id)?.status !== 'working') {
    if (Date.now() >= deadline) throw new Error('worker never started working');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await driver.coordinator.kill(handle.id);
  // The exact cleanup succeeded; the dead worker still carries one stale hold no code will
  // ever release, and the exact cleanup itself is scripted to keep failing.
  driver.coordinator._workers.get(handle.id).localAuthority = true;
  driver.coordinator._cleanupClosedTransport = async () => {
    throw Object.assign(new Error('scripted cleanup failure'), { code: 'runtime_cleanup_failed' });
  };
  return { driver, handle, timeoutMs, idempotencyKey };
}

test('360c: the drain deadline names the reaper and since per waited resource', async (t) => {
  const { driver, handle, timeoutMs, idempotencyKey } = await wedgedDrainFixture(t, 'c', 'issue360c-drain');
  const observedAt = Date.now();
  await assert.rejects(
    driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey }),
    (error) => {
      assert.equal(error.code, 'coordinator_drain_incomplete');
      assert.equal(error.detail?.reason, 'deadline');
      // Which step of the loop the deadline won is the drain's own accounting ('remaining' when
      // it raced a pass of attempts, 'convergence' when the loop ended) — the row that matters
      // names the policy bound, never a new literal.
      assert.ok(['remaining', 'convergence'].includes(error.detail?.stage),
        `the deadline names its stage: ${error.detail?.stage}`);
      assert.equal(error.detail?.timeoutMs, timeoutMs, 'the deadline is the deployment policy row, never a new literal');
      const row = error.detail?.waitingOn?.[0];
      assert.equal(row?.workerId, handle.id);
      assert.ok(Array.isArray(row?.waiting) && row.waiting.length > 0, 'the wait is named');
      const entry = row.waiting.find((candidate) => candidate?.resource === 'local_resources:localAuthority');
      assert.ok(entry, 'the local authority hold is named as an entry');
      assert.equal(entry.reaper, 'exact-close-cleanup', 'the entry names the reaper it waits on');
      const since = Date.parse(entry.since);
      assert.ok(!Number.isNaN(since) && since <= Date.now() && since >= observedAt - 5,
        'the entry names since when the drain has been waiting');
      assert.ok(Array.isArray(row.released), 'the row carries the released rows');
      return true;
    });
});

test('360d: the enriched wait rows replay from the durable worker log', async (t) => {
  const { driver, handle, idempotencyKey } = await wedgedDrainFixture(t, 'd', 'issue360d-drain');
  let detail = null;
  await assert.rejects(
    driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey }),
    (error) => { detail = error.detail; return error.code === 'coordinator_drain_incomplete'; });

  const named = driver.log.read(handle.id).filter((event) => event.kind === 'control.stop_waiting_on');
  assert.ok(named.length >= 1, 'the named wait is durable in the worker log');
  const payload = named.at(-1).payload;
  assert.equal(payload.status, 'dead');
  const entry = (payload.waiting ?? []).find((candidate) => candidate?.resource === 'local_resources:localAuthority');
  assert.ok(entry, 'the durable row names the waited resource');
  assert.equal(entry.reaper, 'exact-close-cleanup');
  assert.ok(!Number.isNaN(Date.parse(entry.since)), 'the durable row carries since');
  assert.ok(Array.isArray(payload.released), 'the durable row carries the released rows');

  // Replay parity: a fresh Log instance over the same directory reads the same enriched row,
  // and the thrown detail agrees with the durable record.
  const replayed = new Log(driver.log.dir).read(handle.id)
    .filter((event) => event.kind === 'control.stop_waiting_on').at(-1).payload;
  assert.deepEqual(replayed, payload, 'the enriched fields replay byte-for-byte');
  assert.deepEqual(detail.waitingOn[0].waiting, payload.waiting, 'the thrown detail matches the durable row');
});
