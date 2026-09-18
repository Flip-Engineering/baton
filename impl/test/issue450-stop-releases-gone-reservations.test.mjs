// Issue #450 — the primary resident's SIGTERM after every seat was stopped: 222 s of silence
// between `host.stop_requested` and the web shutdown, then
// 'driver capacity reservations remained after fleet drain' with zero drain targets — exit
// non-zero and no `host.stopped` row. #360 releases the reservation of a *settled holder the drain
// reaps*; with `targetWorkerIds: []` there was no holder to reap, and the reservation belonged to a
// worker that had been killed and confirmed two minutes earlier. Two gaps:
//
//   (1) the kill path leaves a reservation behind for a worker it watched die — the checkout is
//       retained (or already gone) while `worker:<owner>` stays durable, and the next stop then
//       fails on it. #360's release is reached only through the drain's settled-holder reap;
//   (2) every wait the stop takes past its first second is supposed to be a durable
//       `host.stop_waiting` row naming {resource, reaper, since} (#351/#360), and #437's refused
//       participant count is itself a wait that must be named rather than becoming a silent
//       deadline — the run-stop leg (`stopRunTargets`) still names its waits with bare strings.
//
// What this file pins:
//   (a) a worker killed and confirmed with its checkout retained releases its capacity reservation
//       through the capacity authority with the named reason `worker_gone`, and the release is its
//       own durable row — never a ledger scan at stop time;
//   (b) a stop whose fleet drain has zero targets and whose reservation's worker is already closed
//       releases it, names it, converges inside the deployment's own bound and writes
//       `host.stopped` with a zero exit — the exact row 'driver capacity reservations remained
//       after fleet drain' used to replace;
//   (c) a stop whose participant count refuses records the refusal ON `host.stop_requested`
//       (`participants: {count: null, refusal: {read, code}}`) and still proceeds to its outcome
//       within the declared idle bound, and a narration read that never answers cannot hold the
//       stop either;
//   (d) the run-stop leg's wait entries are the #360 entry objects `{resource, reaper, since}` —
//       one shape with the fleet drain's, never a second vocabulary.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { BatonWebHost } from '../src/application-host.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { BatonApplication, MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import { Log } from '../src/log.mjs';

const repoId = 'repo-issue450';

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

