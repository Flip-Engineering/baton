// Issue #351 lane 2 — the startup answers, the publication tells the truth, and the stop
// request is the signal handler's own first act.
//
// OBSERVED (2026-09-17, the primary deployment, 144 263 coordination rows): the fresh resident's
// open blocked the event loop for its whole replay (a 4 096 ms heartbeat never fired once during
// open in the measured profile), the publication file appeared only after that silence, and a
// `kill -TERM` 40 s later wrote NO `host.stop_requested` row at all — the first lane's row was
// appended inside the drain, after the narration read, so a busy loop postponed the one durable
// fact of the stop indefinitely. The measured stop-path cost at that size is 60 ms: the missing
// row was never expensive, it was merely ordered behind a read.
//
// Rows here pin, at real sizes and through real bytes:
//  (a) `host.stop_requested {trigger, at}` lands on the ledger SYNCHRONOUSLY in the signal
//      handler — before any narration read, even one that never resolves — through the store's
//      own writer path, exactly once per stop;
//  (b) the replay is chunked at the registry's own `view.wake_replay.items` row and the async
//      open offers the loop a breath between chunks (a fast heartbeat keeps beating), while the
//      synchronous open still fails SYNCHRONOUSLY on a broken ledger;
//  (c) the publication flip names the startup truth (open elapsed, rows, checkpoint state) and
//      the doctor renders the same facts; the resident refuses to publish a "served" selector
//      over an unfinished replay;
//  (d) the checkpoint restore's equivalence proof no longer re-serializes every cached row
//      (the profile's JSON-stringifier burn) — a coherent-but-divergent cache is still refused
//      at the ledger's final line, and the ledger stays authoritative.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { serialize, deserialize } from 'node:v8';
import { createHash } from 'node:crypto';

import { CoordinationStore, openCoordinationStoreAsync } from '../src/coordination-store.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { MockAdapter, openBaton } from '../src/index.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const ROUTE = '{ harness: \'codex\', model: \'gpt-5.6-sol\', effort: \'high\' }';

// The ONE declared row this file derives from (#258: no new numeric constants). The replay
// chunk bound, the loop-freedom cadence and the checkpoint bound all read the same registry row.
const LIMIT = FRAME_LIMITS['view.wake_replay.items'];
const HEARTBEAT_MS = LIMIT.value;
// Issue #432: the bound a slow serve child gets to land its flip line on stderr after it
// publishes. It reads the same registry row as the replay cadence — no magic number — and
// its magnitude (seconds) dwarfs the pipe lag it covers (milliseconds once published), so a
// slow child under suite load is a slow pass, never a red.
const FLIP_LOG_WAIT_MS = LIMIT.value;

function repository(t, root) {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'bt351@example.invalid']);
  git(['config', 'user.name', 'BT351']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return repo;
}

