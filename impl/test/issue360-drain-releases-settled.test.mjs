// Issue #360 — `baton serve` exited SIGTERM with application_host_shutdown_failed after every
// seat was stopped: the fleet drain waited its whole deadline (reason deadline, stage
// convergence, deadline 90000ms) on resources a dead worker with a closed process still held
// (local_resources:localAuthority + local_resources:worktree + local_resources:cleanupPending),
// and nobody would ever release them.
//
// The contract this file pins:
//   (a) a seat stopped through swarm.stop whose worker process is closed is RELEASED by the
//       drain itself — the reap goes through the #428/#435 custody boundary (capture-or-retain,
//       never a bare delete) — the drain converges and the shutdown exits zero; a hold nothing
//       could ever release is released with reason `orphaned`, never waited on;
//   (b) waitingOn[].waiting entries carry {resource, reaper, since} so an operator reads which
//       release is pending;
//   (c) the enriched fields replay byte-for-byte from the durable worker log.
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

const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});
const orchestrator = principal('orchestrator');
const command = (app, name, args) => app.command(name, args, orchestrator);

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

async function fixture(t, { label = 'seat' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue360-${label}-`));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(directory, 'log'),
    adapters: { mock: workingAdapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 4_000,
    drainPolicy: { pollMs: 10 },
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

test('360a: a capture that fails releases the handle hold and names the retention, and the shutdown exits zero', async (t) => {
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
  assert.equal(driver.coordinator._ownsLocalResources(handle), false,
    'the stop released what the failed capture could not reap (issue #583)');
  assert.equal(handle.cleanupPromise, null, 'no in-flight cleanup is left that could release them');
  assert.ok(driver.coordination.runStop(seat.runId), 'the seat stop is durably admitted');
  assert.equal(handle.worktree, null, 'the handle released the checkout');
  assert.equal(existsSync(cwd), true,
    'capture-or-retain: the failed capture keeps the seat work on disk');
  assert.ok(driver.log.read(worker.id).some((event) => event.kind === 'worktree.custody_content_retained'
    && event.payload?.physicalOwnerId === ownerId),
    'the custody retention is recorded on the worker log with its physical owner');

  // The shutdown then exits zero: nothing the stop left behind is a hold the drain must settle.
  const application = await app.shutdown(principal('drain'));
  assert.equal(application.state, 'closed',
    'the shutdown exits zero after the stop released the checkout it could not reap');
});

// --- (c): the drain names the wait it observes, per resource ----------------------------------

function drainFixture(t, { timeoutMs = 400, label = 'c' } = {}) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue360-${label}-`));
  const repo = join(world, 'repo');
  initRepo(repo);
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } },
  });
  const driver = createDriver({
    repoRoot: repo, logDir: join(world, 'log'), repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { pollMs: 5 }, watchdog: { stallMs: 60_000 },
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

test('360c: the drain names the wait it observes durably, releases a dead participant\'s hold and converges (issue #631)', async (t) => {
  const { driver, handle, idempotencyKey } = await wedgedDrainFixture(t, 'c', 'issue360c-drain');
  const draining = driver.coordinator.drain({ actor: 'orchestrator', repoId: 'repo-a', idempotencyKey });
  // Issue #583: the drain waits until it converges, and it names the wait it OBSERVES — the durable
  // row lands on the worker's own log while the hold stands, with no window deciding when.
  const deadline = Date.now() + 8_000;
  let named = [];
  while (Date.now() < deadline) {
    named = driver.log.read(handle.id).filter((event) => event.kind === 'control.stop_waiting_on');
    if (named.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(named.length >= 1, 'the named wait is durable in the worker log');
  const payload = named.at(-1).payload;
  assert.equal(payload.status, 'dead');
  const entry = (payload.waiting ?? []).find((candidate) => candidate?.resource === 'local_resources:localAuthority');
  assert.ok(entry, 'the durable row names the waited resource');
  assert.equal(entry.reaper, 'drain-reap', 'the entry names the drain\'s own reap as the reaper (#631)');
  assert.ok(!Number.isNaN(Date.parse(entry.since)), 'the durable row carries since');
  assert.ok(Array.isArray(payload.released), 'the durable row carries the released rows');

  // Replay parity: a fresh Log instance over the same directory reads the same enriched row.
  const replayed = new Log(driver.log.dir).read(handle.id)
    .filter((event) => event.kind === 'control.stop_waiting_on').at(-1).payload;
  assert.deepEqual(replayed, payload, 'the enriched fields replay byte-for-byte');

  // Issue #631: the drain finishes once every participant's process has exited. The stale hold the
  // scripted failure keeps is released by the drain itself — never waited on, and never a bare
  // delete: the custody boundary preserves the checkout and the release is named durably.
  const receipt = await draining;
  assert.equal(receipt.remainingCount, 0, 'the drain converged on the observed process exit');
  const releasedRows = driver.coordinator.releasedResources()
    .filter((row) => row.workerId === handle.id)
    .map((row) => `${row.resource}:${row.how}`);
  assert.ok(releasedRows.includes('local_resources:localAuthority:orphaned'),
    'the drain released the dead participant\'s stale hold and named it orphaned');
  assert.equal(driver.coordinator._ownsLocalResources(driver.coordinator._workers.get(handle.id)), false,
    'the dead participant holds nothing after the drain released it');
});
