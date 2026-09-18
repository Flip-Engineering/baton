// Issue #351 lane 3 — the production open path. Lanes 1 and 2 bounded the release checkpoint
// and chunked the replay generator; this lane drives the production open through that async
// path, defers the story ingest, and pins the open's liveness at real sizes.
//
// MEASURED (2026-09-18, this worktree, node 22 on the M4 — the omp-351b sample: 144 263
// coordination rows, 669 worker ledgers, 81 MB events.jsonl at
// /private/tmp/baton-ledger-sample-20260917/state):
//   - the production open (createDriver) blocks the event loop for its whole duration:
//     the synchronous coordination load is 7 793 ms with a 20 ms heartbeat firing ZERO
//     times, and the eager story ingest of the 669 worker ledgers is 5 499-6 213 ms with
//     ZERO beats — foldEvent deep-clones EVERY worker's story for EVERY event (the
//     profile's cloneWorkerStory/cloneState burn);
//   - the in-place fold (applyEvent on the live state — the clone was thrown away on the
//     next event anyway) compiles the same 128 687 events in 58 ms with deep-equal
//     snapshots (assert.deepStrictEqual over story.snapshot());
//   - the async replay (lane 2's generator, 4 096-event chunks from
//     FRAME_LIMITS['view.wake_replay.items']) folds the real 144k-row ledger with a 447 ms
//     maximum stall per chunk;
//   - claimWriterLease's 81 MB digest re-verification is 49 ms and a 64-append burst's
//     group-commit drain fsync is ~4 ms warm — the fsyncs are already batched; the git
//     spawns on the primary checkout are ≤80 ms warm (the 15 s of omp-351b's profile was
//     the cold, saturated primary).
//
// Rows here pin, at fixture sizes and through real bytes:
//  (a) a deployment with 150 000 coordination rows AND 600 worker ledgers opens through
//      createDriver with a heartbeat on the same loop, and the loop beats — the open's
//      synchronous stretches are the artifact format's own (one ledger read), never the
//      history's;
//  (b) the serve child narrates the replaying→published sequence — the replay line, then
//      the flip line — and a real `baton swarm list` client answers within a bound of the
//      flip, while every probe before the flip refuses fast (the publication never points
//      at a resident that cannot answer);
//  (c) a tampered ledger rejects the async open with the typed replay refusal and leaves
//      no writer lease behind (the #304/#290 contract, now from the async open);
//  (d) a worker's story is served correctly on FIRST READ after the lazy ingest, the whole
//      state after a full drain equals the eager compile, and the chunked warm yields the
//      loop between chunks (the fold's determinism is unchanged);
//  (e) SIGTERM DURING the open is admitted before the deployment exists: the row lands,
//      the stop converges, and no writer lease is left behind.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { createDriver, MockAdapter, openBaton } from '../src/index.mjs';
import { StoryCompiler } from '../src/story.mjs';
import { Log } from '../src/log.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const ROUTE = '{ harness: \'codex\', model: \'gpt-5.6-sol\', effort: \'high\' }';

// The ONE declared row this file derives from (#258): the replay chunk bound is the same
// registry row lane 2's replay and the story warm read their cadence from.
const LIMIT = FRAME_LIMITS['view.wake_replay.items'];
// The liveness heartbeat. Its period sits above the open's one unbreakable synchronous
// stretch (the seeded ledger's single readFileSync — the artifact format's own cost) and
// far below any history-proportional work; the bound allows the timer's own slack around
// that one stretch, and every registry-bounded fold chunk is an order of magnitude under it.
const HEARTBEAT_MS = 200;
const HEARTBEAT_BOUND_MS = 4 * HEARTBEAT_MS;

function fixtureRoot(t, label) {
  const root = mkdtempSync(`/tmp/bt351c-${label}-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t, root) {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'bt351c@example.invalid']);
  git(['config', 'user.name', 'BT351C']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return repo;
}

/** A synthetic coordination ledger of `rows` rows, written before anyone opens the store. */
function seedLedger(directory, rows, { pad = 180 } = {}) {
  mkdirSync(directory, { recursive: true });
  const filler = 'x'.repeat(pad);
  const chunks = [];
  for (let seq = 1; seq <= rows; seq += 1) {
    chunks.push(JSON.stringify({
      schemaVersion: 1, seq, ts: '2026-09-17T00:00:00.000Z', kind: 'mcp.audit', actor: 'issue351c-fixture',
      idempotencyKey: `issue351c:${seq}`, payload: { seq, tool: 'coordination.read', body: filler },
    }));
    if (chunks.length === 5_000) { writeFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`, { flag: 'a' }); chunks.length = 0; }
  }
  if (chunks.length > 0) writeFileSync(join(directory, 'events.jsonl'), `${chunks.join('\n')}\n`, { flag: 'a' });
}

