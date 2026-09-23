// Issue #476 — `baton doctor --check` during a resident stop answers "cli_command_failed GET
// /readyz HTTP 503" instead of the stopping state #467 keeps readable.
//
// OBSERVED live (2026-09-18 15:15:34Z, clone fed18071): SIGTERM with one seat mid-turn, `baton
// doctor --check` polled every second through the drain —
//   read 1 @+0s: baton: cli_command_failed: Baton Web request was refused (GET /readyz, HTTP 503)
//   read 2 @+3s: baton: cli_transport_failed: the Baton Web connection failed; GET /readyz; …
//   read 3 @+5s: {"state":"needs_setup", … "connection":"missing"}   (the resident had exited)
// #467 keeps the observation reads open while the stop drains (READ_ONLY_COMMANDS, the card,
// /v1/session, /v1/events, wakes) and the card answers `application.stopping {state, at, waits}`,
// but two legs hid that state: `/readyz` answered a bare `{ready: false}` (so a bare curl said
// nothing either), and the CLI's doctor leg reads readiness FIRST and composed every non-2xx into a
// refusal — so the operator's own diagnosis verb never reached the card.
//
// The three rows this file pins, on the 467c fixture (a real served resident over a temporary
// repository, a seat mid-drain):
//   (a) `GET /readyz` during the drain answers 503 WITH the stopping row as its body;
//   (b) `baton doctor --check` — the REAL CLI, in a child process — answers `state: 'stopping'`
//       with the waits the stop holds and a `next` that names the wait, never `cli_command_failed`;
//   (c) a resident that has already exited still renders the existing `needs_setup` answer
//       (`connection: 'missing'`), unchanged.
//
// Hermetic: every directory is under os.tmpdir(); the resident rows (a)/(b) read is the in-process
// host the deployment's own served transport already is, over a temporary repository, and the one
// real `baton serve` a row spawns goes through #471's helper (`spawnFixtureResident`) — its own
// process group, ended by `t.after` and by the runner's SIGTERM/SIGINT/SIGHUP.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { openBatonDeployment } from '../src/application-deployment.mjs';
import { discoverBatonConnection } from '../src/application-cli.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { MockAdapter, createDriver } from '../src/index.mjs';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));

const ROUTE = Object.freeze({ harness: 'mock', model: 'model-a', effort: 'low' });
const selection = Object.freeze({ exact: ROUTE, scope: ['impl/**'] });

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

/** The adapter card the resident's own self-check requires (phase89), over the mock scenario — the
 * same card issue467's fixture builds, with a turn that outlives every stop this file takes. */
function deploymentAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 120_000, summary: 'issue476 fixture' },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue476-fixture', refreshedAt: null,
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
  execFileSync('git', ['config', 'user.name', 'Issue 476 doctor'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue476@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

/**
 * The deployment opened in-process with its driver in hand (the issue450/phase85/467 pattern): the
 * resident that serves the socket is the ORDINARY host the deployment builds, and the stop under
 * test is `deployment.close()` — the same path `baton serve`'s signal handler runs. `drainTimeoutMs`
 * is the window the drain holds while a seat is mid-turn, which is the window every row here reads
 * in; it is generous because row (b) runs the real CLI in a child process.
 */
async function fixture(t, label, { drainTimeoutMs = 8_000, stopDeadlineMs = 400, webDrainMs = 300 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `bt476-${label}-`));
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
    await deployment.host();
  } catch (error) {
    rmSync(directory, { force: true, recursive: true });
    throw error;
  }
  t.after(async () => {
    try { await deployment.close(); } catch { /* closed by the test or the fixture */ }
    rmSync(directory, { force: true, recursive: true });
  });
  return { deployment, driver, repo, directory, env, home };
}

/** The seat the stop has to converge on: a worker whose process is never observable (the 467b/467c
 * shape — no pid, no group), so the drain takes its bounded waits instead of settling at once. That
 * is the window in which a resident must still answer its own reads. */
async function recruitStuckSeat(deployment, driver, swarmId) {
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
    if (row && row.status === 'working') {
      const handle = driver.coordinator._workers.get(row.id);
      handle.processRef = {
        generation: 0, pid: null, processGroupId: null,
        state: 'unconfirmed_after_restart', ready: false, startedSeq: null, closedSeq: null,
      };
      return { seat, worker: row };
    }
    if (Date.now() >= deadline) throw new Error(`seat never started working: ${seat.runId}`);
    await sleep(10);
  }
}

/** The durable `host.*` rows the deployment recorded on the resident's ledger. */
const stopRows = (driver) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded'
    && typeof event.payload?.kind === 'string' && event.payload.kind.startsWith('host.'))
  .map((event) => event.payload);

