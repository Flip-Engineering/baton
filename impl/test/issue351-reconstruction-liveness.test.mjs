// Issue #351 lane 4 — the reconstruction-liveness remainder. Lanes 2 and 3 made the
// coordination replay breathe and the Coordinator's projection-derived startup run ONCE after
// the replay resolves (#434); this lane makes the startup reconstruction itself a yielding
// sequence on the async-open path — the SAME pass order the synchronous constructor path drains
// without ever awaiting, with the yield cadence read from the registry bound the fold reads
// (FRAME_LIMITS['view.wake_replay.items']) — and publishes the phase: the startup report and
// the serve flip line say `reconstructing` between `replaying` and `answering`, with the
// reconstruction's own elapsed milliseconds.
//
// Rows here pin, at fixture sizes and through real bytes:
//  (a) a seeded ledger with many tasks and workers opens through
//      createDriver({coordinationAsyncOpen: true}) with a heartbeat that beats BETWEEN the
//      replay's resolution and the reconstruction's end — at HEAD the reconstruction is one
//      synchronous stretch, so no beat can fire inside the window (observed red before this
//      lane) — and the loop never stalls past the heartbeat bound;
//  (b) the sync path (no coordinationAsyncOpen) produces the identical coordinator state —
//      one canonical projection of tasks/workers, equal after both opens;
//  (c) the startup report carries the reconstruction phase and elapsed
//      (reconstructionState 'done', reconstructionElapsedMs a non-negative number);
//  (d) the serve log's answering flip line prints the reconstruction elapsed
//      (`reconstructed Nms`) after the replayed line.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { createDriver, MockAdapter, openBaton } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const LIMIT = FRAME_LIMITS['view.wake_replay.items'];
// The liveness heartbeat, the same shape the open-liveness fixture uses: its period sits far
// below any registry-bounded unit of the reconstruction, and the bound allows timer slack.
const HEARTBEAT_MS = 100;
const HEARTBEAT_BOUND_MS = 4 * HEARTBEAT_MS;

