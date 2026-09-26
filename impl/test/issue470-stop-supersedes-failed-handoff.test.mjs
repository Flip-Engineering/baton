// Issue #470 — close() means close, also inside a reincarnation handoff window.
//
// THE FACT this file is written against: since #306r the reincarnate request schedules the old
// incarnation's OWN close() (the publication handoff window), and every other caller of close()
// that arrives while that close is in flight — an operator's stop, a SIGTERM's shutdown(), a
// fixture's t.after — joined the same promise. When the successor never published, the window
// re-published (writer authority re-taken, admission reopened) and resolved
// `{state: 'serving', resident: {handoff: 'publication_failed'}}` for EVERY joined caller: the
// operator's stop was swallowed, the Unix socket listener stayed open and the process never exited
// (issue462-handoff-env-scoped row 462-E: six green rows, exit 124 at the 300 s bound).
//
// Rows:
//   470-a — a close() asked for during the window of a handoff that FAILS is a stop: it resolves
//           closed (never 'serving'), the durable failure row precedes the stop's own `host.stopped`,
//           the socket is withdrawn and no listener handle of the deployment survives;
//   470-b — the handoff's own scheduled close, with no stop asked for, still ends in the
//           re-publish (#306r's arm is untouched): admission reopens and the incarnation serves;
//   470-c — (#478) a close() asked for AFTER that re-publish is an ORDINARY stop: it converges,
//           mints its own `host.stopped` behind the handoff's failure row, and withdraws the
//           incarnation. The incident's SIGTERM was admitted and never reached this row.
//
// The fixture is the issue306r one: a real temporary repository and an INJECTED successor stub that
// becomes ready and then stalls past the (shrunk) bound.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const WAIT_MS = 600;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, { timeoutMs = 10_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

/** docs/42 §8: an await that outlives its declared bound fails the row naming the wait it abandoned
 * rather than leaving a promise hanging over every row after it. */
function bounded(promise, ms, label) {
  return Promise.race([
    promise,
    sleep(ms).then(() => {
      throw Object.assign(new Error(`fixture_wait_unsettled: ${label} never settled within ${ms}ms`),
        { code: 'fixture_wait_unsettled' });
    }),
  ]);
}

const roots = [];
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt470-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue470@example.invalid', GIT_COMMITTER_EMAIL: 'issue470@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue470', GIT_COMMITTER_NAME: 'Issue470' });
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
  return {
    root, repo, home, configRoot, deploymentRoot, base,
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    writerLeasePath: join(deploymentRoot, 'state', 'coordination', 'writer.lease'),
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue470 fixture' } });
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
      provenance: 'issue470', refreshedAt: null },
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
const selectorOf = (f) => (existsSync(f.selectorPath) ? JSON.parse(readFileSync(f.selectorPath, 'utf8')) : null);

/** The successor stub: writes its readiness marker, then stalls; a kill ends it as SIGKILL would. */
class StubSuccessor extends EventEmitter {
  static nextPid = 47_000;
  constructor(spec) {
    super();
    this.spec = spec;
    this.pid = StubSuccessor.nextPid++;
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.killed = false;
  }
  becomeReady() {
    writeFileSync(this.spec.markerPath, `${JSON.stringify({
      schemaVersion: 1, incarnation: this.spec.env.BATON_INCARNATION, pid: this.pid,
      predecessor: { incarnation: this.spec.env.BATON_PREDECESSOR_INCARNATION, commit: this.spec.env.BATON_PREDECESSOR_COMMIT },
      target: { sha: this.spec.env.BATON_REINCARNATION_TARGET, ref: null },
      state: 'waiting', at: new Date().toISOString(),
    })}\n`);
  }
  kill() {
    this.killed = true;
    this.signalCode = 'SIGKILL';
    this.emit('exit', null, 'SIGKILL');
    return true;
  }
}

async function resident(t, f) {
  const spawned = [];
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
        spawnSuccessor: (spec) => { const stub = new StubSuccessor(spec); stub.becomeReady(); spawned.push(stub); return stub; },
      },
    },
  }, (options) => createDriver(options));
  // The fixture's own after-hook is the ONE close the row under test relies on — exactly the
  // shape that leaked the listener (462-E): no second close is issued here on purpose.
  t.after(async () => { try { await deployment.close(); } catch { /* the row already closed it */ } });
  await deployment.host();
  return { deployment, spawned };
}

/** The deployment's Unix-socket listeners as the process itself sees them — the handle that kept
 * the process alive in 462-E. */
const socketListeners = () => process._getActiveHandles()
  .filter((handle) => handle?.constructor?.name === 'Server')
  .map((handle) => { try { return handle.address(); } catch { return null; } })
  .filter((address) => typeof address === 'string' && address.endsWith('.sock'));

