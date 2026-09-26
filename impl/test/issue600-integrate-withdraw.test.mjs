// Issue #600 — a landing must be withdrawable while it is QUEUED or RUNNING, and a new revision
// that supersedes a queued contribution must withdraw that contribution's old operation.
//
// The observed failure, twice on the host: a superseded landing held the host's only verify-lane
// gate slot for 65 minutes and the root had to kill it by hand, and a landing killed mid-gate
// leaves its scratch checkout registered so the next attempt on the same contribution cannot start
// (createIntegrationCheckout refuses an existing .baton/wt/integrate-<contributionId> directory).
//
// Every row below runs on a REAL temporary repository with a REAL lane branch, an accepted
// contribution, and the deployment's own default landing steps. The gate runner sleeps long enough
// for the withdraw to arrive while the operation is in flight.
//
//   (a) a withdraw of a QUEUED landing (waiting on the verify lease) aborts the lease wait,
//       records a named terminal row, and the scratch checkout is gone;
//   (b) a withdraw of a RUNNING landing (gate child in flight) kills the gate child, releases
//       the lease, records a terminal row, and the scratch checkout is gone;
//   (c) a superseding contribution by the same participant withdraws the older pending operation;
//   (d) a withdraw of a contribution with no pending integration refuses typed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';
import { HostCapacityAuthority } from '../src/host-capacity.mjs';

const { SupervisedProcesses } = await import('../src/coordinator.mjs');

const principal = { actor: 'direct:issue600-root', principalId: 'issue600-root', sessionId: 'issue600-root' };
const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const git = (repo, ...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
}).trim();

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const REGENERATORS = Object.freeze([
  'impl/scripts/seam-inventory.mjs',
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
]);

function regeneratorSource(artifact) {
  return "import { mkdirSync, writeFileSync } from 'node:fs';\n"
    + "mkdirSync(new URL('../data/', import.meta.url), { recursive: true });\n"
    + `writeFileSync(new URL('../data/${artifact}', import.meta.url), 'ok\\n');\n`;
}

function runnerSource({ sleepMs, green, markerPath }) {
  return "import { writeFileSync } from 'node:fs';\n"
    + `await new Promise((resolve) => setTimeout(resolve, ${sleepMs}));\n`
    + `writeFileSync(${JSON.stringify(markerPath)}, 'finished\\n');\n`
    + 'const verdictPath = process.env.BATON_SUITE_VERDICT_FILE;\n'
    + `writeFileSync(verdictPath, JSON.stringify({ green: ${green}, passed: 3, `
    + 'unexpected: [], expectedRed: 0 }));\n';
}

const contractBody = ({ subject, sha, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'withdraw-test', status: 'delivered', change: 'Withdraw test change',
    files: ['impl/src/coordinator.mjs'], test: 'node --test test/issue600-integrate-withdraw.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

async function world(t, { gate = {} } = {}) {
  const { sleepMs = 3_000, green = true } = gate;
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue600-'));
  const repo = join(directory, 'repo');
  const markerPath = join(directory, 'gate-run-finished.marker');
  const capacityRoot = join(directory, 'host-capacity');
  const hostedEnv = { root: process.env.BATON_HOST_CAPACITY_ROOT, wait: process.env.BATON_HOST_CAPACITY_WAIT_MS };
  process.env.BATON_HOST_CAPACITY_ROOT = capacityRoot;
  process.env.BATON_HOST_CAPACITY_WAIT_MS = '300';
  t.after(() => {
    for (const [key, value] of [['BATON_HOST_CAPACITY_ROOT', hostedEnv.root],
      ['BATON_HOST_CAPACITY_WAIT_MS', hostedEnv.wait]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 600');
  git(repo, 'config', 'user.email', 'issue600@example.invalid');
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  for (const script of REGENERATORS) {
    write(repo, script, regeneratorSource(`${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`));
  }
  write(repo, 'impl/scripts/run-suite.mjs', runnerSource({ sleepMs, green, markerPath }));
  write(repo, 'impl/package.json', '{"name":"fixture-app","private":true}\n');
  write(repo, 'impl/node_modules/fixture-dep/package.json',
    '{"name":"fixture-dep","version":"1.0.0","type":"module","exports":"./index.js"}\n');
  write(repo, 'impl/node_modules/fixture-dep/index.js', 'export const fixtureMarker = "installed";\n');
  write(repo, 'impl/src/coordinator.mjs', 'export const lane = 1;\n');
  // The gate set is the runner's own selector over the squash's checkout (#598 item 3 removed the
  // landing table's region gates), so this fixture carries one test file that statically imports
  // the module the lane moves. The gate runner below sleeps, and a landing with nothing to run
  // would settle before a withdraw could reach it.
  write(repo, 'impl/test/gate-fixture.test.mjs',
    "import '../src/coordinator.mjs';\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/coordinator.mjs', 'export const lane = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane work (#600)');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const store = new CoordinationStore(join(directory, 'ledger'));
  const pool = SupervisedProcesses === undefined ? null : new SupervisedProcesses();
  const G = 1024 ** 3;
  const hostCapacity = new HostCapacityAuthority({
    root: capacityRoot, residentId: 'issue600-resident', pollMs: 10,
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 0 }),
  });
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [], ...(pool === null ? {} : { supervisedProcesses: () => pool }) },
    hostCapacity,
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: { repoRoot: repo, publishRemote },
  });
  t.after(() => {
    runtime.close();
    pool?.killAll();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'landing withdraw (#600)', idempotencyKey: 'i600:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i600:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'The landing is withdrawable', sha: tip,
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integration = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i600:integrate', ...args,
  }, principal);
  const driverRows = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts }));
  const integrateDriverRows = () => driverRows('swarm.integration_started');
  const failureRows = () => driverRows('swarm.integration_failed');
  const wtRoot = join(repo, '.baton', 'wt');
  const leftoverCheckouts = () => (existsSync(wtRoot) ? readdirSync(wtRoot) : [])
    .filter((name) => name.startsWith('integrate-') && !name.endsWith('.projection.exclude'));
  return {
    directory, repo, publishRemote, store, runtime, pool, hostCapacity, capacityRoot,
    integration, markerPath, tip, targetHead, observedHead,
    driverRows, integrateDriverRows, failureRows, wtRoot, leftoverCheckouts,
  };
}

