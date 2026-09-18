// Issue #472 — `host.stopped` names abandoned workers as a first-class list, and a stop that
// abandons a worker still mints its outcome row.
//
// HAND-BACK from lane ds-467 (#467, landed 93f675d5). #467 made a stop BOUNDED: past the two
// deadlines it spends per worker, the worker it stopped waiting on is named `abandoned` durably
// (`control.stop_abandoned` on the worker's log, `drain.worker_abandoned` on the ledger). Two
// shapes were still wrong:
//   (a) the abandonment rode INSIDE the stop's `released` list as a `{how: 'abandoned'}` row — a
//       release it was not — and the outcome had no list of its own for it;
//   (b) the stop could not CONVERGE on such a worker at all: the drain kept counting its holds, the
//       writer lease stayed held, and NO `host.stopped` row existed — the ledger said nothing about
//       how the stop ended, and the resident died without an outcome.
//
// The rows below pin the landed truth: the abandoned workers are their own list on `host.stopped`
// (`abandoned: [{workerId, attempt, alive}]`, beside `released` and never inside it), a stop that
// abandons still mints that row, and a stop that abandons nobody carries the list EMPTY — never
// absent, so a reader never has to guess.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import test from 'node:test';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
const selection = Object.freeze({ exact: ROUTE, scope: ['impl/**'] });

/** The adapter card the resident's own self-check requires (phase89), over the mock scenario. */
function deploymentAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 120_000, summary: 'issue472 fixture' },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue472-fixture', refreshedAt: null,
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

function initRepo(repo) {
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Issue 472 stop'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue472@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A deployment opened in-process with its driver in hand (the issue467/issue450 pattern), served
 * through the ordinary resident host: the stop under test is the DEPLOYMENT's
 * (`deployment.close()`), the same path `baton serve`'s signal handler runs.
 */
async function fixture(t, label, { drainTimeoutMs = 350, stopDeadlineMs = 200, webDrainMs = 300 } = {}) {
  // The resident's own socket path is bounded by sun_path (103 bytes) and the suite root on this
  // host is deep, so the fixture root is short (the issue351/issue383 idiom).
  const directory = mkdtempSync(`/tmp/bt472-${label}-`);
  const repo = join(directory, 'repo');
  initRepo(repo);
  const home = join(directory, 'home');
  const configRoot = join(directory, 'config');
  mkdirSync(home, { recursive: true });
  mkdirSync(configRoot, { recursive: true });
  const env = { HOME: home, XDG_CONFIG_HOME: configRoot, PATH: process.env.PATH ?? '' };
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  const priorBypass = process.env[bypassName];
  process.env[bypassName] = bypassValue;
  let driver = null;
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: join(directory, 'deployment'),
      adapters: { mock: deploymentAdapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env, home, webDrainMs, sessionTtlMs: 60_000, commandTimeoutMs: 30_000, pollMs: 25 },
    },
  }, (options) => {
    driver = createDriver({
      ...options,
      stopDeadlineMs,
      drainPolicy: { maxWorkers: 8, timeoutMs: drainTimeoutMs, pollMs: 10 },
    });
    return driver;
  });
  if (priorBypass === undefined) delete process.env[bypassName];
  else process.env[bypassName] = priorBypass;
  try {
    // The resident is SERVING before the stop begins: every row here is about the stop a served
    // resident takes.
    await deployment.host();
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
  t.after(async () => {
    try { await deployment.close(); } catch { /* closed by the test or the fixture */ }
    rmSync(directory, { force: true, recursive: true });
  });
  return { deployment, driver, repo, directory };
}

/** One seat whose worker the stop has to converge on (the deployment's own profile). */
async function recruitSeat(deployment, driver, swarmId) {
  await deployment.swarms.create('Hold a seat through the resident stop', {
    swarmId, idempotencyKey: `create:${swarmId}`,
  });
  const swarm = deployment.swarms.open(swarmId);
  const seat = await swarm.recruit('builder', 'Hold a turn through the resident stop', {
    options: selection, idempotencyKey: `recruit:${swarmId}:builder`,
  });
  const deadline = Date.now() + 20_000;
  for (;;) {
    const row = driver.coordinator.list().find((candidate) => candidate.runId === seat.runId) ?? null;
    if (row && row.status === 'working') return { seat, worker: row, handle: driver.coordinator._workers.get(row.id) };
    if (Date.now() >= deadline) throw new Error(`seat never started working: ${seat.runId}`);
    await sleep(10);
  }
}

/** The 467b subject: a recovered authority with NO observable pid — nothing a dead process can
 * never send (no adapter receipt, no correlated close) can settle it, so the stop spends its
 * bounded attempts on it and abandons it. */
function unobservableProcess(handle) {
  handle.processRef = {
    generation: 0, pid: null, processGroupId: null,
    state: 'unconfirmed_after_restart', ready: false, startedSeq: null, closedSeq: null,
  };
}

/** The durable `host.*` rows the deployment recorded on the resident's ledger. */
const stopRows = (driver) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded'
    && typeof event.payload?.kind === 'string' && event.payload.kind.startsWith('host.'))
  .map((event) => event.payload);

/** The lines this incarnation narrated into its own serve log (the deployment's public handle). */
function serveLines(deployment) {
  const log = deployment.serveLog();
  assert.ok(log, 'a served resident names its own serve log');
  try { return readFileSync(log.path, 'utf8').split('\n'); } catch { return []; }
}

