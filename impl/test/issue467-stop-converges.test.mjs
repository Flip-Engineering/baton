// Issue #467 — a host stop must converge on a worker whose process is already gone.
//
// OBSERVED (2026-09-18 13:36Z onward, incarnation instance-499a9fe2…): `host.stop_requested
// {trigger: 'uncaught_exception:EPIPE'}` drained two seats. w-746 was kill-confirmed and reaped in
// two seconds; w-745's PROCESS WAS ALREADY GONE (`ps` showed no omp worker, the resident's RSS had
// dropped to 81 MB) and the stop cycled
//   `control.forced_stop {rule: stop_deadline, mode: kill}` → `control.stop_deadline_cleanup` →
//   `control.stop_waiting_on` → `kill.requested {rule: run_stop}` → `control.stop_requested`
// every 15 s — thirteen times in four minutes — with `host.stop_waiting {on: 'worker', ids:
// [w-745]}` and `host.stopped` never landing. The web host was closed for the whole drain (every
// CLI call answered `cli_transport_failed`), and the process died with no outcome row at all: a
// resident that had neither served nor exited, holding its publication lease.
//
// The three gaps this file pins, row by row:
//   (a) the kill path treats ESRCH / a reaped pid as `kill.confirmed` — the process is gone, which
//       is what a kill wanted — so the drain disposition settles and the deadline cleanup never
//       re-arms the wait it just failed;
//   (b) a worker the kill cannot reach (ESRCH from the first attempt, no confirmation a dead
//       process can ever send) converges BY the bounded attempts: the wait row carries the attempt
//       and the pid/group liveness the resident observed, the second deadline is the last, and the
//       worker the stop stopped waiting on is named `abandoned` — never a third wait;
//   (c) the served transport stays OPEN for reads while the stop drains: a resident in `stopping`
//       still says so over its own transport (`state: 'stopping'` beside the wait rows it holds),
//       where `cli_transport_failed` used to hide the whole state.
//
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { discoverBatonConnection } from '../src/application-cli.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { processAuthorityPayload } from '../src/process-lifecycle.mjs';


const repoId = 'repo-issue467';
const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });

/** One authenticated read of the resident's served card over its own Unix socket — the read
 * `baton doctor` makes of a live resident (`GET /v1/application-card`), taken at the transport
 * level so the row under test is the TRANSPORT's answer and not the CLI's refusal composition. */
function cardOverSocket(connection, repoId) {
  const request = [
    'GET /v1/application-card HTTP/1.1',
    'host: localhost',
    `origin: ${connection.origin}`,
    `authorization: Bearer ${connection.token}`,
    'sec-fetch-site: none',
    'connection: close',
    '', '',
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    const client = connect(connection.socketPath);
    let data = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const [head, ...rest] = data.split('\r\n\r\n');
      const status = Number.parseInt((head.split('\r\n')[0] ?? '').split(' ')[1] ?? '', 10);
      const raw = rest.join('\r\n\r\n');
      let body = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      resolve({ status, body });
    };
    client.on('connect', () => client.write(request));
    client.on('data', (chunk) => { data += chunk; });
    client.on('end', finish);
    client.on('close', finish);
    client.on('error', reject);
  });
}
const selection = Object.freeze({ exact: ROUTE, scope: ['impl/**'] });

const policy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1000,
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

const profile = Object.freeze({
  schemaVersion: 1, repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification: Object.freeze({
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  }),
  routes: [ROUTE], capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024, maxReservedInodes: 10_000,
  minFreeBytes: 1, minFreeInodes: 1, runtimeReserveBytes: 4 * 1024, runtimeReserveInodes: 4,
});

/** The adapter card the resident's own self-check requires (phase89), over the mock scenario. */
function deploymentAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 120_000, summary: 'issue467 fixture' },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },

    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue467-fixture', refreshedAt: null,
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
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 467 stop', GIT_COMMITTER_NAME: 'Issue 467 stop' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue467@example.invalid', GIT_COMMITTER_EMAIL: 'issue467@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