/** One read of the resident's served transport, at the transport level — what a bare `curl /readyz`
 * makes, and what `baton doctor` makes of `/v1/application-card`. `authenticated: false` sends no
 * credential (the readiness route answers before any authority is consulted). */
function transportRead(connection, path, { authenticated = true, origin = null } = {}) {
  const headers = [
    `GET ${path} HTTP/1.1`,
    'host: localhost',
    ...(origin === null ? [] : [`origin: ${origin}`]),
    ...(authenticated ? [`authorization: Bearer ${connection.token}`] : []),
    'connection: close',
  ];
  const request = [...headers, '', ''].join('\r\n');
  return new Promise((resolve, reject) => {
    const client = connect(connection.socketPath);
    let data = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const [head, ...rest] = data.split('\r\n\r\n');
      const status = Number.parseInt((head.split('\r\n')[0] ?? '').split(' ')[1] ?? '', 10);
      let body = null;
      try { body = JSON.parse(rest.join('\r\n\r\n')); } catch { body = null; }
      resolve({ status, body });
    };
    client.on('connect', () => client.write(request));
    client.on('data', (chunk) => { data += chunk; });
    client.on('end', finish);
    client.on('close', finish);
    client.on('error', reject);
  });
}

/** `baton doctor --check`, exactly as an operator runs it: the real CLI entry in its own process,
 * over this checkout's scripts, in the fixture's repository with the fixture's environment. */
function cliDoctor({ repo, env }, args = ['doctor', '--check']) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { cwd: repo, env }, (error, stdout, stderr) => {
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
    });
  });
}

/** The parsed stdout of a doctor run, with the failure text kept for the assertion message. */
function doctorJson(run) {
  try { return JSON.parse(run.stdout); } catch {
    throw new Error(`doctor --check did not print JSON (exit ${run.code}): ${run.stdout}${run.stderr}`);
  }
}

// ── (a) /readyz carries the stopping row while the drain holds ─────────────────────────────────
test('476a: GET /readyz during the drain answers 503 with the stopping row in its body', async (t) => {
  // The drain deadline is what makes a stuck seat a NAMED wait rather than a settled one (the
  // 467b/467c shape), and the stop deadline bounds how long that wait is held — short here, so the
  // whole row is over in well under a second.
  const { deployment, driver, repo, env } = await fixture(t, 'a', { drainTimeoutMs: 400, stopDeadlineMs: 300 });
  const { worker } = await recruitStuckSeat(deployment, driver, 'issue476a');
  const connection = discoverBatonConnection({ cwd: repo, env });

  // Before the stop, readiness is the plain serving answer — unchanged.
  const serving = await transportRead(connection, '/readyz', { authenticated: false });
  assert.equal(serving.status, 200, JSON.stringify(serving.body));
  assert.deepEqual(serving.body, { ready: true });

  const closing = deployment.close().catch((error) => error);
  // The read a bare `curl /readyz` makes, with no credential at all: the status is the stop's, and
  // the body is the stopping row rather than a bare `{ready: false}`.
  const during = await until(async () => {
    const read = await transportRead(connection, '/readyz', { authenticated: false }).catch(() => null);
    return read?.status === 503 && read.body?.state === 'stopping' ? read : null;
  }, 'the stopping readiness answer during the drain', 10_000);
  assert.equal(during.body.ready, false);
  assert.ok(Number.isFinite(Date.parse(during.body.at)), 'the row names when the stop began');

  // The waits the stop holds ride the same body: once the drain has named its wait, the readiness
  // answer carries it — the seat being drained and the bounded attempt the stop reached.
  const waited = await until(async () => {
    const read = await transportRead(connection, '/readyz', { authenticated: false }).catch(() => null);
    const wait = (read?.body?.waits ?? []).find((row) => row.on === 'worker') ?? null;
    return wait === null ? null : { read, wait };
  }, 'the wait rows on the readiness answer', 10_000);
  assert.ok(waited.wait.ids.includes(worker.id), `the wait names the seat drained: ${JSON.stringify(waited.wait)}`);
  assert.ok(Number.isSafeInteger(waited.wait.attempt) && waited.wait.attempt >= 1, JSON.stringify(waited.wait));

  const receipt = await closing;
  assert.ok(receipt && typeof receipt === 'object', `the stop must end: ${String(receipt)}`);
});

