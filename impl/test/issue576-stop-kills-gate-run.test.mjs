// Issue #576 — a stopping resident did not exit while an integrate gate's test runner was alive;
// the operator had to kill the runner by hand before the redeploy could start.
//
// The hole this file pins: production wires the landing's out-of-process steps through the
// COORDINATOR's supervised pool (`coordinator.supervisedProcesses()` — runtime-admission builds
// `coordinator._supervised` and the real coordinator exposes it), and `SwarmRuntime._supervisedPool`
// prefers exactly that pool. `SwarmRuntime.close()` — the first act of every resident stop
// (application `_shutdownAuthorized` calls it before anything else) — killed only the runtime's OWN
// `_gatePool`, which a coordinator-wired runtime never creates. On a resident, the close that runs
// first therefore killed nothing: the in-flight gate run's fate waited on `closeAuthority`'s
// `killAll` behind every drain stage, and a stop that ended without reaching it (a bounded stop, a
// crash) left the detached group leader burning the host as an orphan nobody tracked.
//
// Every row runs on a REAL temporary repository with a REAL lane branch, an accepted contribution,
// and the deployment's default landing steps (the same seam issue459's rows measure). The gate
// runner sleeps 60 s, so "the runner is still alive" is never ambiguous.
//
//   (a) production wiring — the coordinator exposes the pool the landing ran through: `close()`
//       kills THAT pool's children, proves each process group dead (ESRCH, never a timer's hope),
//       and the landing settles as a typed refusal with its durable failure row;
//   (b) a bare runtime that owns its own pool keeps the #459 behavior: `close()` kills it too.
//
// Red-before: at HEAD (a) leaves the runner alive across `close()` — the group probe still answers
// alive after the close settles — because close() never touched the wired pool.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { KILL_ESCALATION_GRACE_MS, processGroupAlive } from '../src/process-lifecycle.mjs';

const principal = { actor: 'direct:issue576-root', principalId: 'issue576-root', sessionId: 'issue576-root' };
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

/** The gate runner a landing invokes: it sleeps far longer than any bound this file waits under,
 * so a runner still on its sleep is an alive runner, and the verdict it would have written never
 * exists while the row under test is deciding. */
function runnerSource() {
  return "await new Promise((resolve) => setTimeout(resolve, 60_000));\n"
    + 'const verdictPath = process.env.BATON_SUITE_VERDICT_FILE;\n'
    + "writeFileSync(verdictPath, JSON.stringify({ green: true, passed: 3, unexpected: [], expectedRed: 0 }));\n";
}

const contractBody = ({ subject, sha, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'stop-kills-gate-run', status: 'delivered', change: 'A stop kills the landing gate run',
    files: ['impl/src/coordinator.mjs'], test: 'node --test test/issue576-stop-kills-gate-run.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/**
 * The 459 world with the one wiring fact #576 turns on: `withWiredPool` decides whether the
 * coordinator exposes `supervisedProcesses()` — the production accessor the real coordinator
 * serves — or nothing, so the runtime falls back to a pool of its own.
 */
async function world(t, { withWiredPool = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue576-'));
  const repo = join(directory, 'repo');
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
  git(repo, 'config', 'user.name', 'Issue 576');
  git(repo, 'config', 'user.email', 'issue576@example.invalid');
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  for (const script of REGENERATORS) {
    write(repo, script, regeneratorSource(`${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`));
  }
  write(repo, 'impl/scripts/run-suite.mjs', runnerSource());
  write(repo, 'impl/package.json', '{"name":"fixture-app","private":true}\n');
  write(repo, 'impl/node_modules/fixture-dep/package.json',
    '{"name":"fixture-dep","version":"1.0.0","type":"module","exports":"./index.js"}\n');
  write(repo, 'impl/node_modules/fixture-dep/index.js', 'export const fixtureMarker = "installed";\n');
  write(repo, 'impl/src/coordinator.mjs', 'export const lane = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/coordinator.mjs', 'export const lane = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane work (#576)');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const store = new CoordinationStore(join(directory, 'ledger'));
  const G = 1024 ** 3;
  const hostCapacity = new HostCapacityAuthority({
    root: capacityRoot, residentId: 'issue576-resident', pollMs: 10,
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 0 }),
  });
  // The wired pool: what a resident's coordinator serves through `supervisedProcesses()`. The row
  // holds it from OUTSIDE the runtime so the assertions read the same object the landing used.
  const { SupervisedProcesses } = await import('../src/coordinator.mjs');
  const wiredPool = new SupervisedProcesses();
  const coordinator = withWiredPool
    ? { list: () => [], supervisedProcesses: () => wiredPool }
    : { list: () => [] };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    hostCapacity,
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: { repoRoot: repo, publishRemote },
  });
  t.after(() => {
    wiredPool.killAll();
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the lane (#576)', idempotencyKey: 'i576:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i576:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'A stop kills the landing gate run', sha: tip,
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integration = (key) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: key,
  }, principal);
  const driverRows = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts }));
  const failureRows = () => driverRows('swarm.integration_failed');

  /** The pool the landing's out-of-process steps actually ran through, read the way #576 reads
   * it: the wired pool when the coordinator serves one, else the runtime's own (created by the
   * landing itself on a bare host). */
  const landingPool = () => {
    if (withWiredPool) return wiredPool;
    return runtime._gatePool;
  };

  return {
    directory, repo, store, runtime, wiredPool, hostCapacity, integration, failureRows,
    landingPool, markerNeeded: null,
  };
}