/** A real process in its own group — the honest subject of a pid/group liveness probe. */
async function spawnIdleChild() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true, stdio: 'ignore',
  });
  await once(child, 'spawn');
  return child;
}

/** Kill that child and wait for the kernel to answer ESRCH for its pid (reaped, not a zombie). */
async function endChild(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  await once(child, 'exit');
  const deadline = Date.now() + 5_000;
  for (;;) {
    try { process.kill(child.pid, 0); } catch (error) { if (error?.code === 'ESRCH') return; throw error; }
    if (Date.now() >= deadline) throw new Error('the fixture child was never reaped');
    await sleep(10);
  }
}

/**
 * A deployment opened in-process with its driver in hand (the issue450/phase85 pattern) plus the
 * resident's own environment: the stop under test is the DEPLOYMENT's (`deployment.close()`), the
 * same path `baton serve`'s signal handler runs, over the same host the ordinary resident builds.
 */
async function fixture(t, label, { drainTimeoutMs = 2_500, stopDeadlineMs = 400, webDrainMs = 300 } = {}) {
  // The resident's own socket path is bounded by sun_path (103 bytes) and the suite root on this
  // host is deep, so the fixture root is short (the issue351/issue383 idiom).
  const directory = mkdtempSync(join(tmpdir(), `bt467-${label}-`));
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
    // resident takes (the host is what names the waits and drives the bounded attempts).
    await deployment.host();
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
  t.after(async () => {
    try { await deployment.close(); } catch { /* closed by the test or the fixture */ }
    // Under suite load a late in-process writer (a checkpoint or ledger flush racing the close)
    // can recreate a path after the removal; the fixture's contract is that the directory is gone
    // when the file ends, so the removal re-checks and repeats inside this hook.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      rmSync(directory, { force: true, recursive: true, maxRetries: 3, retryDelay: 25 });
      if (!existsSync(directory)) return;
      await sleep(50);
    }
  });
  return { deployment, driver, repo, directory, env, home };
}

/** The deployment's own profile the ordinary resident publishes: {worker, seat} is the seat whose
 * worker the stop has to converge on. */
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
/** The durable `host.*` rows the deployment recorded on the resident's ledger. */
const stopRows = (driver) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded'

    && typeof event.payload?.kind === 'string' && event.payload.kind.startsWith('host.'))
  .map((event) => event.payload);

const workerRows = (driver, workerId) => driver.log.read(workerId);

/** Bind a process generation to a worker the way a real spawn does: the durable lifecycle row, the
 * coordinator's live processRef, and the identity the spawn authority binds for the group leader
 * (`processAuthorityPayload`) — the observation the stop path reads is about a generation this
 * controller actually bound. */
function bindProcess(driver, handle, { pid, processGroupId }) {
  driver.log.append({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: driver.coordinator._safeTurnEpoch(handle),
    actor: 'worker', kind: 'lifecycle.process_started',
    payload: { schemaVersion: 1, generation: 1, pid, processGroupId, phase: 'initializing' },
  });
  handle.processRef = {
    generation: 1, pid, processGroupId, state: 'ready', ready: true, startedSeq: null, closedSeq: null,
  };
  handle.processAuthority = processAuthorityPayload(handle.processRef);
}

