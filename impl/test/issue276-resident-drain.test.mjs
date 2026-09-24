// Issue #276 (1)(2)(3) — the `baton serve` process honours a signal: one line at receipt naming
// what it will do, the drain's progress, the drain's own named wait at its deadline, an exit that
// is 0 exactly when the drain converged, and a withdrawn publication on EVERY exit path
// (including the non-converging one). Every test here drives a real `baton serve` child against a
// real deployment (`openBaton`, the MockAdapter fixture) — the process is the unit under test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const DEPLOYMENT_URL = new URL('../src/application-deployment.mjs', import.meta.url).href;
const ROUTE = '{ harness: \'codex\', model: \'gpt-5.6-sol\', effort: \'high\' }';

// The resident protocol bounds a socket path to sun_path (103 bytes), and the suite root on this
// host is deep — resident fixtures live under a short top-level root.
function fixtureRoot(t, label) {
  const root = mkdtempSync(join(tmpdir(), `bt276-${label}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function repository(t, root) {
  const repo = join(root, 'repo');
  mkdirSync(repo, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'bt276@example.invalid']);
  git(['config', 'user.name', 'BT276']);
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
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue276 fixture' } });
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
      provenance: 'issue276-resident-drain', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
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
  writeFileSync(modulePath, body({ advanced, home, configRoot, deploymentRoot }));
  return { root, repo, home, configRoot, deploymentRoot, modulePath, env };
}

/** Start `baton serve <module>` as a real child; collect stderr; expose the published coordinates. */
function startServe(t, fixture, { readyMarker } = {}) {
  const selectorPath = join(fixture.repo, '.git', 'baton', 'connection.json');
  // Issue #471: the ONE fixture-resident spawn — the child is declared THIS runner's (so a runner
  // killed without running handlers leaves no resident behind) and is ended by process group at
  // the test's after-hook.
  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', fixture.modulePath],
    cwd: fixture.repo,
    env: { ...process.env, HOME: fixture.home, XDG_CONFIG_HOME: fixture.configRoot },
  });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  return {
    child, state, selectorPath,
    async untilReady(timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      const marker = readyMarker ?? '"state":"published"';
      while (Date.now() < deadline) {
        if (state.exited !== null) break;
        if (existsSync(selectorPath) && state.stderr.includes(marker)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`serve child never became ready (exit=${JSON.stringify(state.exited)}): ${state.stderr.slice(-2_000)}`);
    },
    /** The published coordinates a later client would follow — read from disk, never from memory. */
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
    async signal(signal = 'SIGTERM', timeoutMs = 30_000) {
      const published = this.published();
      const signalAt = Date.now();
      child.kill(signal);
      const deadline = signalAt + timeoutMs;
      while (Date.now() < deadline && state.exited === null) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return { published, exit: state.exited, stderr: state.stderr, msAfterSignal: Date.now() - signalAt };
    },
  };
}

function lineIndex(stderr, needle) {
  const index = stderr.split('\n').findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `stderr never named "${needle}":\n${stderr.slice(-2_000)}`);
  return index;
}

test('RD1: an idle host names its drain at signal receipt, logs it, exits 0, and leaves nothing published', async (t) => {
  const fixture = serveFixture(t, 'idle', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = () => openBaton({ repo: process.cwd(), advanced: {${advanced}} });
`);
  const serve = startServe(t, fixture);
  await serve.untilReady();

  const { exit, stderr, published, msAfterSignal } = await serve.signal('SIGTERM');

  assert.deepEqual(exit, { code: 0, signal: null },
    `a converged drain exits 0 (the operator must never SIGKILL a settled resident): ${stderr.slice(-2_000)}`);
  // #276(2): an idle host exits as soon as the drain converges — the drain's own grace
  // (webDrainMs below) plus this host's settled work, never a second host-invented deadline.
  assert.ok(msAfterSignal < 15_000, `an idle host must not linger (exited after ${msAfterSignal}ms)`);
  // #276(1): one line at receipt, naming what the host will do — before any drain work.
  assert.match(stderr, /signal received; nothing to drain \(SIGTERM\)/u);
  const receipt = lineIndex(stderr, 'signal received; nothing to drain');
  assert.ok(receipt < lineIndex(stderr, 'web admission closed'),
    'the receipt line is written at signal receipt, before the drain it describes');
  // #276(1): the drain's progress and its outcome are logged.
  assert.match(stderr, /baton serve: drain converged; 0 of 0 participant\(s\) stopped/u);
  // #276(3): the publication is withdrawn by the exit path — nothing points at the exited process.
  assert.equal(existsSync(serve.selectorPath), false, 'the selector must not survive the resident');
  assert.equal(existsSync(published.profilePath), false, 'the private profile must not survive the resident');
  assert.equal(existsSync(published.tokenPath), false, 'the private token must not survive the resident');
  assert.equal(existsSync(published.socketPath), false, 'the socket must not survive the resident');
});

