// Issue #351 — a resident must be stoppable, whatever its ledger holds.
//
// OBSERVED (2026-09-17, a deployment with a 144 000-row coordination ledger): `kill -TERM` left the
// resident spinning in JSON serialization and old-generation GC for ten minutes, wrote no stop row,
// and had to be SIGKILLed; an exited worker stayed a zombie under the live parent. The stop path's
// one whole-ledger serialization is the clean release's projection checkpoint
// (coordination-store.mjs `_writeProjectionCheckpoint`: `readFileSync` of the whole ledger, two
// digests over it, and one `v8.serialize` of the ENTIRE projection — including the parsed `_events`
// cache, a second copy of the same ledger — synchronously on the main thread).
//
// RED at HEAD (pre-fix), row by row:
//  (a) the release rewrites the projection checkpoint (mtime advances) and no `host.stopped` row
//      exists at all;
//  (b) neither `host.stop_requested` nor `host.stopped` is ever written;
//  (c) a stop that cannot converge writes no `host.stop_waiting`, does not kill the wedged worker's
//      process group, and writes no `lifecycle.crashed {phase:'shutdown'}` row;
//  (d) the withdrawal happens (#276(3)) but nothing records the stop that performed it.
// MEASURED here at the reported size (150 000 rows, a 56MB ledger): that release rewrite costs
// ~196ms and writes a 26MB cache; on a live campaign's projection — larger than the ledger it
// folds — it is the ten-minute serialize the issue reports. These rows therefore pin the
// PROPERTY (no whole-ledger serialization left on the stop path, and a stop that names its wait),
// not a stopwatch reading of one machine.
//
//
// Every test drives a real `baton serve` child against a real deployment — the process is the unit
// under test — and every row is read back from durable bytes, never from memory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, closeSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { FRAME_LIMITS } from '../src/limits.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const DEPLOYMENT_URL = new URL('../src/application-deployment.mjs', import.meta.url).href;
const FAKE_GROK = new URL('./fixtures/fake-grok-acp.mjs', import.meta.url).pathname;
const ROUTE = '{ harness: \'codex\', model: \'gpt-5.6-sol\', effort: \'high\' }';
const GROK_ROUTE = '{ harness: \'grok\', model: \'grok-4.5-fake\', effort: \'high\' }';