// ── (a) the process exits between kill.requested and the deadline ───────────────────────────────
test('467a: a worker whose process is gone at the deadline settles killConfirmed and the stop converges', async (t) => {
  const { deployment, driver } = await fixture(t, 'a', { drainTimeoutMs: 2_500, stopDeadlineMs: 600 });
  const { worker, handle } = await recruitSeat(deployment, driver, 'issue467a');
  const child = await spawnIdleChild();
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } });
  bindProcess(driver, handle, { pid: child.pid, processGroupId: child.pid });

  const closing = deployment.close().catch((error) => error);
  // The exit lands BETWEEN `kill.requested` and the stop deadline — the exact window the live
  // incident's w-745 exited in: nothing observes a correlated close, the process is simply gone.
  await until(() => workerRows(driver, worker.id).some((row) => row.kind === 'kill.requested'),
    'the stop kill request');
  await endChild(child);
  assert.throws(() => process.kill(child.pid, 0), (error) => error.code === 'ESRCH',
    'the fixture proves the pid is absent before the deadline (ESRCH)');

  const receipt = await closing;
  assert.ok(receipt, `the stop must resolve: ${String(receipt)}`);

  // (1) ESRCH is the confirmation: the attested row is on the worker's own log, naming the pid the
  //     observation was about — never a fabricated adapter receipt.
  const confirmed = workerRows(driver, worker.id).filter((row) => row.kind === 'kill.confirmed');
  assert.equal(confirmed.length, 1,
    `the kill is confirmed exactly once: ${JSON.stringify(workerRows(driver, worker.id).map((row) => row.kind))}`);
  assert.equal(confirmed[0].payload?.attestedBy, 'process_absent',
    `the confirmation is the absence attestation, not a fabricated receipt: ${JSON.stringify(confirmed[0].payload)}`);
  assert.equal(confirmed[0].payload?.pid, child.pid);

  // (2) The handle settled exactly: dead, exact process close, no local authority left.
  assert.equal(handle.status, 'dead');
  assert.equal(handle.processRef.state, 'closed');
  assert.equal(driver.coordinator._ownsLocalResources(handle), false,
    'the settled worker holds nothing the next stop would wait on');

  // (3) The stop CONVERGED: `host.stopped` landed and the deadline never re-armed a wait.
  const rows = stopRows(driver);
  const stopped = rows.find((row) => row.kind === 'host.stopped');
  assert.ok(stopped, `the stop ends with its outcome: ${JSON.stringify(rows.map((row) => row.kind))}`);
  const forced = workerRows(driver, worker.id).filter((row) => row.kind === 'control.forced_stop');
  assert.ok(forced.length <= 1,
    `the deadline never re-arms the wait it just failed (forced stops: ${forced.length})`);
});