test('RD2: a hosted participant is counted at receipt, stopped by the drain, and its publication withdrawn', async (t) => {
  const fixture = serveFixture(t, 'participant', ({ advanced }) => `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = async () => {
  const deployment = await openBaton({ repo: process.cwd(), advanced: {${advanced}} });
  const host = deployment.host.bind(deployment);
  return {
    runs: deployment.runs,
    async host(...args) {
      const hosted = await host(...args);
      const swarm = await deployment.swarms.create('issue276 swarm');
      await swarm.recruit('holder', 'HOLD_UNTIL_INTERRUPT; stay available', { exact: ROUTE, resultIntent: 'read_only_evidence' });
      for (;;) {
        const view = await swarm.view();
        if (['working', 'paused'].includes(view.participants[0]?.runtime?.turn)) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      process.stderr.write('issue276: participant hosted\\n');
      return hosted;
    },
    close: () => deployment.close(),
  };
};
`);
  const serve = startServe(t, fixture, { readyMarker: 'issue276: participant hosted' });
  await serve.untilReady();

  const { exit, stderr, published } = await serve.signal('SIGTERM');

  assert.deepEqual(exit, { code: 0, signal: null }, stderr.slice(-2_000));
  // #276(1): the count is the participants this process owns, read before the drain starts.
  assert.match(stderr, /signal received; draining 1 participants \(SIGTERM\)/u);
  assert.match(stderr, /baton serve: drain converged; 1 of 1 participant\(s\) stopped/u);
  assert.equal(existsSync(serve.selectorPath), false);
  assert.equal(existsSync(published.tokenPath), false);
  assert.equal(existsSync(published.socketPath), false);
});

