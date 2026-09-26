// Issue #461 — the old incarnation ENDS when the handoff does.
//
// The live evidence (2026-09-18, the primary's first reincarnation): the handoff itself worked —
// the successor published, the old withdrew, doctor and clients served the successor — but the old
// PROCESS stayed alive (4 minutes, 0 % CPU, a kqueue and pipes open, no further rows) until an
// operator SIGTERMed it; `host.reincarnated` — the row the `incarnation_changed` wake keys on —
// never landed until then.
//
// What is pinned here, on the issue306a fixture (a real temporary repository, an injected successor
// spawner — never a second real resident except where a row NEEDS a real process):
//   (a) after the successor publishes, the old incarnation's close() resolves and the old releases
//       the successor's process handle (no ProcessWrap left keeping its event loop alive) within
//       `host.reincarnation.wait_ms` with no signal — the successor process itself keeps serving;
//   (b) end to end, two real processes: the old exits 0 BY ITSELF after the withdrawal, and the
//       successor records `host.publication_withdrawn` + `host.reincarnated` when the old's process
//       is gone (never at its own poll bound);
//   (c) an incarnation that has already withdrawn answers the signal path's first read with "no
//       participants" (its coordinator is closed, its fleet is gone) and the signal path skips the
//       drain narration entirely — no second drain of a closed coordinator;
//   (d) the wait for the successor's publication is a durable `host.stop_waiting` row in the #351
//       shape, naming `successor_publication` with its reaper and its since;
//   (e) `host.successor_started` carries the successor's `argv` as spawned (so a reader can find the
//       process) and names the log its narration rides — the successor's stderr is teed into the
//       same serve log, never discarded.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { SignalLifecycleOwner, signalIntentLine } from '../src/application-host.mjs';
import { incarnationServeLogPath, openBatonDeployment } from '../src/application-deployment.mjs';
// macOS names the temp root both as /var/… and /private/var/…; the successor derives its log
// path from its real cwd, the fixture from the symlinked tmpdir — one file, one spelling.
const realpathOf = (p) => String(p).replace(/^\/private\//u, '/');

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const WAIT_MS = 4_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// The handoff variables belong to whoever SPAWNED this test process: a resident starts its
// successor with them, so a seat's own environment may carry another deployment's handoff
// declaration. A fixture opening a deployment over its OWN world must never inherit it (the open
// would adopt that incarnation and watch that predecessor), so they are cleared for this file and
// restored afterwards — and the one test that needs them sets them itself.
const HANDOFF_ENV_KEYS = Object.freeze([
  'BATON_INCARNATION', 'BATON_PREDECESSOR_INCARNATION', 'BATON_PREDECESSOR_PID',
  'BATON_PREDECESSOR_COMMIT', 'BATON_REINCARNATION_TARGET',
]);
const ambientHandoff = Object.fromEntries(HANDOFF_ENV_KEYS.map((key) => [key, process.env[key]]));
for (const key of HANDOFF_ENV_KEYS) delete process.env[key];
test.after(() => {
  for (const key of HANDOFF_ENV_KEYS) {
    if (ambientHandoff[key] === undefined) delete process.env[key]; else process.env[key] = ambientHandoff[key];
  }
});

async function until(probe, { timeoutMs = WAIT_MS, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

const roots = [];
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt461-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue461@example.invalid', GIT_COMMITTER_EMAIL: 'issue461@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue461', GIT_COMMITTER_NAME: 'Issue461' });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'landing.txt'), 'second commit\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  const landing = git(['rev-parse', 'HEAD']);
  return {
    root, repo, home, configRoot, deploymentRoot, base, landing, git,
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** The exact adapter card the ordinary resident self-check requires (the issue351 fixture card). */
function adapterSource(label) {
  return `
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: ${JSON.stringify(label)} } });
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
      provenance: 'issue461-fixture', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
`;
}
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue461 fixture' } });
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
      provenance: 'issue461-fixture', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

function ledgerRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
}
const hostRows = (file) => ledgerRows(file).filter((row) => row.kind === 'driver.recorded'
  && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
const hostRow = (file, kind) => hostRows(file).find((row) => row.payload.kind === kind) ?? null;
const hostRowsOf = (file, kind) => hostRows(file).filter((row) => row.payload.kind === kind);

/** The successor the injected stub hands back: a child-SHAPED handle the test drives in-process —
 * it writes the handoff marker (its readiness), observes the writer lease file, publishes the
 * connection. Used where a row needs a successor but no real process handle. */
class StubSuccessor extends EventEmitter {
  static nextPid = 50_000;
  constructor(spec) {
    super();
    this.spec = spec;
    this.pid = StubSuccessor.nextPid++;
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.journal = { spawnedAt: Date.now() };
  }
  writeMarker(state) {
    writeFileSync(this.spec.markerPath, `${JSON.stringify({
      schemaVersion: 1, incarnation: this.spec.env.BATON_INCARNATION, pid: this.pid,
      predecessor: { incarnation: this.spec.env.BATON_PREDECESSOR_INCARNATION, commit: this.spec.env.BATON_PREDECESSOR_COMMIT },
      target: { sha: this.spec.env.BATON_REINCARNATION_TARGET, ref: null },
      state, at: new Date().toISOString(),
    })}\n`);
  }
  becomeReady() { this.writeMarker('waiting'); this.journal.readyAt = Date.now(); }
  async openAndPublish(selector) {
    await until(() => !existsSync(this.spec.leasePath), { label: 'the writer lease release' });
    this.journal.leaseFreeAt = Date.now();
    this.writeMarker('opened');
    writeFileSync(this.spec.selectorPath, `${JSON.stringify(selector)}\n`);
    writeFileSync(this.spec.profilePath, `${JSON.stringify({
      schemaVersion: 2, transport: 'local', socketPath: join(this.spec.deploymentRoot, 'successor.sock'),
      url: 'https://baton.local', origin: 'https://baton.local', tokenFile: this.spec.tokenPath.split('/').at(-1),
      deploymentId: selector.deploymentId, incarnation: selector.incarnation,
      registryDigest: selector.registryDigest, startedAt: selector.startedAt,
      ownerPid: process.pid, ownerPidStart: 'successor',
    })}\n`);
    writeFileSync(this.spec.tokenPath, `${'a'.repeat(48)}\n`);
    this.journal.publishedAt = Date.now();
  }
  crash({ code = 7, tail = 'boom: the successor refused to start\n' } = {}) {
    this.stderr.emit('data', Buffer.from(tail));
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

/** The REAL successor process: readiness marker, the lease release, the publication — then it stays
 * alive the way a resident does. Its handle is a real OS handle, which is exactly what the old
 * incarnation has to let go of. */
const REAL_SUCCESSOR_SOURCE = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const spec = JSON.parse(process.env.B461_SPEC);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const marker = (state) => writeFileSync(spec.markerPath, JSON.stringify({
  schemaVersion: 1, incarnation: spec.incarnation, pid: process.pid, state, at: new Date().toISOString(),
}) + '\\n');
marker('waiting');
process.stderr.write('461 successor online ' + spec.incarnation + '\\n');
while (existsSync(spec.leasePath)) await sleep(10);
const current = JSON.parse(readFileSync(spec.selectorPath, 'utf8'));
marker('opened');
writeFileSync(spec.selectorPath, JSON.stringify({ ...current, incarnation: spec.incarnation, startedAt: new Date().toISOString() }) + '\\n');
writeFileSync(spec.profilePath, JSON.stringify({
  schemaVersion: 2, transport: 'local', socketPath: spec.socketPath, url: 'https://baton.local',
  origin: 'https://baton.local', tokenFile: spec.tokenPath.split('/').at(-1), deploymentId: current.deploymentId,
  incarnation: spec.incarnation, registryDigest: current.registryDigest, startedAt: new Date().toISOString(),
  ownerPid: process.pid, ownerPidStart: 'successor',
}) + '\\n');
writeFileSync(spec.tokenPath, 'a'.repeat(48) + '\\n');
setInterval(() => {}, 1000);
`;
const realChildren = [];
test.after(() => { for (const child of realChildren) { try { child.kill('SIGKILL'); } catch { /* already gone */ } } });

/** One open deployment over the fixture world, with the successor spawner injected and the handoff
 * bound shrunk to the test's own scale. */
async function resident(t, f, { onSpawn, reincarnationWaitMs = WAIT_MS } = {}) {
  let driver = null;
  const deployment = await openBatonDeployment({
    repo: f.repo,
    advanced: {
      deploymentRoot: f.deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: {
        env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home },
        home: f.home,
        webDrainMs: 500,
        sessionTtlMs: 60_000,
        reincarnationWaitMs,
        ...(onSpawn ? { spawnSuccessor: onSpawn } : {}),
      },
    },
  }, (options) => { driver = createDriver(options); return driver; });
  t.after(async () => { try { await deployment.close(); } catch { /* the row already closed it */ } });
  return { deployment, driver };
}

function spawnRealSuccessor(t, f) {
  const scriptPath = join(f.root, 'successor.mjs');
  writeFileSync(scriptPath, REAL_SUCCESSOR_SOURCE);
  const spawned = [];
  // A real successor outlives the handoff by design, so the TEST ends it — and waits for the
  // process to be gone, so a later row in this file never counts this child's handle.
  t.after(async () => {
    for (const child of spawned) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      await until(() => child.exitCode !== null || child.signalCode !== null,
        { timeoutMs: 2_000, label: 'the fixture successor to die' }).catch(() => {});
    }
  });
  return (spec) => {
    const child = spawn(process.execPath, [scriptPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        B461_SPEC: JSON.stringify({
          markerPath: spec.markerPath,
          selectorPath: spec.selectorPath,
          profilePath: spec.profilePath,
          tokenPath: spec.tokenPath,
          leasePath: spec.leasePath,
          socketPath: join(f.deploymentRoot, 'successor.sock'),
          incarnation: spec.env.BATON_INCARNATION,
        }),
      },
    });
    realChildren.push(child);
    spawned.push(child);
    return child;
  };
}

/** Capture what this process writes to stderr — the old incarnation's own serve log. */
function captureServeLog(t) {
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { lines.push(String(chunk)); return original.call(process.stderr, chunk, ...rest); };
  t.after(() => { process.stderr.write = original; });
  return () => lines.join('');
}

const selectorOf = (f) => JSON.parse(readFileSync(f.selectorPath, 'utf8'));
const successorSelector = (f, incarnation) => {
  const current = selectorOf(f);
  return { ...current, incarnation, startedAt: new Date().toISOString() };
};

test('461e: host.successor_started carries the spawn spelling and the log its narration rides', async (t) => {
  const f = world('e');
  const serveLog = captureServeLog(t);
  const { deployment } = await resident(t, f, { onSpawn: spawnRealSuccessor(t, f) });
  await deployment.host();

  const receipt = await deployment.reincarnate({ target: f.base });
  await until(() => existsSync(f.selectorPath) && selectorOf(f).incarnation === receipt.successor.incarnation,
    { label: 'the successor publication' });
  const started = await until(() => hostRow(f.ledgerPath, 'host.successor_started'), { label: 'the successor_started row' });

  // A reader finds the process by the spelling it was spawned with — never a pid lookup.
  assert.ok(Array.isArray(started.payload.argv), `host.successor_started carries the argv as spawned: ${JSON.stringify(started.payload)}`);
  assert.ok(started.payload.argv.length >= 1, JSON.stringify(started.payload.argv));
  for (const argument of started.payload.argv) assert.equal(typeof argument, 'string');
  assert.ok(started.payload.argv[0].endsWith(join('impl', 'scripts', 'baton.mjs')),
    `argv[0] is the spawn spelling: ${JSON.stringify(started.payload.argv)}`);
  // Issue #468: the row names a PATH — the successor's OWN serve log, which the successor opens
  // at open (`resident/serve.<incarnation>.log`) — never #461's `'stderr'`: that pipe has no
  // reader once this incarnation exits, and every line written into it after that was lost.
  // macOS: the successor derives its path from its real cwd (/private/var…) while the fixture
  // names the temp dir by its symlink (/var…); one file, compared by realpath (the §2.4 rule).
  assert.equal(realpathOf(started.payload.log), realpathOf(incarnationServeLogPath(f.deploymentRoot, started.payload.incarnation)),
    `the row names the log its narration rides: ${JSON.stringify(started.payload)}`);
  assert.notEqual(started.payload.log, 'stderr', 'a stream name is not a log');
  // …and during the handoff window the tee still delivers the successor's stderr here, so an
  // operator watching THIS incarnation sees the successor come up.
  const successorLog = await until(() => (serveLog().includes('461 successor online') ? serveLog() : null),
    { label: 'the successor stderr teed into the serve log' });
  assert.match(successorLog, /461 successor online instance-/u);

  await deployment.close();
});

test('461d: the wait for the successor publication is a durable host.stop_waiting row', async (t) => {
  const f = world('d');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => { stub = new StubSuccessor(spec); stub.becomeReady(); return stub; },
  });
  await deployment.host();

  const receipt = await deployment.reincarnate({ target: f.base });
  void stub.openAndPublish(successorSelector(f, receipt.successor.incarnation));
  const closed = await deployment.close();
  assert.equal(closed.state, 'closed', JSON.stringify(closed));

  const waits = hostRowsOf(f.ledgerPath, 'host.stop_waiting');
  const wait = waits.find((row) => JSON.stringify(row.payload).includes('successor_publication')) ?? null;
  assert.ok(wait, `the publication wait is a row, not only a narration tail: ${JSON.stringify(waits.map((row) => row.payload))}`);
  const entry = (wait.payload.wait?.entries ?? [])[0] ?? wait.payload;
  assert.equal(entry.resource, 'successor_publication', JSON.stringify(wait.payload));
  assert.equal(typeof entry.reaper, 'string', `the wait names its reaper: ${JSON.stringify(wait.payload)}`);
  assert.equal(typeof entry.since, 'string', `the wait names its since: ${JSON.stringify(wait.payload)}`);
});

test('461a: the old incarnation releases the successor handle once the handoff is done', async (t) => {
  const f = world('a');
  const { deployment } = await resident(t, f, { onSpawn: spawnRealSuccessor(t, f) });
  await deployment.host();
  const processWraps = () => process.getActiveResourcesInfo().filter((type) => type === 'ProcessWrap').length;
  const before = processWraps();

  const receipt = await deployment.reincarnate({ target: f.base });
  const successorChild = realChildren.at(-1);
  assert.ok(Number.isSafeInteger(successorChild.pid), 'the successor runs in a real process');
  const closedAt = Date.now();
  const closed = await deployment.close();
  assert.equal(closed.state, 'closed', `a completed handoff exits 0: ${JSON.stringify(closed)}`);
  assert.equal(selectorOf(f).incarnation, receipt.successor.incarnation, 'the successor serves the publication');
  assert.ok(Date.now() - closedAt <= WAIT_MS,
    'close() resolves within host.reincarnation.wait_ms without any signal');

  // The old has let go of the successor process handle: nothing it holds keeps its event loop
  // alive. The successor itself is STILL RUNNING — released, never stopped.
  await until(() => processWraps() <= before, { label: 'the successor process handle to be released' })
    .catch((error) => { throw new Error(`${error.message} (active resources: ${process.getActiveResourcesInfo().join(',')})`); });
  assert.equal(processWraps(), before,
    `the successor's handle is released after the handoff: ${process.getActiveResourcesInfo().join(',')}`);
  assert.equal(successorChild.exitCode, null, 'the successor process is still running after the old let go');
  assert.equal(successorChild.signalCode, null, 'the successor was never signalled');
});

test('461c: a withdrawn incarnation answers the signal path with nothing to drain', async (t) => {
  const f = world('c');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => { stub = new StubSuccessor(spec); stub.becomeReady(); return stub; },
  });
  await deployment.host();

  const receipt = await deployment.reincarnate({ target: f.base });
  void stub.openAndPublish(successorSelector(f, receipt.successor.incarnation));
  await deployment.close();

  // The incarnation's OWN state, read FIRST by the signal path: it has withdrawn — its coordinator
  // is closed and its fleet is gone, so the honest count is zero, never a refusal the operator has
  // to read through (the live incident: "count unavailable: coordinator_closed").
  assert.equal(deployment.withdrawn(), true, 'the incarnation knows it has withdrawn');
  assert.equal(deployment.ownedParticipantCount(), 0, 'a withdrawn incarnation owns no participants');
  let refused = null;
  const line = await signalIntentLine({ kind: 'SIGTERM' }, {
    read: 'coordinator.participants', run: () => deployment.ownedParticipantCount(),
  }, { onRefused: (value) => { refused = value; } });
  assert.equal(refused, null, `no refusal is recorded for a withdrawn incarnation: ${JSON.stringify(refused)}`);
  assert.match(line, /signal received; nothing to drain \(SIGTERM\)/u, line);

  // …and the signal path itself skips the drain narration when the incarnation is withdrawn.
  const emitter = new EventEmitter();
  let announced = 0;
  let shutdowns = 0;
  const owner = new SignalLifecycleOwner({
    signalEmitter: emitter,
    shutdown: async () => { shutdowns += 1; return { state: 'closed' }; },
    announce: () => { announced += 1; },
    withdrawn: () => true,
  });
  const running = owner.run(async ({ signal }) => new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', resolve, { once: true });
  }));
  emitter.emit('SIGTERM');
  const outcome = await running;
  assert.equal(announced, 0, 'a withdrawn incarnation narrates no second drain');
  assert.equal(shutdowns, 1, `the settled shutdown authority is consulted once: ${shutdowns}`);
  assert.equal(outcome.trigger.kind, 'SIGTERM');
});