// ── (b) a worker the kill cannot reach: bounded attempts, then the abandoned row ────────────────
test('467b: a worker the kill cannot reach converges by the bounded attempts with the abandoned row', async (t) => {
  // The incident's own shape: `ps` shows no process for the worker at all, so there is nothing for
  // the coordinator to probe and nothing for the resident's group kill to signal. No confirmation a
  // dead process can never send can arrive — so the stop must be BOUNDED, name what it stopped
  // waiting on, and end, instead of re-arming the same wait forever.
  const { deployment, driver } = await fixture(t, 'b', { drainTimeoutMs: 350, stopDeadlineMs: 200 });
  const { worker, handle } = await recruitSeat(deployment, driver, 'issue467b');
  // A recovered authority with no observable pid — the state a worker whose process was never bound
  // (or was rebound across a restart) is in. The adapter's own kill Ack cannot settle it either:
  // the two-phase stop waits for a process close that has no process to come from.
  handle.processRef = {
    generation: 0, pid: null, processGroupId: null,
    state: 'unconfirmed_after_restart', ready: false, startedSeq: null, closedSeq: null,
  };

  const receipt = await deployment.close().catch((error) => error);
  // #472: the stop ENDS — the abandoned worker no longer keeps the stop from converging and minting
  // its outcome row, so the close resolves with the receipt instead of a drain refusal.
  assert.equal(receipt instanceof Error, false, `the stop must not fail: ${receipt?.code} ${receipt?.message}`);

  const rows = stopRows(driver);
  const waits = rows.filter((row) => row.kind === 'host.stop_waiting' && row.on === 'worker');
  assert.ok(waits.length >= 1, `the stop named its wait: ${JSON.stringify(rows.map((row) => row.kind))}`);
  const last = waits.at(-1);
  // (1) The wait row says WHICH bounded attempt it is and the liveness the stop observed — here,
  //     honestly, that there was nothing to observe (no pid, no group), never a guessed "gone".
  //     #472: the ABANDONMENT (asserted below, and on the outcome row) is where the bounded count
  //     lands at 2 — the stop converges once the worker is abandoned, so the wait rows are the ones
  //     taken BEFORE it, and a wait row never claims an attempt the stop did not take.
  assert.ok(Number.isSafeInteger(last.attempt) && last.attempt >= 1,
    `the bounded attempt count rides the wait row: ${JSON.stringify(last)}`);
  assert.equal(last.alive, null, `an unobservable worker is reported as unobserved: ${JSON.stringify(last)}`);
  assert.ok(waits.length <= 2, `a third wait does not exist: ${JSON.stringify(waits.map((row) => row.attempt))}`);

  // (2) The worker the stop stopped waiting on is named durably — with the holds it leaves behind —
  //     and the coordinator records the same fact for the fleet drain.
  const abandoned = workerRows(driver, worker.id).filter((row) => row.kind === 'control.stop_abandoned');
  assert.equal(abandoned.length, 1, 'the abandoned worker is named exactly once');
  assert.equal(abandoned[0].payload?.attempts, 2, `the abandoned row carries the bounded attempts: ${JSON.stringify(abandoned[0].payload)}`);
  assert.ok(Array.isArray(abandoned[0].payload?.holds) && abandoned[0].payload.holds.length > 0,
    `the abandoned row names the holds it leaves: ${JSON.stringify(abandoned[0].payload)}`);
  assert.ok(driver.coordination.eventsView().some((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'drain.worker_abandoned' && event.payload?.workerId === worker.id),
  'the drain records the abandonment as its own durable row');
  const abandonedRows = driver.coordinator.abandonedWorkers();
  assert.equal(abandonedRows.some((row) => row.workerId === worker.id), true);
  assert.equal(abandonedRows.find((row) => row.workerId === worker.id).attempt, 2);
  // (3) The stop ENDED and the abandoned worker is listed under its OWN list on the outcome — not
  //     inside `released`, which names resources a stop did release and never a worker it stopped
  //     waiting on (#472 moved this row's shape; the abandonment's durable rows above are
  //     unchanged).
  const stopped = stopRows(driver).find((row) => row.kind === 'host.stopped');
  assert.ok(stopped, `the abandoned stop mints its outcome: ${JSON.stringify(stopRows(driver).map((row) => row.kind))}`);
  assert.deepEqual(stopped.abandoned.map((row) => row.workerId), [worker.id],
    `the outcome lists the abandoned worker: ${JSON.stringify(stopped.abandoned)}`);
  assert.equal(stopped.released.some((row) => row.workerId === worker.id), false,
    `the abandoned worker never rides released: ${JSON.stringify(stopped.released)}`);
});

// ── (d) the absence the stop observes is the confirmation ───────────────────────────────────────
test('467d: the absence the stop observes is the confirmation, and the wait row carries what was seen', async (t) => {
  const { deployment, driver } = await fixture(t, 'd', { drainTimeoutMs: 400, stopDeadlineMs: 8_000 });
  const { worker, handle } = await recruitSeat(deployment, driver, 'issue467d');
  const child = await spawnIdleChild();
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } });
  bindProcess(driver, handle, { pid: child.pid, processGroupId: child.pid });

  const closing = deployment.close().catch((error) => error);
  // The resident OBSERVES the worker's live process group before it acts on it, so the wait row says
  // what was seen — never "killed successfully" for a group it merely found.
  const wait = await until(() => stopRows(driver)
    .find((row) => row.kind === 'host.stop_waiting' && row.on === 'worker') ?? null,
  'the named wait during the drain');
  assert.equal(wait.alive, true,
    `the wait row carries the liveness the resident observed: ${JSON.stringify(wait)}`);
  assert.ok(Number.isSafeInteger(wait.attempt) && wait.attempt >= 1, `the attempt rides it too: ${JSON.stringify(wait)}`);

  // The group kill ends the process, and the absence that follows IS the two-phase stop's
  // confirmation — attested on the worker's own log, exactly once.
  await endChild(child);
  const receipt = await closing;
  assert.ok(receipt && typeof receipt === 'object', `the stop must end: ${String(receipt)}`);
  assert.equal(driver.coordinator._ownsLocalResources(handle), false,
    'the settled worker holds nothing the stop had to wait on');
  assert.ok(stopRows(driver).some((row) => row.kind === 'host.stopped'), 'the stop ends with its outcome');
  const attested = workerRows(driver, worker.id).filter((row) => row.kind === 'kill.confirmed'
    && row.payload?.attestedBy === 'process_absent');
  assert.equal(attested.length, 1, 'the absence is the confirmation, and it is attested once');
});