test('470-a: a close() asked for during the window of a handoff that fails is a stop — closed, withdrawn, no listener left', async (t) => {
  const f = world('a');
  const { deployment, spawned } = await resident(t, f);
  const listeners = socketListeners();
  assert.equal(listeners.length, 1, `the deployment listens on one socket: ${JSON.stringify(listeners)}`);
  const socketPath = listeners[0];

  await deployment.reincarnate({ target: f.base });
  await until(() => spawned.length === 1, { label: 'the successor spawn' });
  // The handoff's own close is scheduled on the next tick; the operator's stop lands inside it.
  await sleep(20);
  const closed = await deployment.close();

  assert.notEqual(closed?.state, 'serving',
    `close() means close: the operator's stop is never answered with the re-publish verdict: ${JSON.stringify(closed)}`);
  assert.ok(closed?.state === 'closed' || closed?.state === 'closed_degraded', JSON.stringify(closed));
  const failed = hostRow(f.ledgerPath, 'host.reincarnation_failed');
  assert.ok(failed, 'the failed handoff is still durable');
  assert.equal(failed.payload.step, 'publication_handoff');
  assert.equal(spawned[0].killed, true, 'the stalled successor was ended before the stop');
  const stopped = hostRows(f.ledgerPath).filter((row) => row.payload.kind === 'host.stopped');
  assert.ok(stopped.length >= 1, `the superseding stop minted its own host.stopped: ${JSON.stringify(hostRows(f.ledgerPath).map((row) => row.payload.kind))}`);
  assert.ok(stopped.at(-1).seq > failed.seq, 'the stop\'s outcome follows the handoff\'s failure row');
  // The listener's own close completes on the loop's next turns; what is pinned is that it ends.
  await until(() => socketListeners().length === 0, { timeoutMs: 2_000, label: 'the listener handle to close' })
    .catch(() => assert.deepEqual(socketListeners(), [], 'the deployment\'s listener is closed — nothing keeps the process alive'));
  assert.equal(existsSync(socketPath), false, `the socket is withdrawn: ${socketPath}`);
  assert.equal(deployment.withdrawn(), true, 'the incarnation is withdrawn: the stop that was asked for happened');
});

test('470-b: the handoff\'s own scheduled close, with no stop asked for, still ends in the re-publish', async (t) => {
  const f = world('b');
  const { deployment, spawned } = await resident(t, f);
  const before = selectorOf(f).incarnation;
  await deployment.reincarnate({ target: f.base });
  await until(() => spawned.length === 1, { label: 'the successor spawn' });
  // Observe the window through its durable row — never through a close() of our own.
  const failed = await until(() => hostRow(f.ledgerPath, 'host.reincarnation_failed'), { label: 'the failure row' });
  assert.equal(failed.payload.step, 'publication_handoff');
  await until(() => deployment.turnAdmissionRefusal() === null, { label: 'admission reopening' });
  assert.equal(selectorOf(f).incarnation, before, 'the publication is still this incarnation\'s');
  assert.equal(deployment.withdrawn(), false, 'the incarnation goes on serving');
  assert.ok(existsSync(f.writerLeasePath), 'the writer authority was re-taken');
  // …and the ONE close the fixture issues afterwards is an ordinary stop that ends the process's
  // reasons to live (the after-hook below).
});

// Issue #478: the OTHER stop that arrives after a handoff — not one inside the window, but the
// operator's own, asked for once the incarnation has already re-published and is serving. The
// incident's SIGTERM was admitted (`host.stop_requested`) and never converged to `host.stopped` in
// 240 s: a stop that had already minted its outcome row rejected the caller, and the operator
// killed the process by hand. After a re-publish this is an ORDINARY stop: it ends the incarnation,
// mints its own `host.stopped` after the failure row, withdraws the publication and its listener.
test('470-c: a close() after the re-publish is an ordinary stop that converges', async (t) => {
  const f = world('c');
  const { deployment, spawned } = await resident(t, f);
  await deployment.reincarnate({ target: f.base });
  await until(() => spawned.length === 1, { label: 'the successor spawn' });
  const failed = await until(() => hostRow(f.ledgerPath, 'host.reincarnation_failed'), { label: 'the failure row' });
  assert.equal(failed.payload.step, 'publication_handoff');
  // The stop the operator asks for AFTER the re-publish — the shape a SIGTERM's shutdown() takes.
  const closed = await bounded(deployment.close(), 20_000, 'the stop after the re-publish');
  assert.notEqual(closed?.state, 'serving',
    `close() means close, even after the re-publish: ${JSON.stringify(closed)}`);
  assert.ok(closed?.state === 'closed' || closed?.state === 'closed_degraded', JSON.stringify(closed));
  // …and the stop's own outcome is durable, and it follows the handoff's failure row: this is the
  // ordinary stop the operator asked for, told in order.
  const stopped = hostRows(f.ledgerPath).filter((row) => row.payload.kind === 'host.stopped');
  assert.ok(stopped.length >= 1,
    `the stop mints its outcome: ${JSON.stringify(hostRows(f.ledgerPath).map((row) => row.payload.kind))}`);
  assert.ok(stopped.at(-1).seq > failed.seq, 'the stop\'s outcome follows the handoff\'s failure row');
  assert.equal(deployment.withdrawn(), true, 'the incarnation is withdrawn');
});