/** Poll `probe` every 20 ms until truthy or the bound is spent. */
async function observe(probe, boundMs = 5_000) {
  const deadline = Date.now() + boundMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ── (a) production wiring: the resident's stop kills the pool the landing ran through ────────────

test('576a: close() kills the coordinator-wired pool the landing ran through and proves the group dead', needsGit, async (t) => {
  const w = await world(t, { withWiredPool: true });
  const landing = w.integration('i576:integrate');

  // The landing reached its gate run: a supervised child is live in the WIRED pool, and its
  // process group is a real detached group on this host.
  const started = await observe(() => (w.wiredPool._live.size > 0
    ? [...w.wiredPool._live.values()][0] : null));
  assert.ok(started, 'the landing reached its gate run: a supervised child is live in the wired pool');
  assert.equal(processGroupAlive(started.pid), true,
    'the runner holds a real process group while the landing is in flight');

  await assert.doesNotReject(
    Promise.race([
      w.runtime.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close() did not settle')), 30_000)),
    ]),
    'the runtime close settles',
  );

  assert.equal(processGroupAlive(started.pid), false,
    'the gate runner process group is DEAD after the close — never an orphan the operator kills by hand');
  assert.equal(w.wiredPool._live.size, 0, 'the wired pool holds no child after the close');

  // The landing the stop interrupted settles on its own chain: a typed refusal for the caller,
  // and the durable failure row a caller that is gone still reads.
  const error = await landing.then(() => null, (thrown) => thrown);
  assert.ok(error, 'the interrupted landing refuses');
  assert.equal(error.code, 'integrate_gates_red',
    'the refusal is the gate code (a killed runner never judged green)');
  const failure = await observe(() => w.failureRows()[0] ?? null);
  assert.ok(failure, 'the landing left its durable failure row');
  assert.equal(failure.code, 'integrate_gates_red');
});

// ── (b) a bare runtime keeps the #459 behavior: its own pool dies with the close too ─────────────

test('576b: close() kills a bare runtime own pool and proves the group dead', needsGit, async (t) => {
  const w = await world(t, { withWiredPool: false });
  const landing = w.integration('i576:integrate-bare');

  const started = await observe(() => {
    const pool = w.landingPool();
    return pool && pool._live.size > 0 ? [...pool._live.values()][0] : null;
  });
  assert.ok(started, 'the landing reached its gate run in the runtime own pool');

  await assert.doesNotReject(
    Promise.race([
      w.runtime.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close() did not settle')), 30_000)),
    ]),
    'the runtime close settles',
  );

  assert.equal(processGroupAlive(started.pid), false,
    'the gate runner process group is DEAD after the close');
  assert.equal(w.landingPool()._live.size, 0, 'the runtime own pool holds no child');

  const error = await landing.then(() => null, (thrown) => thrown);
  assert.ok(error, 'the interrupted landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
});
