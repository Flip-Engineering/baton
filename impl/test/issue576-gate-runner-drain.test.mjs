// Issue #576 — a stopping resident held by its integrate gate runners. The 2026-09-23 incident:
// the resident received SIGTERM at 22:30:54, drained, and logged `closed_degraded` at 22:35:25 —
// then stayed alive over six minutes, held by two children (pids 52703/52704): the test runner of
// the integrate gate for contribution f87d905b, started AFTER the stop was requested. It exited
// only when the root killed the runner by hand.
//
// The contract pinned here:
//   (a) the stop cancels the in-flight gate run: the child dies, the landing refuses
//       `integrate_landing_abandoned`, and the DURABLE failure row carries that code — the
//       abandoned attempt the lead retries, never a gate verdict;
//   (b) no new gate starts after the stop: a fenced pool resolves `fenced` without spawning,
//       and a landing asked for after close refuses `swarm_runtime_closed`;
//   (c) the drain itself cancels and REAPS the pool: `drainAndClose` waits for every child's
//       close, so `closed` means no gate runner still burns the host;
//   (d) a gate run still QUEUED for its host verify lease aborts on the fence and withdraws
//       its queue row — a cancelled gate never hangs its resident behind the queue.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { SupervisedProcesses } from '../src/coordinator.mjs';
import { createDriver, MockAdapter } from '../src/index.mjs';

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

/** The runner a landing's gate run invokes: sleeps the row's span (far longer than the row's
 * own life), then writes its finished-marker and a green verdict. A cancelled run is read from
 * the marker's ABSENCE — the runner never got to finish. */
function runnerSource({ sleepMs, markerPath }) {
  return "import { writeFileSync } from 'node:fs';\n"
    + `await new Promise((resolve) => setTimeout(resolve, ${sleepMs}));\n`
    + `writeFileSync(${JSON.stringify(markerPath)}, 'finished\\n');\n`
    + 'const verdictPath = process.env.BATON_SUITE_VERDICT_FILE;\n'
    + 'writeFileSync(verdictPath, JSON.stringify({ green: true, passed: 3, unexpected: [], expectedRed: 0 }));\n';
}

const contractBody = ({ sha, observedHead, rebasedOnto }) => ({
  subject: 'A stopping resident reaps its gate runners',
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'gate-runner-drain', status: 'delivered', change: 'Cancel and reap gate runners in the drain',
    files: ['impl/src/coordinator.mjs'], test: 'node --test test/issue576-gate-runner-drain.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/** A real repository, an accepted contribution, and a live SwarmRuntime wired the way a resident
 * wires one — the deployment's own supervised pool and a STAGED host-capacity authority with room
 * for one verdict, so the gate run's lease admission is the row's own fact, never the machine's. */
async function world(t, { gateSleepMs = 30_000 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue576-'));
  const repo = join(directory, 'repo');
  const markerPath = join(directory, 'gate-run-finished.marker');
  const capacityRoot = join(directory, 'host-capacity');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  // #605: fixture identity rides the test process environment — no test writes a repository config.
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 576', GIT_COMMITTER_NAME: 'Issue 576' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue576@example.invalid', GIT_COMMITTER_EMAIL: 'issue576@example.invalid' });
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  for (const script of REGENERATORS) {
    write(repo, script, regeneratorSource(`${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`));
  }
  write(repo, 'impl/scripts/run-suite.mjs', runnerSource({ sleepMs: gateSleepMs, markerPath }));
  write(repo, 'impl/package.json', '{"name":"fixture-app","private":true}\n');
  write(repo, 'impl/src/coordinator.mjs', 'export const lane = 1;\n');
  // A test file that imports the changed module: the landing's selection derives its gate run
  // from the checkout's own import graph, and a change with no affected test file skips the gate
  // entirely (`no_affected_tests`) — the queued-for-the-lease state row (d) pins never forms.
  write(repo, 'impl/test/coordinator.test.mjs',
    "import test from 'node:test';\nimport { lane } from '../src/coordinator.mjs';\ntest('fixture', () => { lane; });\n");
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

  // #558: the deployment DECLARES its shared remote and the landing publishes the landed ref to
  // it — a real landing without the declaration refuses integrate_publish_undeclared before the
  // gate run, so this fixture declares the bare remote a landing publishes to.
  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const store = new CoordinationStore(join(directory, 'ledger'));
  const pool = new SupervisedProcesses();
  const G = 1024 ** 3;
  const hostCapacity = new HostCapacityAuthority({
    root: capacityRoot, residentId: 'issue576-resident', pollMs: 10,
    observation: () => ({ cores: 4, totalBytes: 32 * G, freeBytes: 24 * G, load1m: 0 }),
  });
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [], supervisedProcesses: () => pool },
    hostCapacity,
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: { repoRoot: repo, publishRemote },
  });
  t.after(() => {
    runtime.close();
    pool.killAll();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'stop under a landing (#576)', idempotencyKey: 'i576:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i576:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({ sha: tip, observedHead, rebasedOnto: targetHead }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integration = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i576:integrate', ...args,
  }, principal);
  const driverRows = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts }));
  return {
    directory, repo, store, runtime, pool, hostCapacity, integration, markerPath,
    tip, targetHead, observedHead,
    startedRows: () => driverRows('swarm.integration_started'),
    failureRows: () => driverRows('swarm.integration_failed'),
  };
}