/** `workers` worker ledgers of `eventsPer` legal story events each, in the state dir. */
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
    lines.push(event('lifecycle.spawned', 'orchestrator', { taskId: `task-${workerId}`, brief: { goal: `issue351c ${workerId}` } }));
    for (let turn = 0; lines.length < eventsPer - 1; turn += 1) {
      lines.push(event('lifecycle.turn_started', 'orchestrator', { turn }));
      if (lines.length < eventsPer - 1) lines.push(event('lifecycle.turn_completed', 'worker', { turn }));
    }
    lines.push(event('lifecycle.exited', 'worker', { reason: 'issue351c fixture' }));
    writeFileSync(join(stateDir, `${workerId}.jsonl`), `${lines.join('\n')}\n`);
  }
}

function heartbeat() {
  const state = { fired: 0, max: 0, last: performance.now() };
  const timer = setInterval(() => {
    const now = performance.now();
    state.max = Math.max(state.max, now - state.last);
    state.last = now;
    state.fired += 1;
  }, HEARTBEAT_MS);
  timer.unref();
  return { timer, state };
}

function adapterModuleBody() {
  return `
function adapter() {
  const value = new MockAdapter({ harness: ${JSON.stringify('codex')}, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue351c fixture' } });
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
      provenance: 'issue351-open-liveness', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
`;
}

function adapterInProcess() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue351c fixture' } });
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
      provenance: 'issue351-open-liveness', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lineIndex(stderr, needle) {
  const index = stderr.split('\n').findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `stderr never named "${needle}":\n${stderr.slice(-2_000)}`);
  return index;
}

/** The serve fixture: a real `baton serve` child over a real deployment, like the resident is. */
function serveFixture(t, label, { rows, openDelayMs = 0 } = {}) {
  const root = fixtureRoot(t, label);
  const repo = repository(t, root);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const modulePath = join(root, 'deployment.mjs');
  writeFileSync(modulePath, `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${adapterModuleBody()}
export const createBatonDeployment = async () => {
  // A deterministic open window: the factory holds before the open so a signal sent at a
  // fixed wall offset provably arrives DURING the open, whatever the machine's speed.
  await new Promise((resolve) => setTimeout(resolve, ${JSON.stringify(openDelayMs)}));
  return openBaton({ repo: process.cwd(), advanced: {
    deploymentRoot: ${JSON.stringify(deploymentRoot)},
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
  } });
};
`);
  const ledgerDir = join(deploymentRoot, 'state', 'coordination');
  seedLedger(ledgerDir, rows);
  const selectorPath = join(repo, '.git', 'baton', 'connection.json');
  // Issue #471: the ONE fixture-resident spawn — the child declares THIS runner and is ended by
  // process group at the test's after-hook (and by the runner's death, however it dies).
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', modulePath],
    cwd: repo,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot },
  });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal, at: Date.now() }; });
  return {
    root, repo, child, state, selectorPath, ledgerPath: join(ledgerDir, 'events.jsonl'),
    leasePath: join(ledgerDir, 'writer.lease'), env,
  };
}