const DRAIN_TIMEOUT_MS = 4_000;

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
  execFileSync('git', ['config', 'user.name', 'Issue 450 stop'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue450@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

async function fixture(t, { label = 'seat' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue450-${label}-`));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(directory, 'log'),
    adapters: { mock: workingAdapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 4_000,
    drainPolicy: { maxWorkers: 8, timeoutMs: DRAIN_TIMEOUT_MS, pollMs: 10 },
    worktreeCapacity: capacityPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 16 * 1024, inodes: 32 }),
    worktreeCapacityObserve: () => ({ freeBytes: 1024 * 1024 * 1024, freeInodes: 1_000_000 }),
  });
  // The deployment's own wiring (`openBatonDeployment`), repeated here because this fixture builds
  // the driver directly: the controller reaches the authority's cleanup settlement, which is the
  // only seam that can settle a reservation whose checkout the custody boundary retained.
  driver.coordinator.attachCapacitySettlement(
    (resource) => driver.worktreeCapacity.settleForCleanup(resource),
  );
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
  return { app, driver, repo, directory };
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
  const deadline = Date.now() + 10_000;
  for (;;) {
    const worker = driver.coordinator.list().find((row) => row.runId === runId) ?? null;
    if (worker && worker.status === 'working') return worker;
    if (Date.now() >= deadline) throw new Error(`seat never started working: ${runId}`);
    await sleep(10);
  }
}

const reservations = (driver) => {
  const snapshot = driver.worktreeCapacity.snapshot();
  return snapshot.reservations.map((row) => row.id);
};

const releaseRows = (driver, workerId) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'drain.resource_released'
    && event.payload?.workerId === workerId)
  .map((event) => event.payload);

/** The custody boundary the incident's seat stop ran into: the checkout holds content no capture
 *  recorded, so the #428/#435 preserve-then-reap authority RETAINS it — never a bare delete. The
 *  stopping handle releases its hold (the checkout is the reconciliation authority's), the seat's
 *  work stays on disk, and its capacity reservation is then the ONE obligation nothing left behind
 *  a live worker still accounts for — exactly the row a zero-target drain used to fail on. */
function retainCheckout(driver) {
  const worktrees = driver.coordinator._worktrees;
  worktrees.remove = async () => {
    throw Object.assign(new Error('worktree retained: content no capture recorded'), {
      code: 'workspace_uncommitted_content_retained',
      retained: true,
      observation: { state: 'dirty', dirtyPaths: ['carried.txt'], headSha: null, baseSha: null },
    });
  };
}

test('450a: the kill path releases the reservation of the worker it watched die', async (t) => {
  const { app, driver } = await fixture(t, { label: 'a' });
  const swarmId = 'issue450a';
  await createSwarm(app, swarmId);
  const seat = await recruit(app, { swarmId, participantId: 'builder', objective: 'Hold a reservation through a kill' });
  const worker = await working(driver, seat.runId);
  const handle = driver.coordinator._workers.get(worker.id);
  const ownerId = worker.sessionContext.ownerTaskId;
  const capacityId = `worker:${ownerId}`;
  assert.ok(reservations(driver).includes(capacityId), 'the live seat holds its own reservation');

  retainCheckout(driver);
  await stopParticipant(app, { swarmId, participantId: 'builder', reason: 'Seat stopped seconds before SIGTERM' })
    .catch((error) => error);
  // The worker is dead and confirmed; the checkout is retained (capture-or-retain) so the handle
  // released it — nothing live is left behind the reservation.
  assert.equal(handle.status, 'dead', 'the seat stop killed the worker');
  assert.ok(!handle.processRef || handle.processRef.state === 'closed', 'its process is exactly closed');
  assert.equal(driver.coordinator._ownsLocalResources(handle), false,
    'the retained checkout released the stopping handle');

  const released = releaseRows(driver, worker.id);
  assert.deepEqual(
    released.filter((row) => row.resource === capacityId).map((row) => row.how),
    ['worker_gone'],
    `the reservation is released with the named reason worker_gone: ${JSON.stringify(released)}`);
  assert.equal(reservations(driver).includes(capacityId), false,
    'a reservation with no live worker behind it is never left for the next stop to fail on');
});

test('450b: a stop with zero drain targets releases and names the gone worker\'s reservation', async (t) => {
  const { app, driver } = await fixture(t, { label: 'b' });
  const swarmId = 'issue450b';
  await createSwarm(app, swarmId);
  const seat = await recruit(app, { swarmId, participantId: 'builder', objective: 'Hold a reservation into a zero-target drain' });
  const worker = await working(driver, seat.runId);
  const ownerId = worker.sessionContext.ownerTaskId;
  const capacityId = `worker:${ownerId}`;
  retainCheckout(driver);
  await stopParticipant(app, { swarmId, participantId: 'builder', reason: 'Seat stopped before SIGTERM' })
    .catch((error) => error);

  // The resident's own stop: the seat is stopped and holds nothing, so the fleet drain binds an
  // EMPTY target set — the incident's `fleet.drain_admitted targetWorkerIds: []` — while the
  // reservation the gone worker left is still on the books. At HEAD this is where the stop died:
  // the drain converged, the deployment's own capacity quiescence check then threw
  // 'driver capacity reservations remained after fleet drain', and no host.stopped row was written.

  driver.coordination.armHostStopOutcome({
    state: 'stopped',
    actor: `deployment:${repoId}:resident`,
    key: `host.stop:issue450b:stopped`,
  });
  const startedAt = Date.now();
  const receipt = await driver.drainAndClose('resident:issue450b');
  const elapsed = Date.now() - startedAt;
  assert.equal(receipt.state, 'closed', 'the stop exits zero');
  assert.ok(elapsed < DRAIN_TIMEOUT_MS * 4, `the stop converges inside its declared bound; it took ${elapsed}ms`);
  const admitted = driver.coordination.eventsView().find((event) => event.kind === 'fleet.drain_admitted');
  assert.deepEqual(admitted?.payload?.targetWorkerIds ?? null, [],
    'the drain had nothing left to target — the shape the incident died on');
  assert.equal(reservations(driver).includes(capacityId), false,
    'the stop released the reservation whose worker was already gone');
  const released = releaseRows(driver, worker.id);
  assert.ok(released.some((row) => row.resource === capacityId && row.how === 'worker_gone'),
    `the release is durable and named: ${JSON.stringify(released)}`);

  const stopped = driver.coordination.eventsView()
    .find((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'host.stopped');
  assert.ok(stopped, 'host.stopped is written — the stop never failed on a reservation it could release');
  assert.equal(stopped.payload.state, 'stopped');
});

// --- the deployment's own stop: the wiring and the resident's outcome -------------------------

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });

/** The adapter card the resident's own self-check requires (phase89), over the mock scenario. */
function deploymentAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 120_000, summary: 'issue450 fixture' },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue450-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
  });
  return adapter;
}

/** The durable `host.*` rows the deployment recorded on the resident's ledger. */
const stopRows = (driver) => driver.coordination.eventsView().filter((event) => (
  event.kind === 'driver.recorded' && typeof event.payload?.kind === 'string'
  && event.payload.kind.startsWith('host.'))).map((event) => event.payload);

/** A deployment opened in-process with its driver in hand (the phase85 pattern): the stop under
 *  test is the deployment's own (`deployment.close()`), including the capacity settlement it hands
 *  the coordinator at open — the wiring no coordinator-level fixture can prove. */
async function deploymentFixture(t, label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue450-${label}-`));
  const repo = join(directory, 'repo');
  initRepo(repo);
  let driver = null;
  // The ordinary resident's own bypass (BATON_HOST_CAPACITY_DISABLED): this fixture spawns a worker
  // on whatever machine the suite runs on, and the host-capacity admission gate must never decide
  // whether the row under test can be built.
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  const priorBypass = process.env[bypassName];
  process.env[bypassName] = bypassValue;
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: join(directory, 'deployment'),
      adapters: { mock: deploymentAdapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { webDrainMs: 1_500 },
    },
  }, (options) => { driver = createDriver(options); return driver; });
  if (priorBypass === undefined) delete process.env[bypassName];
  else process.env[bypassName] = priorBypass;
  t.after(async () => {
    try { await deployment.close(); } catch { /* closed by the test or the fixture */ }
    rmSync(directory, { force: true, recursive: true });
  });
  return { deployment, driver, repo, directory };
}