// The ONE declared row this file derives from (#258: no new numeric constants). The projection
// checkpoint is a replay cache, so the registry's own ceiling for how many ledger rows one replay
// carries bounds BOTH the row count a release may re-encode and the period the resident's loop must
// keep beating through: a stop whose single stall outlives a whole declared replay is a stall the
// operator was never told about.
const LIMIT = FRAME_LIMITS['view.wake_replay.items'];
const HEARTBEAT_MS = LIMIT.value;
const BULK_ROWS = 150_000;
const STOP_BOUND_MS = HEARTBEAT_MS * 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The resident protocol bounds a socket path to sun_path (103 bytes), and the suite root on this
// host is deep — resident fixtures live under a short top-level root.
function fixtureRoot(t, label) {
  const root = mkdtempSync(`/tmp/bt351-${label}-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t, root) {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'bt351@example.invalid']);
  git(['config', 'user.name', 'BT351']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return repo;
}

// The exact adapter card the ordinary resident self-check requires (phase89-resident-local-host).
const ADAPTER = `
function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue351 fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue351-resident-shutdown', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
`;

// The heartbeat is the loop's own liveness proof, on the SAME loop as the resident. It is unref'd so
// it measures the loop without holding the process open: a stop that converges still exits.
const HEARTBEAT = `
const HEARTBEAT_MS = ${HEARTBEAT_MS};
const timer = setInterval(() => { process.stderr.write('beat ' + Date.now() + '\\n'); }, HEARTBEAT_MS);
timer.unref();
`;

function serveFixture(t, label, body) {
  const root = fixtureRoot(t, label);
  const repo = repository(t, root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const advanced = `
    deploymentRoot: ${JSON.stringify(deploymentRoot)},
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
  `;
  const modulePath = join(root, 'deployment.mjs');
  writeFileSync(modulePath, body({ advanced, home, configRoot, deploymentRoot, env }));
  const ledgerDir = join(deploymentRoot, 'state', 'coordination');
  return {
    root, repo, home, configRoot, deploymentRoot, modulePath, env,
    ledgerPath: join(ledgerDir, 'events.jsonl'),
    checkpointPath: join(ledgerDir, 'projection.checkpoint'),
    logPath: (workerId) => join(deploymentRoot, 'state', `${workerId}.jsonl`),
  };
}

/** A synthetic ledger of `rows` coordination rows, written before the resident ever opens the
 * store: the deployment the issue reports is one with a 144 000-row history. */
function seedLedger(fixture, rows, { pad = 180 } = {}) {
  const directory = join(fixture.deploymentRoot, 'state', 'coordination');
  mkdirSync(directory, { recursive: true });
  const filler = 'x'.repeat(pad);
  const chunks = [];
  for (let seq = 1; seq <= rows; seq += 1) {
    chunks.push(JSON.stringify({
      schemaVersion: 1, seq, ts: '2026-09-17T00:00:00.000Z', kind: 'mcp.audit', actor: 'issue351-fixture',
      idempotencyKey: `issue351:${seq}`, payload: { seq, tool: 'coordination.read', body: filler },
    }));
    if (chunks.length === 5_000) { writeFileSync(fixture.ledgerPath, `${chunks.join('\n')}\n`, { flag: 'a' }); chunks.length = 0; }
  }
  if (chunks.length > 0) writeFileSync(fixture.ledgerPath, `${chunks.join('\n')}\n`, { flag: 'a' });
}

/** The last `limit` rows of a JSONL file, read from the TAIL — a 150 000-row ledger is not parsed
 * to answer what its last ten rows say. */
function tailRows(file, limit, { bytes = 262_144 } = {}) {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  const length = Math.min(bytes, size);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try { readSync(fd, buffer, 0, length, size - length); } finally { closeSync(fd); }
  const lines = buffer.toString('utf8').split('\n').filter((line) => line.length > 0);
  if (length < size) lines.shift(); // a partial first line — never a row
  const rows = [];
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch { /* the very last byte may be mid-write */ }
  }
  return rows.slice(-limit);
}

function allRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/** The resident's own rows, by the kind the resident names them with. */
function stopRows(file) {
  return allRows(file).filter((row) => row.kind === 'driver.recorded'
    && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
}

function fileStamp(file) {
  if (!existsSync(file)) return null;
  const stat = statSync(file);
  return `${stat.size}:${stat.mtimeMs}`;
}

function startServe(t, fixture, { readyMarker } = {}) {
  const selectorPath = join(fixture.repo, '.git', 'baton', 'connection.json');
  // The fixture is a TEST-SHAPE host, and its wedged-worker recruit (RS3) must not queue behind
  // the host's own load observation — under load that queue outlives every readiness window and
  // the resident dies in admission, never in the drain the row is about. The runner's own rule
  // (application-deployment: suite children run UNWIRED) is spelled here through the authority's
  // documented operator override, HOST_CAPACITY_BYPASS — never a second constant.
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  // Issue #471: the ONE fixture-resident spawn — the child declares THIS runner and is ended by
  // process group at the test's after-hook (and by the runner's death, however it dies).
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', fixture.modulePath],
    cwd: fixture.repo,
    env: { ...process.env, HOME: fixture.home, XDG_CONFIG_HOME: fixture.configRoot,
      [bypassName]: bypassValue },
  });
  const state = { stderr: '', exited: null, beats: [] };
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    state.stderr += text;
    for (const line of text.split('\n')) {
      if (line.startsWith('beat ')) state.beats.push(Date.now());
    }
  });
  child.on('exit', (code, signal) => { state.exited = { code, signal, at: Date.now() }; });
  return {
    child, state, selectorPath,
    async untilReady(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      const marker = readyMarker ?? '"state":"published"';
      while (Date.now() < deadline) {
        if (state.exited !== null) break;
        if (existsSync(selectorPath) && state.stderr.includes(marker)) return;
        await sleep(25);
      }
      throw new Error(`serve child never became ready (exit=${JSON.stringify(state.exited)}): ${state.stderr.slice(-2_000)}`);
    },
    published() {
      if (!existsSync(selectorPath)) return { selector: null, profile: null, profilePath: null, tokenPath: null, socketPath: null };
      const selector = JSON.parse(readFileSync(selectorPath, 'utf8'));
      const profilePath = join(fixture.configRoot, 'baton', 'connections', `${selector.profile}.json`);
      const profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, 'utf8')) : null;
      return {
        selector, profile, profilePath,
        tokenPath: join(fixture.configRoot, 'baton', 'connections', `${selector.profile}.token`),
        socketPath: profile?.socketPath ?? null,
      };
    },
    /** The signal, and everything the loop did after it. */
    async signal(signal = 'SIGTERM', timeoutMs = STOP_BOUND_MS) {
      const published = this.published();
      state.beats.length = 0;
      const signalAt = Date.now();
      child.kill(signal);
      const deadline = signalAt + timeoutMs;
      while (Date.now() < deadline && state.exited === null) await sleep(20);
      const gaps = [];
      for (let index = 1; index < state.beats.length; index += 1) gaps.push(state.beats[index] - state.beats[index - 1]);
      return {
        published, exit: state.exited, stderr: state.stderr,
        msAfterSignal: Date.now() - signalAt,
        beats: state.beats.length, worstGapMs: gaps.length > 0 ? Math.max(...gaps) : 0,
      };
    },
  };
}

function lineIndex(stderr, needle) {
  const index = stderr.split('\n').findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `stderr never named "${needle}":\n${stderr.slice(-2_000)}`);
  return index;
}

test('RS1: a 150 000-row resident stops inside the declared bound without serializing the whole ledger', async (t) => {
  const fixture = serveFixture(t, 'bulk', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}${HEARTBEAT}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`);
  seedLedger(fixture, BULK_ROWS);
  const serve = startServe(t, fixture);
  await serve.untilReady();
  await sleep(1_000);
  const checkpointBefore = fileStamp(fixture.checkpointPath);

  const { exit, stderr, msAfterSignal, worstGapMs } = await serve.signal('SIGTERM');

  assert.deepEqual(exit, { code: 0, signal: null, at: exit?.at },
    `a converged stop exits 0 — never a SIGKILL: ${stderr.slice(-2_000)}`);
  assert.ok(msAfterSignal < STOP_BOUND_MS,
    `the stop is bounded by the declared row (${STOP_BOUND_MS}ms); it took ${msAfterSignal}ms`);
  // The loop stayed a loop: no single stall outlived the declared period.
  assert.ok(worstGapMs < HEARTBEAT_MS,
    `the loop stalled ${worstGapMs}ms (> ${HEARTBEAT_MS}ms) — a whole-ledger serialization on the stop path`);

  // The release decided NOT to re-encode the projection, and said why.
  const stopped = stopRows(fixture.ledgerPath).find((row) => row.payload.kind === 'host.stopped');
  assert.ok(stopped, `the stop recorded no host.stopped row: ${stderr.slice(-2_000)}`);
  assert.equal(stopped.payload.checkpoint?.state, 'skipped',
    'the release must not write an unbounded checkpoint');
  assert.equal(stopped.payload.checkpoint?.reason, 'release_checkpoint_unbounded');
  assert.equal(stopped.payload.checkpoint?.bound, LIMIT.value, 'the bound is the declared row, not a new constant');
  assert.ok(stopped.payload.checkpoint?.rows > stopped.payload.checkpoint?.bound,
    `${stopped.payload.checkpoint?.rows} rows must exceed the declared bound ${stopped.payload.checkpoint?.bound}`);
  // …and the durable bytes agree with the record: the stop did not rewrite the cache.
  assert.equal(fileStamp(fixture.checkpointPath), checkpointBefore,
    'the stop path rewrote the projection checkpoint (a whole-ledger serialize on the main thread)');
});