function fixtureRoot(t, label) {
  const root = mkdtempSync(`/tmp/bt351-${label}-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

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
      provenance: 'issue351-startup-answer', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
`;

/** A synthetic ledger of `rows` coordination rows, written before anyone opens the store. */
function seedLedger(directory, rows, { pad = 180 } = {}) {
  mkdirSync(directory, { recursive: true });
  const filler = 'x'.repeat(pad);
  const chunks = [];
  for (let seq = 1; seq <= rows; seq += 1) {
    chunks.push(JSON.stringify({
      schemaVersion: 1, seq, ts: '2026-09-17T00:00:00.000Z', kind: 'mcp.audit', actor: 'issue351-fixture',
      idempotencyKey: `issue351:${seq}`, payload: { seq, tool: 'coordination.read', body: filler },
    }));
    if (chunks.length === 5_000) { writeFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`, { flag: 'a' }); chunks.length = 0; }
  }
  if (chunks.length > 0) writeFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`, { flag: 'a' });
}

function allRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

/** The resident's own stop rows, by the kind the resident names them with. */
function stopRows(file) {
  return allRows(file).filter((row) => row.kind === 'driver.recorded'
    && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
}

function lineIndex(stderr, needle) {
  const index = stderr.split('\n').findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `stderr never named "${needle}":\n${stderr.slice(-2_000)}`);
  return index;
}

/** The serve fixture: a real `baton serve` child over a real deployment, like the resident is. */
function serveFixture(t, label, moduleBody, { rows = 2_000 } = {}) {
  const root = fixtureRoot(t, label);
  const repo = repository(t, root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const modulePath = join(root, 'deployment.mjs');
  writeFileSync(modulePath, moduleBody({
    advanced: `
    deploymentRoot: ${JSON.stringify(deploymentRoot)},
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
  `,
  }));
  const ledgerDir = join(deploymentRoot, 'state', 'coordination');
  seedLedger(ledgerDir, rows);
  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  const child = spawn(process.execPath, [SCRIPT, 'serve', modulePath], {
    cwd: repo,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal, at: Date.now() }; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return {
    root, repo, child, state, selectorPath, ledgerPath: join(ledgerDir, 'events.jsonl'),
    async untilReady(timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (state.exited !== null) break;
        if (existsSync(selectorPath)) return;
        await sleep(25);
      }
      throw new Error(`serve child never became ready (exit=${JSON.stringify(state.exited)}): ${state.stderr.slice(-2_000)}`);
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Issue #432: wait for a needle on a serve child's stderr the way OL-b waits — the
 * publication (connection.json) can precede the flip line down the stderr pipe under
 * suite load, so an immediate read races the child. Bounded by the derived
 * FLIP_LOG_WAIT_MS; a child that exits first keeps whatever it already wrote. */
async function untilStderr(state, needle, timeoutMs = FLIP_LOG_WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.stderr.includes(needle)) return;
    if (state.exited !== null) break;
    await sleep(25);
  }
  assert.ok(state.stderr.includes(needle), `stderr never named "${needle}":\n${state.stderr.slice(-2_000)}`);
}

test('SA1: the stop request is the signal handler\u2019s own act \u2014 it lands before a narration read that never resolves', async (t) => {
  // The deployment's runs.list NEVER resolves: the first lane's drain-ordered row died exactly
  // here (the row waited behind the narration read). The handler's own append must not.
  const fixture = serveFixture(t, 'hang', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = async () => {
  const deployment = await openBaton({ repo: process.cwd(), advanced: {${advanced}} });
  return {
    runs: { ...deployment.runs, list: () => new Promise(() => {}) },
    host: (...args) => deployment.host(...args),
    close: () => deployment.close(),
    recordStopRequested: (trigger) => deployment.recordStopRequested(trigger),
    startupReport: () => deployment.startupReport(),
  };
};
`);
  await fixture.untilReady();
  const signalAt = Date.now();
  fixture.child.kill('SIGTERM');
  // The row must be durable while the narration read is still hung — bounded by the append
  // itself, not by anything the busy drain owes the operator.
  const deadline = signalAt + 15_000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = stopRows(fixture.ledgerPath);
    if (rows.some((row) => row.payload.kind === 'host.stop_requested')) break;
    await sleep(50);
  }
  const requested = rows.find((row) => row.payload.kind === 'host.stop_requested');
  assert.ok(requested, `no host.stop_requested row landed while the narration hung:\n${fixture.state.stderr.slice(-2_000)}`);
  assert.equal(requested.payload.trigger, 'SIGTERM', 'the row names the trigger the handler was admitted by');
  assert.ok(typeof requested.payload.at === 'string' && requested.payload.at.length > 0, 'the row is stamped');
  assert.ok(existsSync(fixture.selectorPath) === false || fixture.state.exited !== null || true,
    'the child remains whatever it is — the row is the assertion here');
  // The drain never converges behind the hung read; the resident is ended the way the
  // operator ends a wedged one. No second stop row may exist (one stop, one request).
  await sleep(500);
  assert.equal(stopRows(fixture.ledgerPath).filter((row) => row.payload.kind === 'host.stop_requested').length, 1,
    'the stop request is exactly one row, however many paths consult it');
  fixture.child.kill('SIGKILL');
});

test('SA2: a converged stop reads in the order the facts happened \u2014 request, intent, outcome', async (t) => {
  const fixture = serveFixture(t, 'order', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`);
  await fixture.untilReady();
  fixture.child.kill('SIGTERM');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && fixture.state.exited === null) await sleep(50);
  assert.deepEqual(fixture.state.exited, { code: 0, signal: null, at: fixture.state.exited?.at },
    `a converged stop exits 0:\n${fixture.state.stderr.slice(-2_000)}`);
  // The request row precedes the narration intent line — the handler spoke first.
  assert.ok(lineIndex(fixture.state.stderr, 'host.stop_requested trigger SIGTERM at ')
    < lineIndex(fixture.state.stderr, 'signal received;'),
    `the request is narrated before the drain intent:\n${fixture.state.stderr.slice(-2_000)}`);
  const rows = stopRows(fixture.ledgerPath).map((row) => row.payload);
  assert.deepEqual(rows.map((row) => row.kind), ['host.stop_requested', 'host.stopped'],
    `a stop is two bounded rows, once each:\n${fixture.state.stderr.slice(-2_000)}`);
});

test('SA3: the flip names the startup truth, and the doctor renders the same coordination row', async (t) => {
  const fixture = serveFixture(t, 'flip', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`);
  await fixture.untilReady();
  // The ONE line at the flip: published, and how long the startup took, and what it folded.
  // Issue #432: untilReady returns when connection.json appears, but the flip line still
  // rides the stderr pipe behind it — under suite load (parallelism 2) the immediate read
  // below saw a published child whose flip had not arrived yet. Poll for the whole stream
  // until the child publishes the line, bounded by the derived FLIP_LOG_WAIT_MS.
  await untilStderr(fixture.state, 'baton serve: answering (open ');
  const flip = lineIndex(fixture.state.stderr, 'baton serve: answering (open ');
  assert.ok(fixture.state.stderr.split('\n')[flip].includes('rows on the ledger;'),
    `the flip line names the ledger rows:\n${fixture.state.stderr.slice(-2_000)}`);
  assert.ok(fixture.state.stderr.split('\n')[flip].includes('checkpoint '),
    `the flip line names the checkpoint decision:\n${fixture.state.stderr.slice(-2_000)}`);
  assert.ok(fixture.state.stderr.split('\n')[flip].includes('reconstructed '),
    `the flip line names the reconstruction elapsed (lane 4):\n${fixture.state.stderr.slice(-2_000)}`);

  // The doctor renders the same facts in-process (the non-enumerable DP5 attach: property
  // readers see it, the serialized row shape stays byte-stable).
  const root = fixtureRoot(t, 'doctor');
  const repo = repository(t, root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const ledgerDir = join(deploymentRoot, 'state', 'coordination');
  seedLedger(ledgerDir, 64, { pad: 40 });
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapterInProcess() },
      routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env: { XDG_CONFIG_HOME: configRoot, HOME: home }, home, webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
  });
  try {
    const doctor = await deployment.doctor();
    const coordination = doctor.coordination;
    assert.ok(coordination, 'the doctor carries the coordination startup row');
    assert.equal(coordination.schemaVersion, 1);
    assert.equal(coordination.state, 'ready', 'the published resident is a ready one');
    assert.equal(coordination.rows, 64, 'the row names the ledger the replay folded');
    assert.ok(Number.isSafeInteger(coordination.openElapsedMs) && coordination.openElapsedMs >= 0,
      'the row names the open\u2019s own elapsed milliseconds');
    const report = deployment.startupReport();
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.rows, coordination.rows, 'the flip and the doctor read one truth');
  } finally {
    await deployment.close();
  }
});

// The same adapter card the serve fixtures use, built in-process for the doctor row.
function adapterInProcess() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue351 fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue351-startup-answer', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

test('SA4: the async open yields the loop between chunks \u2014 and the sync open still fails synchronously', async (t) => {
  const root = fixtureRoot(t, 'chunks');
  const ledgerDir = join(root, 'state', 'coordination');
  const beats = [];
  const timer = setInterval(() => { beats.push(Date.now()); }, Math.max(1, Math.floor(HEARTBEAT_MS / 100)));
  timer.unref();
  // The heartbeat runs at 1/100th of the declared period: a replay that never yields would
  // finish this open without a single beat.
  // Forty chunks at the declared bound, padded rows: fast enough to keep the suite quick,
  // long enough that a replay with no breaths would starve the heartbeat.
  const rows = LIMIT.value * 40;
  seedLedger(ledgerDir, rows, { pad: 180 });
  const reopened = await openCoordinationStoreAsync(ledgerDir, {});
  clearInterval(timer);
  assert.ok(beats.length >= 2,
    `the loop never breathed during an ${rows}-row replay at a ${HEARTBEAT_MS / 100}ms heartbeat (${beats.length} beats)`);
  const status = reopened.startupStatus();
  assert.equal(status.state, 'ready');
  assert.equal(status.source, 'ledger');
  assert.equal(status.totalEvents, rows, 'the chunked replay folds exactly the history');
  assert.equal(reopened.snapshot().lastSeq, rows);

  // The synchronous open (the constructor's default) either loads fully or throws NOW —
  // a half-loaded store can never survive a failed open.
  const tampered = readFileSync(join(ledgerDir, 'events.jsonl'), 'utf8')
    .replace('"idempotencyKey":"issue351:2"', '"idempotencyKey":"issue351:1"');
  assert.notEqual(tampered, readFileSync(join(ledgerDir, 'events.jsonl'), 'utf8'));
  writeFileSync(join(ledgerDir, 'events.jsonl'), tampered);
  assert.throws(() => new CoordinationStore(ledgerDir),
    (error) => error?.code === 'duplicate_key',
    'the synchronous open must fail synchronously on a broken ledger');
  reopened.releaseWriterLease({ requireOwned: true });
});

test('SA5: the restore refuses a coherent-but-divergent cache at the ledger\u2019s final line \u2014 without re-serializing every row', (t) => {
  const root = fixtureRoot(t, 'tail-anchor');
  const directory = join(root, 'coordination');
  const store = new CoordinationStore(directory, { checkpointInterval: 16 });
  store.claimWriterLease();
  for (let index = 0; index < 30; index += 1) {
    store.recordMcpAudit({ entry: index }, { actor: 'test:issue351', key: `issue351:tail:${index}` });
  }
  store.releaseWriterLease({ requireOwned: true });
  assert.ok(existsSync(join(directory, 'projection.checkpoint')), 'the release wrote a bounded checkpoint');

  // Corrupt the cache's LAST event and re-derive every digest the envelope checks — every
  // digest gate now passes, exactly as a store bug that diverges the cache from the ledger
  // would leave them. The equivalence proof must still refuse it, at O(1), not O(ledger).
  const checkpointPath = join(directory, 'projection.checkpoint');
  const envelope = deserialize(readFileSync(checkpointPath));
  const projection = deserialize(envelope.projectionBytes);
  const last = projection._events.at(-1);
  const divergent = JSON.parse(JSON.stringify(last));
  divergent.payload.entry = 999_999;
  projection._events = projection._events.slice(0, -1).concat([divergent]);
  const projectionBytes = serialize(projection);
  envelope.projectionBytes = projectionBytes;
  envelope.projectionDigest = createHash('sha256').update(projectionBytes).digest('hex');
  writeFileSync(checkpointPath, serialize(envelope));

  const reopened = new CoordinationStore(directory);
  const status = reopened.startupStatus();
  assert.equal(status.checkpoint, 'corrupt', 'the divergent cache is refused');
  assert.equal(status.source, 'ledger_fallback', 'the ledger stays authoritative');
  assert.equal(reopened.snapshot().lastSeq, 30, 'and the replay answers from the ledger bytes');
  reopened.releaseWriterLease({ requireOwned: true });
});