test('OL-a: a 150 000-row, 600-worker-ledger deployment opens through createDriver with the loop beating', async (t) => {
  const root = fixtureRoot(t, 'open-liveness');
  const repo = repository(t, root);
  const deploymentRoot = join(root, 'deployment');
  const stateDir = join(deploymentRoot, 'state');
  mkdirSync(deploymentRoot, { recursive: true });
  seedLedger(join(stateDir, 'coordination'), 150_000);
  seedWorkers(stateDir, 600, 24);
  const { timer, state } = heartbeat();
  let deployment;
  try {
    deployment = await openBaton({
      repo,
      advanced: {
        deploymentRoot,
        adapters: { codex: adapterInProcess() },
        routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
        verification: { command: 'node', arguments: ['--test'] },
        resident: { env: { XDG_CONFIG_HOME: join(root, 'config'), HOME: join(root, 'home') }, home: join(root, 'home'), webDrainMs: 2_000, sessionTtlMs: 60_000 },
      },
    });
  } finally {
    clearInterval(timer);
  }
  try {
    assert.ok(state.fired >= 2,
      `the open starved a ${HEARTBEAT_MS}ms heartbeat (${state.fired} beats) — the loop was blocked for the whole open`);
    assert.ok(state.max <= HEARTBEAT_BOUND_MS,
      `the open stalled the loop for ${Math.round(state.max)}ms — longer than the ${HEARTBEAT_BOUND_MS}ms bound`);
    const report = deployment.startupReport();
    assert.equal(report.rows, 150_000, 'the async replay folded exactly the seeded history');
    assert.equal(report.state, 'ready');
  } finally {
    await deployment.close();
  }
});

test('OL-b: the serve log reads replaying then published, and swarm list answers within a bound of the flip', async (t) => {
  const fixture = serveFixture(t, 'flip-bound', { rows: LIMIT.value * 30 });
  const probes = [];
  const probe = () => {
    const started = performance.now();
    const child = spawnSync(process.execPath, [SCRIPT, 'swarm', 'list'], {
      cwd: fixture.repo, env: { ...process.env, HOME: fixture.env.HOME, XDG_CONFIG_HOME: fixture.env.XDG_CONFIG_HOME },
      encoding: 'utf8', timeout: 30_000,
    });
    return {
      started, elapsed: performance.now() - started, code: child.status,
      stdout: child.stdout ?? '', stderr: child.stderr ?? '',
      spawnError: child.error?.message ?? null, signal: child.signal ?? null,
    };
  };
  const deadline = Date.now() + 90_000;
  let firstAnswer = null;
  let preFlipRefusals = 0;
  while (Date.now() < deadline) {
    if (!existsSync(fixture.selectorPath)) {
      const pending = probe();
      probes.push(pending);
      if (pending.code === 0) {
        // The probe raced the flip (the CLI ran while the selector appeared under it): that
        // is the first answer. A real lie is an answer with the selector still absent.
        if (!existsSync(fixture.selectorPath)) {
          throw new Error(`a client answered while no publication existed:\n${String(pending.stdout).slice(0, 400)}`);
        }
        firstAnswer = { ...pending, fromFlipMs: pending.elapsed };
        break;
      }
      preFlipRefusals += 1;
      await sleep(250);
      continue;
    }
    const flipAt = performance.now();
    firstAnswer = probe();
    firstAnswer.fromFlipMs = performance.now() - flipAt;
    break;
  }
  assert.notEqual(firstAnswer, null, 'the serve child never published within the deadline');
  assert.equal(firstAnswer.code, 0, `the first post-flip client refused (${JSON.stringify({ code: firstAnswer.code, signal: firstAnswer.signal, spawnError: firstAnswer.spawnError, elapsed: Math.round(firstAnswer.elapsed) })}):\n${String(firstAnswer.stderr).slice(0, 800)}`);
  assert.ok(firstAnswer.fromFlipMs <= 5_000,
    `the first client answer took ${Math.round(firstAnswer.fromFlipMs)}ms after the flip — past the 5 000ms bound`);
  assert.ok(preFlipRefusals >= 1, 'the fixture never observed the pre-flip window it exists to pin');
  // The sequence in the operator's log: the replay line, then the flip line. Lines travel
  // the stderr pipe asynchronously — poll for BOTH before asserting, never at first sight.
  const logDeadline = Date.now() + 15_000;
  while ((!fixture.state.stderr.includes('baton serve: replayed (open ')
    || !fixture.state.stderr.includes('answering (open ')) && Date.now() < logDeadline) {
    await sleep(25);
  }
  const replay = lineIndex(fixture.state.stderr, 'baton serve: replayed (open ');
  const flip = lineIndex(fixture.state.stderr, 'answering (open ');
  assert.ok(replay < flip, 'the replay line must precede the flip line — the log reads in the order the facts happened');
  try { fixture.child.kill('SIGTERM'); } catch {}
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 30_000);
    fixture.child.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
});