test('450e: the deployment\'s own stop releases the gone worker\'s reservation and exits zero', async (t) => {
  const { deployment, driver } = await deploymentFixture(t, 'e');
  // The same seat path the deployment's own swarm facade drives (`swarm.create` / `swarm.recruit`
  // / `swarm.stop`) — the seat that ran into the outage.
  await deployment.swarms.create('Hold a reservation through the resident stop', {
    swarmId: 'issue450e', idempotencyKey: 'create:issue450e',
  });
  const swarm = deployment.swarms.open('issue450e');
  const seat = await swarm.recruit('builder', 'Hold a reservation through a stop', {
    options: selection, idempotencyKey: 'recruit:issue450e:builder',
  });
  const worker = await working(driver, seat.runId);
  const capacityId = `worker:${worker.sessionContext.ownerTaskId}`;
  assert.ok(reservations(driver).includes(capacityId), 'the live seat holds its own reservation');

  retainCheckout(driver);
  await swarm.stop('builder', 'Seat stopped seconds before SIGTERM', {
    idempotencyKey: 'stop:issue450e:builder',
  });
  const handle = driver.coordinator._workers.get(worker.id);
  assert.equal(handle.status, 'dead', 'the seat stop killed the worker');
  assert.ok(!handle.processRef || handle.processRef.state === 'closed', 'its process is exactly closed');

  // The resident's own stop: the fleet drain has nothing left to target, so the reservation the
  // gone seat left behind is the ONE obligation on the books. The deployment hands the coordinator
  // the authority's own settlement (the wiring this row exists to prove) — and the stop converges.
  const receipt = await deployment.close();
  assert.equal(receipt.state, 'closed', 'the resident stop exits zero');
  assert.equal(reservations(driver).includes(capacityId), false,
    'the stop released the reservation whose worker was already gone');
  assert.ok(releaseRows(driver, worker.id).some((row) => row.resource === capacityId && row.how === 'worker_gone'),
    `the release is a durable row named worker_gone: ${JSON.stringify(releaseRows(driver, worker.id))}`);
  const stopped = stopRows(driver).find((row) => row.kind === 'host.stopped');
  assert.ok(stopped, 'host.stopped is written — the deployment\'s own stop never failed on it');
  assert.equal(stopped.state, 'stopped');
});

