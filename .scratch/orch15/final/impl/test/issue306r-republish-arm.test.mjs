// Issue #306r — the crash table's RE-PUBLISH arm (docs/48-reincarnation-in-place.md §11 item 7).
//
// THE FACT this file is written against: the handoff's publication wait used to end in the old
// incarnation WITHDRAWING its own publication and exiting (`residentState: reconciliation_required`)
// whenever the successor stopped short of publishing — so the deployment was left with no publisher
// until an operator restarted something. The window below closes exactly that: a successor that
// dies (or stalls past the bound) between its readiness marker and its publication is named with
// the durable row, and the OLD incarnation re-takes the writer authority and goes on serving.
//
// The fixture is the issue306a one: a real temporary repository and an INJECTED successor
// (`advanced.resident.spawnSuccessor`) — a child-shaped stub the test drives; the deployment never
// spawns a second resident in these rows. The window's own bound is the fixture's
// `advanced.resident.reincarnationWaitMs`, shrunk to the test's scale.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { deriveWakeFrame, wakeClassFor } from '../src/wake-stream.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const WAIT_MS = 1_200;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, { timeoutMs = 8_000, label = 'condition' } = {}) {
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
  const root = mkdtempSync(join(tmpdir(), `bt306r-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue306r@example.invalid']);
  git(['config', 'user.name', 'Issue306r']);
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
    writerLeasePath: join(deploymentRoot, 'state', 'coordination', 'writer.lease'),
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** The exact adapter card the ordinary resident self-check requires (the issue306a fixture card). */
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue306r fixture' } });
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
      provenance: 'issue306r-republish', refreshedAt: null },
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
const selectorOf = (f) => JSON.parse(readFileSync(f.selectorPath, 'utf8'));

/** The successor the injected spawner hands back: a real child-shaped handle the test drives. It
 * writes the handoff marker (its readiness), and can die, stall, or be killed — never publishing
 * unless the row below asks it to. */
class StubSuccessor extends EventEmitter {
  static nextPid = 51_000;
  constructor(spec) {
    super();
    this.spec = spec;
    this.pid = StubSuccessor.nextPid++;
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.journal = { spawnedAt: Date.now(), killed: false };
  }
  writeMarker(state) {
    writeFileSync(this.spec.markerPath, `${JSON.stringify({
      schemaVersion: 1, incarnation: this.spec.env.BATON_INCARNATION, pid: this.pid,
      predecessor: { incarnation: this.spec.env.BATON_PREDECESSOR_INCARNATION, commit: this.spec.env.BATON_PREDECESSOR_COMMIT },
      target: { sha: this.spec.env.BATON_REINCARNATION_TARGET, ref: null },
      state, at: new Date().toISOString(),
    })}\n`);
  }
  /** Readiness: the marker the successor writes BEFORE its (lease-waiting) open. */
  becomeReady() { this.writeMarker('waiting'); this.journal.readyAt = Date.now(); }
  crash({ code = 7, tail = 'refusing: the successor could not open the state directory\n' } = {}) {
    this.stderr.emit('data', Buffer.from(tail));
    this.exitCode = code;
    this.emit('exit', code, null);
  }
  kill() {
    this.journal.killed = true;
    this.signalCode = 'SIGKILL';
    this.emit('exit', null, 'SIGKILL');
    return true;
  }
}

/** One open deployment over the fixture world, with the successor spawner injected and the handoff
 * window bound shrunk to the test's own scale. */
async function resident(t, f, { onSpawn } = {}) {
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
        reincarnationWaitMs: WAIT_MS,
        ...(onSpawn ? { spawnSuccessor: onSpawn } : {}),
      },
    },
  }, (options) => { driver = createDriver(options); return driver; });
  t.after(async () => { try { await deployment.close(); } catch { /* the row already closed it */ } });
  return { deployment, driver };
}

/** Drive one handoff to the point where the successor is ready and the old's own stop has begun.
 * The window runs on the close() the reincarnate request triggers — awaiting close() is awaiting
 * the window. */
async function handoff(t, f, { onSpawn }) {
  const spawned = [];
  const { deployment, driver } = await resident(t, f, {
    onSpawn: (spec) => { const stub = new StubSuccessor(spec); spawned.push(stub); return onSpawn(stub, spec); },
  });
  await deployment.host();
  const oldIncarnation = selectorOf(f).incarnation;
  const receipt = await deployment.reincarnate({ target: f.base });
  await until(() => spawned.length === 1, { label: 'the successor spawn' });
  return { deployment, driver, stub: spawned[0], receipt, oldIncarnation };
}

test('306r-a: a successor that dies between its marker and its publication is named, and the old keeps serving', async (t) => {
  const f = world('a');
  const { deployment, stub, oldIncarnation } = await handoff(t, f, {
    onSpawn: (child) => { child.becomeReady(); return child; },
  });

  // The successor reaches readiness (the marker the old waits on) and then dies without publishing.
  // The readiness marker is the stub's own first act (the old waits on it); the crash lands after it.
  await until(() => existsSync(stub.spec.markerPath), { label: 'the readiness marker' });
  stub.crash({ code: 9, tail: 'the successor died between its marker and its publication\n' });

  // The window ends in the named failure, and the incarnation goes on serving.
  const failed = await closeWindow(deployment, f);
  assert.ok(failed, 'the failed handoff is durable — a follower never sees silence');
  assert.equal(failed.payload.step, 'publication_handoff',
    `the failure names the publication handoff step: ${JSON.stringify(failed.payload)}`);
  assert.equal(failed.payload.cause.exit, 9);
  assert.match(failed.payload.cause.stderrTail, /died between its marker/u,
    'the cause carries the bounded stderr tail (#326)');
  assert.ok(Number.isSafeInteger(failed.payload.cause.waitedMs),
    `the row names how long the publication was waited for: ${JSON.stringify(failed.payload.cause)}`);

  // RE-PUBLISH: admission reopens, the publication is still the old incarnation's, nothing withdrew
  // it, and the writer authority is held again (the successor could publish nothing later).
  assert.equal(deployment.turnAdmissionRefusal(), null,
    `admission reopens — the re-published incarnation admits new turns: ${JSON.stringify(deployment.turnAdmissionRefusal())}`);
  assert.equal(selectorOf(f).incarnation, oldIncarnation, 'the publication is still the old incarnation\'s');
  assert.equal(hostRow(f.ledgerPath, 'host.publication_withdrawn'), null,
    'no withdrawal is recorded: the old never gave the publication up');
  assert.ok(existsSync(f.writerLeasePath),
    'the old re-took the coordination writer authority (the same lease path the open uses)');
  assert.equal(deployment.withdrawn(), false, 'the incarnation is not withdrawn');
  // #478: the row's `drained` list is always present — this incarnation hosts no fleet, so the drain
  // it ran destroyed nothing and says exactly that, never an absent field a reader has to guess at.
  assert.deepEqual(failed.payload.drained, [],
    `a drain that destroyed nothing names an empty list: ${JSON.stringify(failed.payload.drained)}`);
});

test('306r-b: a successor that stalls past the bound is named with waitedMs, killed, and the old keeps serving', async (t) => {
  const f = world('b');
  const { deployment, stub, oldIncarnation } = await handoff(t, f, {
    onSpawn: (child) => { child.becomeReady(); return child; }, // ready, then it stalls forever
  });

  const startedAt = Date.now();
  const failed = await closeWindow(deployment, f);
  const waitedMs = Date.now() - startedAt;
  assert.ok(waitedMs >= WAIT_MS - 200,
    `the window waited its declared bound before giving up: ${waitedMs}ms`);
  assert.ok(failed, 'the stalled handoff is durable');
  assert.equal(failed.payload.step, 'publication_handoff');
  assert.ok(Number.isSafeInteger(failed.payload.cause.waitedMs) && failed.payload.cause.waitedMs >= WAIT_MS - 200,
    `the row names how long the publication was waited for: ${JSON.stringify(failed.payload.cause)}`);
  assert.equal(failed.payload.cause.exit, null, 'a stalled successor left no exit code');
  assert.equal(stub.journal.killed, true, 'the successor that will never publish is killed');
  assert.equal(stub.signalCode, 'SIGKILL');

  assert.equal(deployment.turnAdmissionRefusal(), null, 'admission reopens');
  assert.equal(selectorOf(f).incarnation, oldIncarnation, 'the publication is still the old incarnation\'s');
  assert.ok(existsSync(f.writerLeasePath), 'the old holds the writer authority again');
  assert.equal(deployment.withdrawn(), false, 'the incarnation did not exit');
});

test('306r-c: a successor that reaches for the lease after the re-publish is refused, typed', async (t) => {
  const f = world('c');
  const { deployment, stub } = await handoff(t, f, {
    onSpawn: (child) => { child.becomeReady(); return child; },
  });
  await closeWindow(deployment, f);
  assert.equal(stub.journal.killed, true, 'the stalled successor was ended by the re-publish');

  // A successor-side open over the SAME deployment now meets the writer authority the old holds
  // again: the handoff declaration is consumed exactly as a real successor consumes it, and the
  // open fails typed instead of publishing over the incarnation that re-published.
  const handoffEnv = {
    BATON_PREDECESSOR_INCARNATION: stub.spec.env.BATON_PREDECESSOR_INCARNATION,
    BATON_PREDECESSOR_PID: String(process.pid),
    BATON_PREDECESSOR_COMMIT: stub.spec.env.BATON_PREDECESSOR_COMMIT,
    BATON_INCARNATION: stub.spec.env.BATON_INCARNATION,
    BATON_REINCARNATION_TARGET: stub.spec.env.BATON_REINCARNATION_TARGET,
  };
  const saved = {};
  for (const [key, value] of Object.entries(handoffEnv)) { saved[key] = process.env[key]; process.env[key] = value; }
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const late = await openBatonDeployment({
    repo: f.repo,
    advanced: {
      deploymentRoot: f.deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: {
        env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home },
        home: f.home, webDrainMs: 500, sessionTtlMs: 60_000, reincarnationWaitMs: 300,
      },
    },
  }, (options) => createDriver(options)).then(() => null, (error) => error);
  assert.ok(late, 'the late successor does not open');
  assert.equal(late.code, 'reincarnation_failed',
    `a successor that lost the lease race fails typed: ${JSON.stringify(late?.code)}`);
  assert.equal(late.detail?.step, 'lease_held_by_predecessor',
    `the successor names the lease it could not take: ${JSON.stringify(late?.detail)}`);
  // The incarnation that re-published goes on serving: its publication and admission are intact.
  assert.equal(deployment.turnAdmissionRefusal(), null, 'the old still admits turns');
  assert.ok(existsSync(f.writerLeasePath), 'the old still holds the writer authority');
});

test('306r-d: the re-publish failure wakes the incarnation_changed class', async (t) => {
  const f = world('d');
  const { deployment } = await handoff(t, f, {
    onSpawn: (child) => { child.becomeReady(); return child; },
  });
  await closeWindow(deployment, f);
  const failed = hostRow(f.ledgerPath, 'host.reincarnation_failed');
  assert.ok(failed, 'the failure row is durable');
  assert.equal(wakeClassFor(failed)?.wakeClass, 'incarnation_changed',
    'the ONE wake table maps the failure to the class a follower of the handoff already watches');
  const frame = deriveWakeFrame(failed);
  assert.ok(frame, 'a real recorded row derives a wake frame');
  assert.equal(frame.wakeClass, 'incarnation_changed');
  assert.equal(frame.seq, failed.seq, 'the frame names the row it came from');
});

/** Await the window the reincarnate request started (the old's own close) through the facts the
 * window publishes — its durable failure row and the admission it reopens — and pin the one fact
 * every failure arm of it shares: the incarnation did not exit. #470: a close() of the test's own
 * is a STOP (it would supersede the re-publish), so the window is never awaited through one. */
async function closeWindow(deployment, f) {
  const failed = await until(() => hostRow(f.ledgerPath, 'host.reincarnation_failed'), { label: 'the window\'s failure row' });
  await until(() => deployment.turnAdmissionRefusal() === null, { label: 'admission reopening after the re-publish' });
  assert.equal(deployment.withdrawn(), false, 'the incarnation kept serving');
  return failed;
}