// ── (b) doctor --check reads the card and renders the stop ────────────────────────────────────
test('476b: doctor --check during the drain renders state stopping with the waits, never cli_command_failed', async (t) => {
  // The window this row reads in is the stop's own bounded wait: the drain misses its 400ms
  // deadline, names the wait, and the stop holds it for its 2.5s deadline — ~5s of a resident that
  // is stopping and still answering. The real CLI boots in ~1s, so it reads inside that window.
  const { deployment, driver, repo, env } = await fixture(t, 'b', { drainTimeoutMs: 400, stopDeadlineMs: 2_500 });
  const { worker } = await recruitStuckSeat(deployment, driver, 'issue476b');

  const closing = deployment.close().catch((error) => error);
  await until(() => stopRows(driver)
    .some((row) => row.kind === 'host.stop_waiting' && row.on === 'worker'),
  'the named worker wait during the drain');
  const run = await cliDoctor({ repo, env });

  assert.equal(run.stdout.includes('cli_command_failed'), false,
    `the operator's verb never reports the readiness status as the whole answer: ${run.stderr}`);
  const result = doctorJson(run);
  assert.equal(result.state, 'stopping',
    `doctor --check renders the stop: ${JSON.stringify(result).slice(0, 600)}`);
  assert.equal(result.stopping?.state, 'stopping');
  // The waits the stop holds, verbatim from the resident: the seat being drained, the attempt the
  // stop reached, and since when.
  const wait = (result.stopping?.waits ?? []).find((row) => row.on === 'worker');
  assert.ok(wait, `the waits ride the doctor read: ${JSON.stringify(result.stopping)}`);
  assert.ok(wait.ids.includes(worker.id), `the wait names the seat being drained: ${JSON.stringify(wait)}`);
  assert.ok(Number.isSafeInteger(wait.attempt) && wait.attempt >= 1, JSON.stringify(wait));
  assert.ok(Number.isFinite(Date.parse(result.stopping?.at)), JSON.stringify(result.stopping));
  // `next` names what the operator does about it — wait, on the stop's own bound.
  assert.equal(result.next?.[0]?.action, 'wait', JSON.stringify(result.next));
  assert.match(result.next?.[0]?.reason ?? '', /stopping/u, JSON.stringify(result.next));
  // The doctor's outline exit contract: `--check` exits 1 for every state that is not ready.
  assert.equal(run.code, 1, `exit 1 for a resident that is not ready: ${run.stderr}`);

  const receipt = await closing;
  assert.ok(receipt && typeof receipt === 'object', `the stop must end: ${String(receipt)}`);
});

// ── (c) a resident that has exited answers as it always did ───────────────────────────────────
test('476c: after the resident exits, doctor --check renders the needs_setup answer unchanged', async (t) => {
  // This row needs a resident whose PROCESS is gone — the state the issue's own third read caught
  // (`@+5s: {"state":"needs_setup", … "connection":"missing"}`), and the one an in-process fixture
  // cannot be in (its pid is the test runner's). So it is a REAL `baton serve`, spawned through
  // #471's helper, signalled the way an operator signals one, and read again once it has exited and
  // withdrawn its publication.
  const directory = mkdtempSync(join(tmpdir(), 'bt476-exit-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  // A zero-assembly `baton serve` resolves the repository's own verification command, and a repo
  // with none is ambiguous — the same shape phase89's resident CLI rows build.
  writeFileSync(join(repo, 'package.json'), JSON.stringify({
    private: true, scripts: { test: 'node --test' },
  }));
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'), [
    "import assert from 'node:assert/strict';",
    "import test from 'node:test';",
    "test('smoke', () => { assert.equal(1, 1); });",
    '',
  ].join('\n'));
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'verification'], { cwd: repo });
  const home = join(directory, 'home');
  const configRoot = join(directory, 'config');
  mkdirSync(home, { recursive: true });
  mkdirSync(configRoot, { recursive: true });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  const child = spawnFixtureResident(t, { args: [SCRIPT, 'serve'], cwd: repo, env });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 256 * 1024) child.kill('SIGKILL');
  });
  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  await until(() => existsSync(selectorPath) && stderr.includes('"state":"published"'),
    `a published resident (${stderr.slice(-2_048)})`, 30_000);

  // Serving: the CLI reads the live card and answers ready, exit 0 — the state #476 leaves alone.
  const serving = await cliDoctor({ repo, env });
  assert.equal(doctorJson(serving).state, 'ready', `${serving.stdout}${serving.stderr}`);
  assert.equal(serving.code, 0, serving.stderr);

  child.kill('SIGTERM');
  const exit = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(exit, { code: 0, signal: null }, `the resident stops cleanly: ${stderr.slice(-2_048)}`);
  assert.equal(existsSync(selectorPath), false, 'the resident withdraws its publication on the way out');

  // Gone: the existing first-run outline, exactly as before #476 — never a stopping state, never a
  // readiness refusal.
  const run = await cliDoctor({ repo, env });
  const result = doctorJson(run);
  assert.equal(run.stdout.includes('cli_command_failed'), false, run.stderr);
  assert.equal(result.state, 'needs_setup', JSON.stringify(result).slice(0, 600));
  assert.equal(result.outline?.connection, 'missing', JSON.stringify(result));
  assert.equal(run.code, 1, 'a first-run outline under --check is a failure exit');
});