// --- (c): the stop names its waits, including a refused participant count --------------------

const drainReceipt = { state: 'closed' };

/** A BatonWebHost over the smallest honest application/server pair: the host's own stop path (the
 *  narration read, the named waits, the drain) is what these rows exercise, and the durable
 *  `host.*` rows are the ones a deployment records through the same seam. */
function hostFixture(t, { stopRecords, application, label }) {
  // sun_path is 103 bytes: the fixture root has to stay short (the issue351 fixtures' own rule).
  const directory = mkdtempSync(`/tmp/bt450-${label}-`);
  const lines = [];
  // The smallest server that satisfies the host's own contract: the stop path this file exercises
  // never listens, and `batonShutdown` is the Web leg's own receipt.
  const server = {
    once() { return this; },
    off() { return this; },
    on() { return this; },
    listen() { return this; },
    async batonShutdown() { return { ok: true, result: 'closed' }; },
    close() {},
    closeAllConnections() {},
  };
  const host = new BatonWebHost({
    application,
    server,
    shutdownPrincipal: principal('operator'),
    listen: { path: join(directory, 'host.sock') },
    webDrainMs: 1_500,
    report: (line) => lines.push(line),
    stopRecords,
  });
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return { host, lines };
}

test('450c: the request row carries the participant count, and a refused read is a fact', async (t) => {
  const { deployment, driver } = await deploymentFixture(t, 'c');
  // The projection the count is read from, refused: this deployment holds no live participant
  // projection, which is the ONE refusal `ownedParticipantCount` answers with.
  const list = driver.coordinator.list.bind(driver.coordinator);
  driver.coordinator.list = undefined;
  assert.equal(deployment.recordStopRequested('SIGTERM') !== null, true, 'the request row lands');
  driver.coordinator.list = list;
  const rows = stopRows(driver).filter((row) => row.kind === 'host.stop_requested');
  assert.equal(rows.length, 1, `the stop request is exactly one row: ${JSON.stringify(rows)}`);
  assert.equal(rows[0].trigger, 'SIGTERM');
  assert.deepEqual(rows[0].participants, {
    count: null,
    refusal: { read: 'coordinator.participants', code: 'application_host_narration_unavailable' },
  }, 'a refused count is ON the request row — the refusal itself is the named wait, never a silent hole');
});

test('450c2: a narration read that never answers cannot hold the stop', async (t) => {
  const waits = [];
  const { host } = hostFixture(t, {
    label: 'c2',
    application: { ready: Promise.resolve(), shutdown: async () => drainReceipt },
    stopRecords: {
      requested: () => ({ line: 'baton serve: host.stop_requested trigger SIGTERM' }),
      waiting: async ({ wait }) => {
        waits.push(wait);
        return { line: `baton serve: host.stop_waiting on ${wait.on}`, released: false };
      },
      stopped: () => ({ line: 'baton serve: host.stopped stopped' }),
      stage: () => {},
      participants: () => new Promise(() => {}),
      narrationRefused: () => null,
    },
  });
  // The signal handler's own order: the intent is announced, then the stop runs.
  host._announceIntent({ kind: 'SIGTERM' });
  const startedAt = Date.now();
  const settled = await Promise.race([
    host.shutdown().then(() => 'closed'),
    sleep(8_000).then(() => 'timeout'),
  ]);
  const elapsed = Date.now() - startedAt;
  assert.equal(settled, 'closed', `a stop is not held by a read that never answers (${elapsed}ms)`);
  assert.ok(elapsed < 8_000, `the stop proceeds inside its declared bound; it took ${elapsed}ms`);
  assert.ok(waits.some((wait) => wait.on === 'participants' || (wait.entries ?? []).some((entry) => entry.resource === 'participants')),
    `the wait it took is durable and named: ${JSON.stringify(waits)}`);
  for (const wait of waits) {
    for (const entry of wait.entries ?? []) {
      assert.deepEqual(Object.keys(entry).sort(), ['reaper', 'resource', 'since'],
        `every named wait entry is the ONE #360 shape: ${JSON.stringify(entry)}`);
    }
  }
});

