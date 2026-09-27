// Issue #450 — the primary resident's SIGTERM after every seat was stopped: the stop's durable
// named-wait rows and the participant narration it records on the request.
//
// What this file pins:
//   (c) a stop whose participant count refuses records the refusal ON `host.stop_requested`
//       (`participants: {count: null, refusal: {read, code}}`) and still proceeds to its outcome
//       within the declared idle bound, and a narration read that never answers cannot hold the
//       stop either;
//   (d) the run-stop leg's wait entries are the #360 entry objects `{resource, reaper, since}` —
//       one shape with the fleet drain's, never a second vocabulary.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { BatonWebHost } from '../src/application-host.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { Log } from '../src/log.mjs';
import { fixtureSocketRoot } from './fixture-root.mjs';

const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

function initRepo(repo) {
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 450 stop', GIT_COMMITTER_NAME: 'Issue 450 stop' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue450@example.invalid', GIT_COMMITTER_EMAIL: 'issue450@example.invalid' });
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

// --- the deployment's own stop request: the durable row ---------------------------------------

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

/** A deployment opened in-process with its driver in hand (the phase85 pattern): the durable
 *  `host.*` row under test is written through the deployment's own seam, which no
 *  coordinator-level fixture builds. */
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

// --- (c): the stop names its waits, including a refused participant count --------------------

const drainReceipt = { state: 'closed' };

/** A BatonWebHost over the smallest honest application/server pair: the host's own stop path (the
 *  narration read, the named waits, the drain) is what these rows exercise, and the durable
 *  `host.*` rows are the ones a deployment records through the same seam. */
function hostFixture(t, { stopRecords, application, label }) {
  // sun_path is 103 bytes: the fixture root has to stay short (the issue351 fixtures' own rule).
  const directory = fixtureSocketRoot(`bt450-${label}-`, 'host.sock');
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