/** Poll `probe` every 20 ms until it answers truthy, or the bound is spent. */
async function observe(probe, boundMs = 5_000) {
  const deadline = Date.now() + boundMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

// ── (a) the stop cancels the in-flight gate run and records the abandoned attempt ───────────────

test('576-a: a stopping resident cancels the in-flight gate run and records integrate_landing_abandoned', needsGit, async (t) => {
  const w = await world(t);
  const landing = w.integration();
  // Wait until the gate runner child is actually alive — the run the stop must cancel.
  const live = await observe(() => (w.pool._live.size === 1 ? [...w.pool._live.values()][0] : null));
  assert.ok(live, 'the gate runner child started');
  const childPid = live.pid;

  // The stop: close fences the pool and kills the child; the settle waits the landing out.
  w.runtime.close();
  const settled = w.runtime.settleLandings();
  await assert.rejects(landing, (error) => {
    assert.equal(error.code, 'integrate_landing_abandoned',
      'the caller reads the abandonment, never a gate verdict');
    return true;
  });
  await settled;

  assert.equal(existsSync(w.markerPath), false, 'the cancelled runner never finished');
  assert.equal(pidAlive(childPid), false, 'the gate runner child is reaped, not just signalled');
  assert.equal(w.pool._live.size, 0, 'the pool holds no live run after the stop');

  const failures = w.failureRows();
  assert.equal(failures.length, 1, 'one durable failure row records the abandoned attempt');
  assert.equal(failures[0].code, 'integrate_landing_abandoned',
    'the durable row says the stop abandoned the landing, so the lead retries it');
  assert.equal(failures[0].contributionId, 'contribution:1');
  assert.equal(w.startedRows().length, 1, 'the attempt had opened before it was abandoned');
});

// ── (b) no new gate starts after the stop ───────────────────────────────────────────────────────

test('576-b: after the stop no new gate starts — a fenced run never spawns, a new landing refuses', needsGit, async (t) => {
  const w = await world(t);
  w.runtime.close();

  const marker = join(w.directory, 'post-stop-spawn.marker');
  writeFileSync(join(w.directory, 'sleeper.mjs'), `await new Promise((r) => setTimeout(r, 5_000));\n`);
  const result = await w.pool.run({
    file: join(w.directory, 'sleeper.mjs'), cwd: w.directory, label: 'integration-gate',
  });
  assert.equal(result.status, 'fenced', 'a run asked for after the fence never starts');
  assert.equal(result.fenced, true);
  assert.equal(result.pid, null, 'no child was spawned');
  assert.equal(existsSync(marker), false, 'nothing ran');

  await assert.rejects(w.integration({ idempotencyKey: 'i576:integrate-after-close' }),
    (error) => error.code === 'swarm_runtime_closed',
    'a landing asked for after the stop refuses before anything is recorded');
  assert.equal(w.failureRows().length, 0, 'no attempt was recorded for the refused landing');
});

// ── (c) the drain itself cancels and reaps the pool ─────────────────────────────────────────────

test('576-c: drainAndClose cancels and reaps a gate runner the pool still holds', needsGit, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue576-drain-'));
  const repo = join(directory, 'repo');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  // #605: fixture identity rides the test process environment — no test writes a repository config.
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 576', GIT_COMMITTER_NAME: 'Issue 576' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue576@example.invalid', GIT_COMMITTER_EMAIL: 'issue576@example.invalid' });
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');

  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-issue576', logDir: join(directory, 'log'),
    adapters: {
      mock: new MockAdapter({
        harness: 'mock', scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
      }),
    },
    stopDeadlineMs: 5_000,
  });
  const pool = driver.coordinator.supervisedProcesses();
  writeFileSync(join(directory, 'sleeper.mjs'), 'await new Promise((r) => setTimeout(r, 60_000));\n');
  const run = pool.run({ file: join(directory, 'sleeper.mjs'), cwd: directory, label: 'integration-gate' });
  const live = await observe(() => (pool._live.size === 1 ? [...pool._live.values()][0] : null));
  assert.ok(live, 'the gate runner child started');
  const childPid = live.pid;

  // The stop: the drain must cancel and REAP the child — closed means the process could exit.
  await driver.drainAndClose('issue576:test');

  const outcome = await run;
  assert.notEqual(outcome.signal, null, 'the drain killed the runner with a signal');
  assert.equal(pidAlive(childPid), false, 'the child is reaped before the drain answers');
  assert.equal(pool._live.size, 0, 'the pool is empty when the drain returns');
  assert.equal(pool.fenced, true, 'the drain dropped the fence: no new gate starts');
});

// ── (d) a gate run queued for its verify lease aborts on the fence ──────────────────────────────

test('576-d: a gate run still queued for the host verify lease aborts and withdraws its queue row', needsGit, async (t) => {
  const w = await world(t);
  // Take the staged host's one verdict slot, so the landing's gate run QUEUES for the lease.
  const held = await w.hostCapacity.acquire('verify', { holder: 'issue576-blocker' });
  assert.ok(held.token, 'the one verdict slot is held');

  const landing = w.integration({ idempotencyKey: 'i576:integrate-queued' });
  const queued = await observe(() => w.hostCapacity.observeNow().queue
    .find((entry) => entry.holder === 'integrate:s1:contribution:1') ?? null);
  assert.ok(queued, 'the gate run is queued for the verify lease when the stop lands');

  w.runtime.close();
  const settled = w.runtime.settleLandings();
  await assert.rejects(landing, (error) => {
    assert.equal(error.code, 'integrate_landing_abandoned');
    return true;
  });
  await settled;

  assert.equal(w.hostCapacity.observeNow().queue
    .some((entry) => entry.holder === 'integrate:s1:contribution:1'), false,
    'the aborted wait withdrew its queue row — a dead request never pins the queue');
  const failures = w.failureRows();
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, 'integrate_landing_abandoned');
  await w.hostCapacity.release(held.token);
});