function fixtureRoot(t, label) {
  const root = mkdtempSync(join(tmpdir(), `bt351r-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(root) {
  const repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'bt351r@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'BT351R']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  return repo;
}

/** A synthetic coordination ledger of `rows` rows, written before anyone opens the store — the
 * seedLedger idiom from issue351-open-liveness.test.mjs. */
function seedLedger(directory, rows, { pad = 180 } = {}) {
  mkdirSync(directory, { recursive: true });
  const filler = 'x'.repeat(pad);
  const chunks = [];
  for (let seq = 1; seq <= rows; seq += 1) {
    chunks.push(JSON.stringify({
      schemaVersion: 1, seq, ts: '2026-09-17T00:00:00.000Z', kind: 'mcp.audit', actor: 'issue351r-fixture',
      idempotencyKey: `issue351r:${seq}`, payload: { seq, tool: 'coordination.read', body: filler },
    }));
    if (chunks.length === 5_000) { writeFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`, { flag: 'a' }); chunks.length = 0; }
  }
  if (chunks.length > 0) writeFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`, { flag: 'a' });
}

/** `workers` worker ledgers of `eventsPer` legal story events each — the seedWorkers idiom. */
function seedWorkers(stateDir, workers, eventsPer) {
  mkdirSync(stateDir, { recursive: true });
  for (let index = 0; index < workers; index += 1) {
    const workerId = `w-${index}`;
    const lines = [];
    let seq = 0;
    let clock = 0;
    const event = (kind, actor, payload) => JSON.stringify({
      schemaVersion: 1, worker: workerId, harness: 'codex', turnEpoch: 1, seq: ++seq,
      ts: new Date(Date.UTC(2026, 8, 17, 0, 0, 0, clock += 10)).toISOString(),
      kind, actor, payload,
    });
    lines.push(event('lifecycle.spawned', 'orchestrator', { taskId: `task-${workerId}`, brief: { goal: `issue351r ${workerId}` } }));
    for (let turn = 0; lines.length < eventsPer - 1; turn += 1) {
      lines.push(event('lifecycle.turn_started', 'orchestrator', { turn }));
      if (lines.length < eventsPer - 1) lines.push(event('lifecycle.turn_completed', 'worker', { turn }));
    }
    lines.push(event('lifecycle.exited', 'worker', { reason: 'issue351r fixture' }));
    writeFileSync(join(stateDir, `${workerId}.jsonl`), `${lines.join('\n')}\n`);
  }
}

function heartbeat(intervalMs = HEARTBEAT_MS) {
  const state = { fired: 0, max: 0, last: performance.now() };
  const timer = setInterval(() => {
    const now = performance.now();
    state.max = Math.max(state.max, now - state.last);
    state.last = now;
    state.fired += 1;
  }, intervalMs);
  timer.unref();
  return { timer, state };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function adapterInProcess() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue351r fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', mechanisms: [], configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue351-reconstruction-liveness', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

test('RL-a: the heartbeat beats between the replay\u2019s resolution and the reconstruction\u2019s end', async (t) => {
  const root = fixtureRoot(t, 'liveness');
  const repo = repository(root);
  const logDir = join(root, 'state');
  // Large enough that the reconstruction is several heartbeat periods wide (measured at HEAD:
  // the 600 x 400 worker-event fold plus the 150k-row projection clone is ~0.5 s on this
  // machine), so the window can hold beats at all.
  seedLedger(join(logDir, 'coordination'), 150_000);
  seedWorkers(logDir, 600, 400);
  const { timer, state } = heartbeat();
  let driver;
  try {
    driver = createDriver({
      repoRoot: repo, repoId: 'issue351-reconstruction-liveness', logDir, adapters: {},
      coordinationAsyncOpen: true,
    });
    // The window: the replay resolves when the store's own startup state flips ready; the
    // reconstruction runs after that, and coordinationOpened resolves when it is done.
    const began = performance.now();
    while (driver.coordination.startupStatus().state !== 'ready' && performance.now() - began < 120_000) {
      await sleep(2);
    }
    const beatsAtReconstructionStart = state.fired;
    await driver.coordinationOpened;
    const beatsAtReconstructionEnd = state.fired;
    assert.ok(beatsAtReconstructionEnd > beatsAtReconstructionStart,
      `no heartbeat beat between the replay's resolution and the reconstruction's end ` +
      `(${beatsAtReconstructionStart} -> ${beatsAtReconstructionEnd}) — the reconstruction is one synchronous stretch`);
    assert.ok(state.max <= HEARTBEAT_BOUND_MS,
      `the open stalled the loop for ${Math.round(state.max)}ms — longer than the ${HEARTBEAT_BOUND_MS}ms bound`);
    const status = driver.coordinator.startupReconstructionStatus();
    assert.equal(status.state, 'done', 'the reconstruction phase settles done');
    assert.ok(typeof status.elapsedMs === 'number' && status.elapsedMs >= 0,
      `the reconstruction's elapsed milliseconds are measured (${status.elapsedMs})`);
  } finally {
    clearInterval(timer);
    await driver?.close?.();
  }
});