test('OL-c: a tampered ledger rejects the open with the typed replay refusal and leaves no writer lease', async (t) => {
  const root = fixtureRoot(t, 'tampered');
  const repo = repository(t, root);
  const deploymentRoot = join(root, 'deployment');
  const stateDir = join(deploymentRoot, 'state');
  mkdirSync(deploymentRoot, { recursive: true });
  const ledgerDir = join(stateDir, 'coordination');
  seedLedger(ledgerDir, 64, { pad: 40 });
  const tampered = readFileSync(join(ledgerDir, 'events.jsonl'), 'utf8')
    .replace('"idempotencyKey":"issue351c:2"', '"idempotencyKey":"issue351c:1"');
  assert.notEqual(tampered, readFileSync(join(ledgerDir, 'events.jsonl'), 'utf8'));
  writeFileSync(join(ledgerDir, 'events.jsonl'), tampered);
  await assert.rejects(
    openBaton({
      repo,
      advanced: {
        deploymentRoot,
        adapters: { codex: adapterInProcess() },
        routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
        verification: { command: 'node', arguments: ['--test'] },
        resident: { env: { XDG_CONFIG_HOME: join(root, 'config'), HOME: join(root, 'home') }, home: join(root, 'home'), webDrainMs: 2_000, sessionTtlMs: 60_000 },
      },
    }),
    (error) => error?.code === 'duplicate_key',
    'the async open must reject with the replay integrity refusal',
  );
  assert.equal(existsSync(join(ledgerDir, 'writer.lease')), false,
    'a failed open must not leave a writer lease behind');
});