/** The OLD incarnation, as a REAL process: it opens the fixture world, reincarnates onto the
 * target with a real (dumb) successor handle, prints what the test needs, and then must END BY
 * ITSELF — that exit is exactly what the successor's `host.reincarnated` observation waits on. */
function oldHarnessSource({ indexUrl, deploymentUrl }) {
  return `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { MockAdapter, createDriver } from ${JSON.stringify(indexUrl)};
import { openBatonDeployment } from ${JSON.stringify(deploymentUrl)};

const world = JSON.parse(process.env.B461_OLD_WORLD);
const ROUTE = Object.freeze(${JSON.stringify(ROUTE)});
${adapterSource('issue461 old harness')}
const deployment = await openBatonDeployment({
  repo: world.repo,
  advanced: {
    deploymentRoot: world.deploymentRoot,
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: {
      env: { XDG_CONFIG_HOME: world.configRoot, HOME: world.home },
      home: world.home,
      webDrainMs: 500,
      sessionTtlMs: 60_000,
      reincarnationWaitMs: world.waitMs,
      spawnSuccessor: (spec) => {
        // A REAL successor handle that publishes nothing on its own: the test process plays the
        // publishing successor, the readiness marker is written here, and the child exists so the
        // old holds a genuine OS handle to let go of.
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: ['ignore', 'ignore', 'pipe'] });
        writeFileSync(spec.markerPath, JSON.stringify({
          schemaVersion: 1, incarnation: spec.env.BATON_INCARNATION, pid: child.pid, state: 'waiting', at: new Date().toISOString(),
        }) + '\\n');
        process.stdout.write('B461 SUCCESSOR ' + child.pid + '\\n');
        return child;
      },
    },
  },
}, (options) => createDriver(options));
await deployment.host();
const receipt = await deployment.reincarnate({ target: world.target });
process.stdout.write('B461 RECEIPT ' + JSON.stringify({
  oldPid: process.pid, oldIncarnation: receipt.from.incarnation, target: receipt.target.sha,
  successorIncarnation: receipt.successor.incarnation,
}) + '\\n');
const closed = await deployment.close();
process.stdout.write('B461 CLOSED ' + JSON.stringify({ state: closed.state }) + '\\n');
`;
}
test('461b: the old exits by itself and the successor settles the handoff when it does', async (t) => {
  const f = world('b');
  const harnessPath = join(f.root, 'old-harness.mjs');
  writeFileSync(harnessPath, oldHarnessSource({
    indexUrl: new URL('../src/index.mjs', import.meta.url).href,
    deploymentUrl: new URL('../src/application-deployment.mjs', import.meta.url).href,
  }));
  const old = spawn(process.execPath, [harnessPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      B461_OLD_WORLD: JSON.stringify({
        repo: f.repo, home: f.home, configRoot: f.configRoot, deploymentRoot: f.deploymentRoot,
        target: f.base, waitMs: 8_000,
      }),
    },
  });
  t.after(() => { try { old.kill('SIGKILL'); } catch { /* already gone */ } });
  const harnessLines = [];
  old.stdout.setEncoding('utf8');
  old.stdout.on('data', (chunk) => { for (const line of chunk.split('\n')) if (line.length > 0) harnessLines.push(line); });
  const harnessStderr = [];
  old.stderr.setEncoding('utf8');
  old.stderr.on('data', (chunk) => { harnessStderr.push(chunk); });

  const receiptLine = await until(() => harnessLines.find((line) => line.startsWith('B461 RECEIPT ')),
    { timeoutMs: 30_000, label: 'the old harness to reincarnate' }).catch((error) => {
    throw new Error(`${error.message}\nharness out: ${harnessLines.join(' | ')}\nharness err: ${harnessStderr.join('')}`);
  });
  const receipt = JSON.parse(receiptLine.slice('B461 RECEIPT '.length));
  const successorPid = Number.parseInt(harnessLines.find((line) => line.startsWith('B461 SUCCESSOR '))?.slice('B461 SUCCESSOR '.length) ?? '', 10);
  t.after(() => { try { process.kill(successorPid, 'SIGKILL'); } catch { /* already gone */ } });

  // This process becomes the SUCCESSOR: the handoff declaration the old spawned it with, then an
  // ordinary open — which adopts the incarnation the old minted, takes the leases the old
  // released, publishes, and starts watching the predecessor's process.
  const handoffEnv = {
    BATON_PREDECESSOR_INCARNATION: receipt.oldIncarnation,
    BATON_PREDECESSOR_PID: String(receipt.oldPid),
    BATON_PREDECESSOR_COMMIT: f.landing,
    BATON_INCARNATION: receipt.successorIncarnation,
    BATON_REINCARNATION_TARGET: receipt.target,
  };
  const saved = {};
  for (const [key, value] of Object.entries(handoffEnv)) { saved[key] = process.env[key]; process.env[key] = value; }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const successor = await resident(t, f, { reincarnationWaitMs: 6_000 });
  await successor.deployment.host();
  const published = await until(() => hostRow(f.ledgerPath, 'host.successor_published'), { label: 'the successor publication row' });

  // THE FACT: the old incarnation ends by itself — exit 0, no signal, no operator.
  const exitedAt = Date.now();
  await until(() => old.exitCode !== null || old.signalCode !== null, { timeoutMs: 10_000, label: 'the old incarnation to exit on its own' });
  assert.equal(old.signalCode, null, `the old was never signalled: ${old.signalCode}`);
  assert.equal(old.exitCode, 0, `the old incarnation exits 0 by itself (harness log: ${harnessLines.join(' | ')})`);
  assert.ok(Date.now() - exitedAt <= 10_000, 'the exit lands inside the handoff bound');
  assert.ok(harnessLines.some((line) => line.startsWith('B461 CLOSED ')),
    `the old's own close completed before its exit: ${harnessLines.join(' | ')}`);
  // The old's own tail names the exit as its last stage — the #351 vocabulary, said past the
  // release, and the fact the successor's `host.reincarnated` is the other half of.
  assert.match(harnessStderr.join(''), /host\.stopped tail .*incarnation_exit \d+ms/u,
    `the old's tail ends with its exit: ${harnessStderr.join('').slice(-2_000)}`);

  // …so the successor's observation lands when the process is GONE, not at its own poll bound.
  const withdrawn = await until(() => hostRow(f.ledgerPath, 'host.publication_withdrawn'), { label: 'host.publication_withdrawn' });
  assert.equal(withdrawn.payload.incarnation, receipt.oldIncarnation, 'the withdrawal names the OLD incarnation');
  const reincarnated = await until(() => hostRow(f.ledgerPath, 'host.reincarnated'), { label: 'host.reincarnated' });
  assert.deepEqual(reincarnated.payload.from, { incarnation: receipt.oldIncarnation, commit: f.landing });
  assert.deepEqual(reincarnated.payload.to, { incarnation: receipt.successorIncarnation, commit: receipt.target });
  // The landed contract (docs/48 §11.8): the field carries the pid-liveness observation itself, so
  // FALSE is the predecessor GONE — this row's whole point. A settlement that fired at the
  // watcher's own bound instead of on the observation would carry TRUE (process still alive).
  assert.equal(reincarnated.payload.predecessorExited, false,
    `the settlement is the observation of the old's exit, never a deadline: ${JSON.stringify(reincarnated.payload)}`);
  assert.ok(Date.parse(reincarnated.ts) - Date.parse(published.ts) < 6_000,
    'the settlement precedes the watcher bound it would have expired at');
  assert.equal(selectorOf(f).incarnation, receipt.successorIncarnation, 'the successor serves the deployment');
});