test('RL-b: the sync constructor path and the async open produce the identical coordinator state', async (t) => {
  const root = fixtureRoot(t, 'parity');
  const repo = repository(root);
  const logDirSync = join(root, 'state-sync');
  const logDirAsync = join(root, 'state-async');
  for (const dir of [logDirSync, logDirAsync]) {
    seedLedger(join(dir, 'coordination'), 30_000);
    seedWorkers(dir, 100, 60);
  }
  // The canonical projection: the folded task and worker identity, status and binding — the
  // state the reconstruction derives from history, compared after both opens.
  const projection = (coordinator) => JSON.stringify({
    tasks: [...coordinator._tasks.values()]
      .map((task) => ({ id: task.id, status: task.status, assignee: task.assignee, runId: task.runId ?? null, taskType: task.taskType }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    workers: [...coordinator._workers.values()]
      .map((handle) => ({ id: handle.id, status: handle.status, taskId: handle.taskId ?? null, runId: handle.runId ?? null }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  });
  const syncDriver = createDriver({ repoRoot: repo, repoId: 'issue351-rl-b', logDir: logDirSync, adapters: {} });
  let asyncDriver;
  try {
    asyncDriver = createDriver({
      repoRoot: repo, repoId: 'issue351-rl-b', logDir: logDirAsync, adapters: {},
      coordinationAsyncOpen: true,
    });
    await asyncDriver.coordinationOpened;
    assert.equal(projection(syncDriver.coordinator), projection(asyncDriver.coordinator),
      'the async open\u2019s coordinator state diverged from the sync path\u2019s');
  } finally {
    await syncDriver?.close?.();
    await asyncDriver?.close?.();
  }
});

test('RL-c: the startup report carries the reconstruction phase and elapsed', async (t) => {
  const root = fixtureRoot(t, 'report');
  const repo = repository(root);
  const deploymentRoot = join(root, 'deployment');
  mkdirSync(deploymentRoot, { recursive: true });
  const logDir = join(deploymentRoot, 'state');
  seedLedger(join(logDir, 'coordination'), 20_000);
  seedWorkers(logDir, 40, 24);
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapterInProcess() },
      routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env: { XDG_CONFIG_HOME: join(root, 'config'), HOME: join(root, 'home') }, home: join(root, 'home'), webDrainMs: 2_000, sessionTtlMs: 60_000 },
    },
  });
  try {
    const report = deployment.startupReport();
    assert.equal(report.state, 'ready', 'the open settles ready once the reconstruction is done');
    assert.equal(report.reconstructionState, 'done',
      `the report names the reconstruction phase (got ${JSON.stringify(report.reconstructionState)})`);
    assert.ok(typeof report.reconstructionElapsedMs === 'number' && report.reconstructionElapsedMs >= 0,
      `the report carries the reconstruction elapsed milliseconds (got ${JSON.stringify(report.reconstructionElapsedMs)})`);
  } finally {
    await deployment.close();
  }
});

/** The serve fixture: a real `baton serve` child over a real deployment, like the resident is. */
function serveFixture(t, label, { rows, workers = 40, eventsPer = 24 } = {}) {
  const root = fixtureRoot(t, label);
  const repo = repository(root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const modulePath = join(root, 'deployment.mjs');
  // The OL-a idiom: the child's deployment module patches the adapter card so the exact route
  // is ready (credentialState available, exact model selection) — a plain MockAdapter's card
  // reads route-unavailable at the profile check.
  writeFileSync(modulePath, `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue351r fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', mechanisms: [], configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue351-reconstruction-liveness', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
export const createBatonDeployment = async () => openBaton({ repo: process.cwd(), advanced: {
  deploymentRoot: ${JSON.stringify(deploymentRoot)},
  adapters: { codex: adapter() },
  routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
  verification: { command: 'node', arguments: ['--test'] },
  resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
} });
`);
  const ledgerDir = join(deploymentRoot, 'state', 'coordination');
  seedLedger(ledgerDir, rows);
  seedWorkers(join(deploymentRoot, 'state'), workers, eventsPer);
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
  return { root, repo, child, state, selectorPath, env };
}

test('RL-d: the serve flip line prints the reconstruction it ran', async (t) => {
  const fixture = serveFixture(t, 'flip-reconstruction', { rows: LIMIT.value * 30 });
  // The resident answers (and the flip line prints) once the open — replay and reconstruction —
  // is done; wait for the flip, then read the line the loop was free enough to write.
  const deadline = Date.now() + 60_000;
  while (!fixture.state.stderr.includes('baton serve: answering (open ') && Date.now() < deadline && fixture.state.exited === null) {
    await sleep(50);
  }
  assert.equal(fixture.state.exited, null, `the serve child stayed up:\n${fixture.state.stderr.slice(-2_000)}`);
  const flipLine = fixture.state.stderr.split('\n').find((line) => line.includes('baton serve: answering (open '));
  assert.ok(flipLine, `the flip line never printed:\n${fixture.state.stderr.slice(-2_000)}`);
  assert.match(flipLine, /reconstructed \d+ms/u,
    `the flip line does not name the reconstruction it ran:\n${flipLine}`);
  const replayedLine = fixture.state.stderr.split('\n').findIndex((line) => line.includes('baton serve: replayed (open '));
  if (replayedLine !== -1) {
    const flipIndex = fixture.state.stderr.split('\n').indexOf(flipLine);
    assert.ok(replayedLine < flipIndex, 'the replayed line precedes the answering flip');
  }
});