test('RD3: a drain that cannot converge names its wait, exits non-zero, and still withdraws the publication', async (t) => {
  // The drain's deadline is the coordinator's own `drainPolicy` (the deployment's existing
  // derivation, 90s by default); this fixture configures the SAME option to a short bound so a
  // genuinely non-converging drain (an authority operation that never settles) is observable.
  const fixture = serveFixture(t, 'stalled', ({ advanced }) => `
import { MockAdapter, createDriver } from ${JSON.stringify(INDEX_URL)};
import { openBatonDeployment } from ${JSON.stringify(DEPLOYMENT_URL)};
const ROUTE = Object.freeze(${ROUTE});
${ADAPTER}
export const createBatonDeployment = async () => {
  let driver = null;
  const deployment = await openBatonDeployment({ repo: process.cwd(), advanced: {${advanced}} },
    (options) => { driver = createDriver({ ...options, drainPolicy: { maxWorkers: 64, timeoutMs: 400, pollMs: 10 } }); return driver; });
  const host = deployment.host.bind(deployment);
  return {
    runs: deployment.runs,
    async host(...args) {
      const hosted = await host(...args);
      // A fixture condition, not a shortcut: an authority operation that never settles is one of
      // the drain's own non-convergence classes (coordinator.mjs _performDrain), so the deadline
      // path is exercised against the real coordinator.
      driver.coordinator._acquireAuthorityOp();
      process.stderr.write('issue276: authority operation held\\n');
      return hosted;
    },
    close: () => deployment.close(),
  };
};
`);
  const serve = startServe(t, fixture, { readyMarker: 'issue276: authority operation held' });
  await serve.untilReady();
  const signalAt = Date.now();

  const { exit, stderr, published } = await serve.signal('SIGTERM');

  assert.notEqual(exit, null, 'a drain that hit its deadline must not linger');
  assert.notEqual(exit.code, 0, `a non-converging drain exits non-zero: ${stderr.slice(-2_000)}`);
  assert.match(stderr, /signal received; nothing to drain \(SIGTERM\)/u);
  // #276(1)(2): the drain's deadline names what it waited on, before the host stops waiting.
  assert.match(stderr, /baton serve: drain did not converge; reason authority_operations_in_flight, count 1/u);
  assert.match(stderr, /application_host_shutdown_failed/u);
  // #276(2): the exit is the drain's own deadline, not a second host-invented wait.
  assert.ok(Date.now() - signalAt < 20_000, 'the non-converging exit happens at the drain deadline');
  // #276(3): "the host's exit path (including the non-converging one) withdraws it too".
  assert.equal(existsSync(serve.selectorPath), false,
    'a drain that did not converge may not leave a selector pointing at an exiting process');
  assert.equal(existsSync(published.profilePath), false);
  assert.equal(existsSync(published.tokenPath), false);
  assert.equal(existsSync(published.socketPath), false);
});

test('RD4: the drain’s own named wait (detail.waitingOn) is the line the host logs before it exits', async (t) => {
  // The one shape #277's drain throws on its deadline — reproduced exactly, because this test is
  // about the HOST consuming it: `code`, `detail.reason`, `detail.waitingOn`, `detail.timeoutMs`.
  const fixture = serveFixture(t, 'namedwait', () => `
export const createBatonDeployment = async () => {
  // A real deployment holds its listener; this fixture holds the loop explicitly so the host
  // survives to receive the signal (a bare await with no handle would let Node exit first).
  const hold = setInterval(() => {}, 60_000);
  return {
    async host() { return { schemaVersion: 1, state: 'published' }; },
    async close() {
      clearInterval(hold);
      throw Object.assign(new Error('fleet drain did not converge before its deployment deadline'), {
        code: 'coordinator_drain_incomplete',
        detail: {
          reason: 'deadline', stage: 'convergence', timeoutMs: 90_000,
          waitingOn: [{ workerId: 'w-1', status: 'stopping', disposition: null, processState: 'running',
            waiting: ['local_resources:worktree', 'process:running'] }],
        },
      });
    },
  };
};
`);
  const serve = startServe(t, fixture);
  // No deployment publication here: the fixture publishes nothing, so readiness is "the child is up".
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && serve.state.exited === null
    && !serve.state.stderr.includes('"state":"published"')) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const { exit, stderr } = await serve.signal('SIGTERM');

  assert.notEqual(exit, null, 'the host exits at the drain deadline');
  assert.notEqual(exit.code, 0);
  assert.match(stderr, /signal received; draining participants \(count unavailable: application_host_narration_unavailable\) \(SIGTERM\)/u,
    'a deployment that publishes no run list is named — never a fabricated count');
  assert.match(stderr, /baton serve: exit non-zero; application_host_shutdown_failed — drain did not converge: waiting on w-1 \(local_resources:worktree\+process:running\), reason deadline, deadline 90000ms/u,
    'the exit names what the host could not drain, before the process stops');
  assert.match(stderr, /"waitingOn":\[\{"workerId":"w-1"/u,
    'the exit refusal carries the drain’s own named wait onward');
});