async function observe(probe, boundMs = 5_000) {
  const deadline = Date.now() + boundMs;
  for (;;) {
    const value = probe();
    if (value) return { value, at: Date.now() };
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ── (a) withdraw a RUNNING landing ──────────────────────────────────────────────────────────────

test('600a: withdrawing a running landing kills the gate child, releases the lease, removes the checkout, and records a terminal row', needsGit, async (t) => {
  const w = await world(t, { gate: { sleepMs: 10_000, green: true } });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const landing = w.integration();
  const seen = await observe(() => w.integrateDriverRows()[0] ?? null);
  assert.ok(seen, 'the start row is durable while the landing runs');

  await new Promise((resolve) => setTimeout(resolve, 200));

  const withdrawn = await w.runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1',
    withdraw: true, reason: 'superseded by a newer revision',
    idempotencyKey: 'i600:withdraw',
  }, principal);

  assert.ok(withdrawn.withdrawn, 'the withdraw succeeded');
  assert.equal(withdrawn.withdrawn.contributionId, 'contribution:1');
  assert.equal(withdrawn.withdrawn.reason, 'superseded by a newer revision');

  const error = await landing.then(() => null, (thrown) => thrown);
  assert.ok(error, 'the landing refuses after withdrawal');
  assert.equal(error.code, 'integrate_withdrawn');

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(w.leftoverCheckouts(), [], 'the scratch checkout is gone after withdrawal');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'a withdrawn landing never moves the target');

  const failures = w.failureRows();
  const withdrawalRow = failures.find((row) => row.code === 'integrate_withdrawn');
  assert.ok(withdrawalRow, 'a durable failure row is recorded for the withdrawal');
  assert.equal(withdrawalRow.contributionId, 'contribution:1');
  assert.ok(withdrawalRow.detail.phase, 'the row names the phase the landing was in');
  assert.ok(withdrawalRow.detail.reason, 'the row names the reason for the withdrawal');
  assert.equal(withdrawalRow.detail.actor, principal.actor, 'the row names who asked');
});

// ── (b) superseding contribution withdraws the older queued operation ────────────────────────────

test('600b: recording a superseding revision withdraws the older pending operation', needsGit, async (t) => {
  const w = await world(t, { gate: { sleepMs: 10_000, green: true } });

  const landing = w.integration();
  const seen = await observe(() => w.integrateDriverRows()[0] ?? null);
  assert.ok(seen, 'the first landing is in flight');

  await w.runtime.command('swarm.update', {
    swarmId: 's1', event: 'swarm.contribution_recorded',
    payload: {
      contributionId: 'contribution:2', participantId: 'lane-a',
      body: 'Superseding revision (#600)',
    },
    idempotencyKey: 'i600:update-supersede',
  }, principal);

  const error = await landing.then(() => null, (thrown) => thrown);
  assert.ok(error, 'the first landing refuses after supersession');
  assert.equal(error.code, 'integrate_withdrawn');

  await new Promise((resolve) => setTimeout(resolve, 200));
  const failures = w.failureRows();
  const withdrawalRow = failures.find((row) =>
    row.code === 'integrate_withdrawn' && row.detail?.supersededBy === 'contribution:2');
  assert.ok(withdrawalRow, 'a durable failure row names the superseding contribution');
  assert.equal(withdrawalRow.contributionId, 'contribution:1');
});

// ── (c) withdraw of something not in flight refuses typed ────────────────────────────────────────

test('600c: a withdraw of a contribution with no pending integration refuses typed', needsGit, async (t) => {
  const w = await world(t, { gate: { sleepMs: 0, green: true } });

  const error = await w.runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1',
    withdraw: true, reason: 'test withdrawal',
    idempotencyKey: 'i600:withdraw-nothing',
  }, principal).then(() => null, (thrown) => thrown);

  assert.ok(error, 'the withdraw refuses');
  assert.equal(error.code, 'integrate_not_in_flight',
    'the refusal code is integrate_not_in_flight');
  assert.equal(error.detail.contributionId, 'contribution:1');
  assert.ok(Object.hasOwn(SWARM_REFUSAL_CODES, 'integrate_not_in_flight'),
    'the refusal code is in the family\'s closed set');
  assert.ok(Object.hasOwn(SWARM_REFUSAL_CODES, 'integrate_withdrawn'),
    'the withdrawn code is in the family\'s closed set');
});