// ── (a) the abandoned worker is its OWN list on the outcome, and the outcome exists ─────────────
test('472a: a stop that abandons a worker mints host.stopped with the abandoned list beside released', async (t) => {
  const { deployment, driver } = await fixture(t, 'a');
  const { worker, handle } = await recruitSeat(deployment, driver, 'issue472a');
  unobservableProcess(handle);

  const receipt = await deployment.close().catch((error) => error);
  assert.equal(receipt instanceof Error, false, `the stop must not fail: ${receipt?.code} ${receipt?.message}`);

  // (1) The outcome row EXISTS — the whole of what item 2 is about: the writer-lease release ran,
  //     so the ledger says how the stop ended instead of going silent about it.
  const stopped = stopRows(driver).find((row) => row.kind === 'host.stopped');
  assert.ok(stopped, `the abandoned stop mints its outcome: ${JSON.stringify(stopRows(driver).map((row) => row.kind))}`);

  // (2) The abandoned worker is a FIRST-CLASS list: {workerId, attempt, alive} beside `released`.
  assert.ok(Array.isArray(stopped.abandoned), `the outcome carries the abandoned list: ${JSON.stringify(stopped)}`);
  assert.deepEqual(stopped.abandoned.map((row) => row.workerId), [worker.id]);
  const [row] = stopped.abandoned;
  assert.equal(row.attempt, 2, `the bounded attempt rides the row: ${JSON.stringify(stopped.abandoned)}`);
  assert.equal(row.alive, null, `an unobservable worker is reported unobserved: ${JSON.stringify(stopped.abandoned)}`);

  // (3) …and NEVER inside `released`: an abandonment is not a release, and no release row may name
  //     the worker (its holds were not released — that is exactly what abandonment says).
  assert.ok(Array.isArray(stopped.released), `the released list is present: ${JSON.stringify(stopped)}`);
  assert.equal(stopped.released.some((entry) => entry.workerId === worker.id), false,
    `an abandoned worker never rides released: ${JSON.stringify(stopped.released)}`);
  assert.equal(stopped.released.some((entry) => entry.how === 'abandoned'), false,
    `no release row claims an abandonment: ${JSON.stringify(stopped.released)}`);
  assert.equal(driver.coordinator.releasedResources().some((entry) => entry.workerId === worker.id), false,
    `the coordinator's own release sink names it too: ${JSON.stringify(driver.coordinator.releasedResources())}`);

  // (4) The abandonment is still named durably, and the resident's exit state is a stop: the
  //     abandoned worker is the NAMED remainder, not an unreleased obligation of this resident.
  assert.ok(driver.coordination.eventsView().some((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'drain.worker_abandoned' && event.payload?.workerId === worker.id),
  'the drain still records the abandonment as its own durable row');
  const abandoned = driver.coordinator.abandonedWorkers();
  assert.deepEqual(abandoned.map((entry) => entry.workerId), [worker.id],
    `the ONE reader names the worker: ${JSON.stringify(abandoned)}`);
  assert.equal(receipt.state, 'closed',
    `nothing but the named abandonment stayed unreleased: ${JSON.stringify(receipt.state)}`);
  assert.equal(stopped.state, 'stopped_after_deadline',
    `the outcome still says how the stop ended: ${JSON.stringify(stopped.state)}`);
});

// ── (b) the narration line names the abandoned list ────────────────────────────────────────────
test('472b: the stop line names the abandoned workers beside its outcome', async (t) => {
  const { deployment, driver } = await fixture(t, 'b');
  const { worker, handle } = await recruitSeat(deployment, driver, 'issue472b');
  unobservableProcess(handle);

  const receipt = await deployment.close().catch((error) => error);
  assert.equal(receipt instanceof Error, false, `the stop must not fail: ${receipt?.code} ${receipt?.message}`);

  // The line is composed by the deployment's own `stopped` step and narrated through the host into
  // this incarnation's serve log — the operator's half of the row the release mints.
  const line = serveLines(deployment).find((candidate) => candidate.includes('host.stopped stopped_after_deadline'));
  assert.ok(line, `the stop said its outcome: ${JSON.stringify(serveLines(deployment).slice(-8))}`);
  assert.ok(line.includes(`(abandoned 1: ${worker.id} attempt 2`),
    `the line names the abandoned list: ${line}`);
});

// ── (c) a stop that abandons nobody carries the list EMPTY, never absent ───────────────────────
test('472c: a stop that abandons nobody carries abandoned: []', async (t) => {
  const { deployment, driver } = await fixture(t, 'c', { drainTimeoutMs: 4_000, stopDeadlineMs: 8_000 });

  // Nothing to abandon: the resident stops its own (empty) fleet the ordinary way.
  const receipt = await deployment.close().catch((error) => error);
  assert.equal(receipt instanceof Error, false, `the stop must not fail: ${receipt?.code} ${receipt?.message}`);
  const stopped = stopRows(driver).find((row) => row.kind === 'host.stopped');
  assert.ok(stopped, `the ordinary stop mints its outcome: ${JSON.stringify(stopRows(driver).map((row) => row.kind))}`);
  assert.deepEqual(stopped.abandoned, [],
    `an ordinary stop carries the list empty, never absent: ${JSON.stringify(stopped)}`);
  assert.deepEqual(stopped.released, [],
    `and releases nothing it did not release: ${JSON.stringify(stopped.released)}`);
  assert.equal(driver.coordinator.abandonedWorkers().length, 0,
    `no worker was abandoned: ${JSON.stringify(driver.coordinator.abandonedWorkers())}`);
  assert.equal(receipt.state, 'closed', `an ordinary stop closes: ${JSON.stringify(receipt.state)}`);
});