test('RS2: the stop writes host.stop_requested and then host.stopped — and nothing between them', async (t) => {
  const fixture = serveFixture(t, 'rows', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}${HEARTBEAT}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`);
  seedLedger(fixture, BULK_ROWS);
  const serve = startServe(t, fixture);
  await serve.untilReady();

  const { exit, stderr } = await serve.signal('SIGTERM');
  assert.deepEqual(exit, { code: 0, signal: null, at: exit?.at }, stderr.slice(-2_000));

  const rows = stopRows(fixture.ledgerPath);
  assert.deepEqual(rows.map((row) => row.payload.kind), ['host.stop_requested', 'host.stopped'],
    'a stop is two bounded rows: what it was asked to do, and what it did');
  const [requested, stopped] = rows.map((row) => row.payload);
  assert.equal(requested.trigger, 'SIGTERM', 'the row names the trigger the resident was admitted by');
  assert.ok(typeof requested.at === 'string' && requested.at.length > 0, 'the row is stamped');
  assert.equal(stopped.state, 'stopped');
  assert.ok(typeof stopped.at === 'string' && stopped.at.length > 0);
  assert.ok(rows[0].seq < rows[1].seq, 'the request precedes the outcome on the ledger');

  // The serve log says the same two facts, in the same order.
  const requestedLine = lineIndex(stderr, 'host.stop_requested trigger SIGTERM at ');
  const stoppedLine = lineIndex(stderr, 'host.stopped stopped at ');
  assert.ok(requestedLine < stoppedLine, `the log reads in the order the facts happened:\n${stderr.slice(-2_000)}`);
  assert.ok(requestedLine < lineIndex(stderr, 'web admission closed'),
    'the request is the first line of the stop, before any drain work');
});

test('RS3: a resident that cannot converge names its wait, kills the group, and stops', async (t) => {
  // The wedged worker is a REAL process: `FAKE:STAY_OPEN` (fixtures/fake-grok-acp.mjs) never
  // resolves its prompt, so its turn outlives the drain's own declared deadline and the resident
  // has to end it — by the process group, with proof, never a zombie under a live parent.
  const fixture = serveFixture(t, 'stalled', ({ deploymentRoot, env, home }) => `
import { GrokAcpCli, createDriver } from ${JSON.stringify(INDEX_URL)};
import { openBatonDeployment } from ${JSON.stringify(DEPLOYMENT_URL)};
const ROUTE = Object.freeze(${GROK_ROUTE});
export const createBatonDeployment = async () => {
  const grok = new GrokAcpCli({
    cmd: process.execPath, args: [${JSON.stringify(FAKE_GROK)}, '--serve'],
    model: ROUTE.model, requestTimeoutMs: 1_000, versionProbe: () => '0.1.216-fake',
  });
  const rawCard = grok.card.bind(grok);
  grok.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue351-wedged-worker', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  // The wedged worker's transport stops SLOWER than the drain's own deadline: that is the state a
  // worker that will not stop is in — its turn is still open when the deadline passes, and the
  // resident has to end it by the process group and reap it.
  const rawKill = grok.kill.bind(grok);
  grok.kill = async (workerId, signal) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    return rawKill(workerId, signal);
  };
  const deployment = await openBatonDeployment({ repo: process.cwd(), advanced: {
    deploymentRoot: ${JSON.stringify(deploymentRoot)},
    adapters: { grok },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
  } }, (driverOptions) => createDriver({
    ...driverOptions,
    // The drain's OWN declared deadline, short: the wedged turn outlives it, which is exactly the
    // state a stop that cannot converge is in. Never a host-invented number.
    drainPolicy: { maxWorkers: 64, timeoutMs: 400, pollMs: 10 },
    stopDeadlineMs: 30_000,
  }));
  const host = deployment.host.bind(deployment);
  return {
    runs: deployment.runs,
    async host(...args) {
      const hosted = await host(...args);
      const swarm = await deployment.swarms.create('issue351 wedged worker');
      await swarm.recruit('holder', 'FAKE:STAY_OPEN hold this turn until the resident stops', { exact: ROUTE, resultIntent: 'read_only_evidence' });
      // Bounded, and it says what it saw: a fixture that silently polls forever turns a wiring
      // mistake into a suite that hangs.
      const deadline = Date.now() + 30_000;
      for (;;) {
        const view = await swarm.view();
        if (['working', 'running', 'paused'].includes(view.participants[0]?.runtime?.turn)) break;
        if (Date.now() > deadline) {
          const seen = view.participants.map((row) => ({
            seat: row.seat ?? row.id, turn: row.runtime?.turn ?? null,
            status: row.runtime?.status ?? null, error: row.runtime?.error ?? null,
          }));
          process.stderr.write('issue351: the wedged worker never held its turn: ' + JSON.stringify(seen) + '\\n');
          throw new Error('issue351 fixture: the wedged worker never held its turn');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      process.stderr.write('issue351: wedged worker holding its turn\\n');
      return hosted;
    },
    close: () => deployment.close(),
  };
};
`);
  seedLedger(fixture, 64);
  const serve = startServe(t, fixture, { readyMarker: 'issue351: wedged worker holding its turn' });
  await serve.untilReady();
  await sleep(500);
  const { exit, stderr, msAfterSignal } = await serve.signal('SIGTERM', 45_000);

  assert.notEqual(exit, null, `the resident must not linger: ${stderr.slice(-3_000)}`);
  const rows = stopRows(fixture.ledgerPath);
  const waiting = rows.find((row) => row.payload.kind === 'host.stop_waiting');
  assert.ok(waiting, `the stop never named its wait: ${stderr.slice(-3_000)}`);
  assert.equal(waiting.payload.on, 'worker');
  assert.equal(waiting.payload.ids.length, 1, 'the wait names the worker it is waiting on');
  const [workerId] = waiting.payload.ids;
  // The named wait is on the ledger BEFORE the kill that ends it, and the serve log says the same.
  assert.ok(lineIndex(stderr, `host.stop_waiting on worker ${workerId}`) < lineIndex(stderr, 'host.stopped'),
    stderr.slice(-3_000));

  // The wedged worker's process group was killed and reaped, and that end is on its own ledger.
  const workerRows = allRows(fixture.logPath(workerId));
  const crashed = workerRows.filter((row) => row.kind === 'lifecycle.crashed' && row.payload?.phase === 'shutdown');
  assert.equal(crashed.length, 1, `the forced end is recorded exactly once:\n${JSON.stringify(workerRows.slice(-6))}`);
  assert.equal(typeof crashed[0].payload.signal, 'string',
    `the row names the signal that ended it: ${JSON.stringify(workerRows.map((row) => [row.kind, row.payload?.processGroupId ?? row.payload?.pid ?? null]))}`);
  assert.equal(crashed[0].actor, 'policy');
  const grouped = workerRows.map((row) => row.payload?.processGroupId).filter(Number.isSafeInteger);
  assert.ok(grouped.length > 0, 'the worker ran in a process group of its own');
  for (const group of new Set(grouped)) {
    assert.throws(() => process.kill(-group, 0), 'never a zombie under a live parent: the group is gone');
  }

  // And the stop converges once its named obligation is gone.
  assert.equal(rows.at(-1).payload.kind, 'host.stopped', `the stop ended with its outcome:\n${stderr.slice(-3_000)}`);
  assert.equal(rows.at(-1).payload.state, 'stopped_after_deadline');
  assert.ok(msAfterSignal < 45_000, `the forced stop is bounded; it took ${msAfterSignal}ms`);
});

test('RS4: the publication is withdrawn on stop, and the stop that withdrew it is recorded', async (t) => {
  const fixture = serveFixture(t, 'publication', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}${HEARTBEAT}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`);
  seedLedger(fixture, BULK_ROWS);
  const serve = startServe(t, fixture);
  await serve.untilReady();
  const published = serve.published();
  assert.ok(published.selector !== null && existsSync(published.socketPath), 'the resident published its coordinates');

  const { exit, stderr } = await serve.signal('SIGTERM');
  assert.deepEqual(exit, { code: 0, signal: null, at: exit?.at }, stderr.slice(-2_000));

  // #276(3) pinned under the new stop path: nothing points at the exited process.
  assert.equal(existsSync(serve.selectorPath), false, 'the selector must not survive the resident');
  assert.equal(existsSync(published.profilePath), false, 'the private profile must not survive the resident');
  assert.equal(existsSync(published.tokenPath), false, 'the private token must not survive the resident');
  assert.equal(existsSync(published.socketPath), false, 'the socket must not survive the resident');
  // …and the stop that performed it is on the ledger, in order with its own outcome.
  const rows = stopRows(fixture.ledgerPath).map((row) => row.payload);
  assert.deepEqual(rows.map((row) => row.kind), ['host.stop_requested', 'host.stopped'],
    `the withdrawal is part of a recorded stop:\n${stderr.slice(-2_000)}`);
});