// --- (d): one wait-entry shape --------------------------------------------------------------

/** A spy conforming to the WorktreeManager contract (spec §3.2): only the methods the Run-stop
 *  leg reads, with a checkout that refuses to go away (the one hold a stop cannot release). */
class RefusingWorktreeManager {
  constructor() { this.calls = { remove: [] }; }
  async create(taskId, baseRef) {
    return { path: `/tmp/issue450-wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' };
  }
  async capture() { return { sha: 'sha-result' }; }
  async remove(taskId) {
    this.calls.remove.push({ taskId });
    throw Object.assign(new Error('checkout is busy'), { code: 'worktree_busy' });
  }
  async reconcile() {}
  worktreeAvailable() { return true; }
}

/** The Coordinator's own Adapter contract (D1), scripted: the kill is ACKED immediately and the
 *  confirmation event is never emitted, so the forced stop leaves the holds that name the wait. */
class ScriptedAdapter {
  constructor() { this.calls = { kill: [] }; this._onEvent = null; }
  card() { return { harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100_000, verbs: { spawn: 'native', interrupt: 'native' } }; }
  onEvent(cb) { this._onEvent = cb; }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

const bareBrief = (goal) => ({
  goal, constraints: [], pathScope: ['.'], definitionOfDone: 'tests pass',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100_000, usd: 5, wallMin: 30 },
});

test('450d: the run-stop leg names its waits with the #360 entry objects', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue450-d-'));
  const log = new Log(join(directory, 'log'));
  const worktrees = new RefusingWorktreeManager();
  let clock = 0;
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(),
    adapters: { mock: new ScriptedAdapter() }, worktrees,
    referee: async (task) => ({
      reverified: true, observedExit: task.brief.verification.expectExit, matchesClaim: true,
      locus: 'fresh_sandbox', evidence: [],
    }),
    route: () => 'mock', now: () => clock,
    approvalTimeoutMs: 60_000, stopDeadlineMs: 50,
    drainPolicy: { maxWorkers: 8, pollMs: 5, timeoutMs: 400 },
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const handle = await coordinator.spawn('mock', bareBrief('hold a named wait'));
  // The kill is forced first (the adapter acks, no terminal ever arrives, the logical deadline
  // sweeps it), so the Run stop below starts from a settled dead handle whose holds never clear;
  // its wall-clock deadline is then the only thing that elapses, whatever the machine load.
  const kill = coordinator.kill(handle.id, 'operator:issue450');
  await until(() => coordinator._stopWaiters.has(handle.id), 'the stop waiter');
  clock += 51;
  coordinator.tick();
  await kill;

  let detail = null;
  await assert.rejects(
    coordinator.stopRunTargets([handle.id], 'operator:issue450'),
    (error) => { detail = error.detail; return error.code === 'coordinator_run_stop_incomplete'; });

  const row = detail?.waitingOn?.[0];
  assert.equal(row?.workerId, handle.id, `the wait names the worker: ${JSON.stringify(detail)}`);
  assert.ok(Array.isArray(row?.waiting) && row.waiting.length > 0, 'the wait is named');
  for (const entry of row.waiting) {
    assert.deepEqual(Object.keys(entry).sort(), ['reaper', 'resource', 'since'],
      `every entry is the ONE #360 shape {resource, reaper, since}: ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.resource, 'string');
    assert.ok(!Number.isNaN(Date.parse(entry.since)), `the entry names since: ${JSON.stringify(entry)}`);
  }
  assert.ok(row.waiting.some((entry) => entry.resource === 'local_resources:localAuthority'),
    `the local authority hold is named as an entry: ${JSON.stringify(row.waiting)}`);

  const named = new Log(log.dir).read(handle.id)
    .filter((event) => event.kind === 'control.stop_waiting_on');
  assert.ok(named.length >= 1, 'the named wait is durable in the worker log');
  assert.deepEqual(named.at(-1).payload.waiting, row.waiting,
    'the durable row carries the same entry objects');
});