test('OL-d: a worker story is served on first read after the lazy ingest, and the chunked warm yields', async (t) => {
  const root = fixtureRoot(t, 'story-lazy');
  const repo = repository(t, root);
  const logDir = join(root, 'log');
  seedWorkers(logDir, 3, 12);
  const log = new Log(logDir, () => new Date().toISOString());
  const workerIds = log.workers().sort();
  assert.equal(workerIds.length, 3);
  const driver = createDriver({
    repoRoot: repo,
    repoId: 'repo-issue351c-story',
    logDir,
    adapters: { codex: adapterInProcess() },
    stopDeadlineMs: 2_000,
  });
  try {
    // The open deferred every worker ledger: nothing was eagerly ingested.
    assert.deepEqual([...driver.story.pendingWorkers()].sort(), workerIds,
      'createDriver must defer the worker ledgers, not clone them all before answering');
    // First read of ONE worker serves that worker's story — identical to the eager compile.
    const reference = new StoryCompiler({});
    for (const id of workerIds) for (const event of log.read(id)) reference.ingest(event);
    const firstRead = driver.story.workerState(workerIds[1]);
    assert.deepEqual(firstRead, reference.workerState(workerIds[1]),
      'the first read of a deferred worker must serve the same story the eager compile serves');
    assert.deepEqual(driver.story.pendingWorkers().filter((id) => id !== workerIds[1]).sort(),
      workerIds.filter((id) => id !== workerIds[1]),
      'the first read must drain only the worker it read');
    // A whole-state read drains the rest and equals the eager compile exactly.
    assert.deepEqual(driver.story.snapshot(), reference.snapshot(),
      'the drained state must equal the eager compile');
    assert.equal(driver.story.pendingWorkers().length, 0);
  } finally {
    await driver.closeAsync();
  }

  // The chunked warm: enough events to span registry chunks. The loop-freedom discriminator
  // here is a 1 ms heartbeat — a warm that folded WITHOUT chunk yields would be one
  // synchronous stretch no timer could ever fire inside; the chunked drain's awaits let it.
  const warmRoot = fixtureRoot(t, 'story-warm');
  const warmRepo = repository(t, warmRoot);
  const warmLogDir = join(warmRoot, 'log');
  seedWorkers(warmLogDir, 4, LIMIT.value); // 4 × 4 096 events = 4 chunks at the declared bound
  const warmLog = new Log(warmLogDir, () => new Date().toISOString());
  const warmDriver = createDriver({
    repoRoot: warmRepo,
    repoId: 'repo-issue351c-story-warm',
    logDir: warmLogDir,
    adapters: { codex: adapterInProcess() },
    stopDeadlineMs: 2_000,
  });
  try {
    const beats = { fired: 0 };
    const timer = setInterval(() => { beats.fired += 1; }, 1);
    timer.unref();
    await warmDriver.story.drainPendingAsync();
    clearInterval(timer);
    const reference = new StoryCompiler({});
    for (const id of warmLog.workers().sort()) for (const event of warmLog.read(id)) reference.ingest(event);
    assert.deepEqual(warmDriver.story.snapshot(), reference.snapshot());
    assert.equal(warmDriver.story.pendingWorkers().length, 0);
    assert.ok(beats.fired >= 1, `the chunked warm starved a 1ms heartbeat (${beats.fired} beats) — it never yielded`);
  } finally {
    await warmDriver.closeAsync();
  }
});

test('OL-e: SIGTERM during the open is admitted — the stop row lands, the stop converges, no lease is left', async (t) => {
  const fixture = serveFixture(t, 'sigterm-open', { rows: LIMIT.value * 20, openDelayMs: 2_500 });
  // The child is inside its open window (the factory holds before the open).
  await sleep(750);
  assert.equal(fixture.state.exited, null, `the child exited before the signal: ${JSON.stringify(fixture.state.exited)}`);
  fixture.child.kill('SIGTERM');
  const deadline = Date.now() + 30_000;
  while (fixture.state.exited === null && Date.now() < deadline) await sleep(50);
  assert.notEqual(fixture.state.exited, null, 'the child never exited after SIGTERM during the open');
  assert.equal(fixture.state.exited.signal, null,
    `the child died by default disposition (${JSON.stringify(fixture.state.exited)}) — the signal was never admitted`);
  assert.equal(fixture.state.exited.code, 0, `the admitted stop must converge cleanly: ${JSON.stringify(fixture.state.exited)}`);
  const rows = readFileSync(fixture.ledgerPath, 'utf8').split('\n').filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
    .filter((row) => row.kind === 'driver.recorded' && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
  const kinds = rows.map((row) => row.payload.kind);
  assert.ok(kinds.includes('host.stop_requested'), `no host.stop_requested row landed: ${kinds.join(',')}`);
  const requested = rows.find((row) => row.payload.kind === 'host.stop_requested');
  assert.equal(requested.payload.trigger, 'SIGTERM', `the row must name the trigger: ${JSON.stringify(requested.payload)}`);
  assert.ok(kinds.includes('host.stopped'), `no host.stopped row landed: ${kinds.join(',')}`);
  assert.equal(existsSync(fixture.leasePath), false, 'a converged stop must release the writer lease');
});