// ── (c) reads stay open over the served transport while the stop drains ─────────────────────────
test('467c: the served transport keeps answering reads while the stop drains', async (t) => {
  const { deployment, driver, repo, env } = await fixture(t, 'c', {
    drainTimeoutMs: 300, stopDeadlineMs: 200, webDrainMs: 400,
  });
  const { worker, handle } = await recruitSeat(deployment, driver, 'issue467c');
  // A worker the kill cannot settle (no pid, no group): the stop takes its bounded waits, which is
  // the window in which the served transport must still answer.
  handle.processRef = {
    generation: 0, pid: null, processGroupId: null,
    state: 'unconfirmed_after_restart', ready: false, startedSeq: null, closedSeq: null,
  };

  await deployment.host();
  const connection = discoverBatonConnection({ cwd: repo, env });
  assert.equal(connection.transport, 'local');

  // The read a client makes of a resident: its own served card (what `baton doctor` renders).
  const card = () => cardOverSocket(connection, repoId);
  const serving = await card();
  assert.equal(serving.status, 200, 'the resident answers reads while it serves');
  assert.equal(serving.body?.application?.stopping ?? null, null,
    'a serving resident carries no stopping section');

  const closing = deployment.close().catch((error) => error);
  // (1) The read answers DURING the stop — never `cli_transport_failed`, which is what every call
  //     got for the whole thirteen-cycle drain in the incident.
  const during = await until(async () => {
    const read = await card().catch(() => null);
    const state = read?.body?.application?.stopping ?? null;
    return read?.status === 200 && state !== null ? { read, state } : null;
  }, 'a stopping read over the served transport during the drain', 15_000);
  assert.equal(during.state.state, 'stopping');
  assert.ok(Number.isFinite(Date.parse(during.state.at)), 'the stop names when it began');

  // (2) The wait rows travel with it: once the stop has named a wait, the same read carries it.
  const waited = await until(async () => {
    const rows = stopRows(driver);
    if (!rows.some((row) => row.kind === 'host.stop_waiting' && row.on === 'worker')) return null;
    const read = await card().catch(() => null);
    const state = read?.body?.application?.stopping ?? null;
    return state && Array.isArray(state.waits) && state.waits.some((row) => row.on === 'worker')
      ? state : null;
  }, 'the wait rows on the served read', 15_000);
  const wait = waited.waits.find((row) => row.on === 'worker');
  assert.ok(wait.ids.includes(worker.id), `the wait names the worker: ${JSON.stringify(wait)}`);
  assert.ok(Number.isSafeInteger(wait.attempt) && wait.attempt >= 1, `the attempt rides the read: ${JSON.stringify(wait)}`);

  const receipt = await closing;
  assert.ok(receipt && typeof receipt === 'object', `the stop ends: ${String(receipt)}`);
});
