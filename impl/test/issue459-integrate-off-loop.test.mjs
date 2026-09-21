// Issue #459 — `swarm.integrate` ran its gate set with `spawnSync` ON the resident's loop. The
// 2026-09-18 incident: a landing's gate run froze the resident for seven minutes (pid at 0% CPU,
// its only child `node impl/scripts/run-suite.mjs` beside it), every read and every seat call
// stalled behind it, the CLI's `swarm integrate … --dry-run` printed nothing and exited 124 at its
// 300 s bound with no receipt, and the scratch checkout was left behind. SIGTERM to the child
// released the resident at once — the child had been waiting on the host verify lease that the
// SAME frozen resident could not answer for.
//
// Every row below runs on a REAL temporary repository with a REAL lane branch, an accepted
// contribution, and the deployment's OWN default landing steps — the default regenerators, and a
// runner installed as `impl/scripts/run-suite.mjs` in the checkout (the same seam a deployment's
// gate run uses). Nothing is stubbed in-process, so what the rows measure is the seam itself:
//
//   (a) a served resident answers `swarm.list` while a landing's gate run is in flight — the
//       #438 no-stall guard, on the landing path;
//   (b) the start row is durable BEFORE the gate run finishes and the answer names it (with the
//       receipt's own seq), so a caller can bound its observation at the seq this attempt began at;
//   (c) a red gate lands a durable `swarm.integration_failed` carrying the unexpected rows, and the
//       scratch checkout AND its projection-exclude file are gone;
//   (d) `baton swarm integrate … --follow` returns on the outcome row;
//   (e) a leftover `integrate-*` checkout is swept when the resident opens, and the swept name is
//       recorded on the open's own row and on the next landing's start row;
//   (f) a gate run that cannot take the host verify lease refuses typed `integrate_gates_busy`
//       naming the holder it waited behind — before any child is spawned, never blocking.
//
// Red-before: written before the implementation. At HEAD (a) stalls until the gate run returns,
// (b)/(c)/(d)/(e) find no start row, no durable failure row, no follow leg and no sweep, and (f)
// has no such refusal at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';
import { wakeClassFor } from '../src/wake-stream.mjs';
import { HostCapacityAuthority } from '../src/host-capacity.mjs';
import { parseBatonCli, runBatonCli } from '../src/application-cli.mjs';

// The pool this file's deployments supervise their out-of-process steps with, read through a dynamic
// import: at HEAD the export does not exist, and a static named import would fail the whole FILE to
// link — every row must report its own red assertion instead (the #451 rule).
const { SupervisedProcesses } = await import('../src/coordinator.mjs');

const principal = { actor: 'direct:issue459-root', principalId: 'issue459-root', sessionId: 'issue459-root' };
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

// The three scripts a landing regenerates with (`INTEGRATION_REGENERATORS`). They are TRACKED on
// the base commit — the integration checkout checks them out, and the landing runs them for real.
const REGENERATORS = Object.freeze([
  'impl/scripts/seam-inventory.mjs',
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
]);

/** A regenerator that writes the artifact its own name implies. Trivial on purpose: the rows below
 * measure the SEAM (where the step runs), never the generator's work. */
function regeneratorSource(artifact) {
  return "import { mkdirSync, writeFileSync } from 'node:fs';\n"
    + "mkdirSync(new URL('../data/', import.meta.url), { recursive: true });\n"
    + `writeFileSync(new URL('../data/${artifact}', import.meta.url), 'ok\\n');\n`;
}

/** The runner a landing's gate run invokes, as the deployment's own seam invokes it: it takes the
 * sleep the row asked for, records WHEN it finished (the marker the rows date their observations
 * against), then writes the verdict document the deployment's expected-red manifest would have
 * judged — green, or red with the unexpected rows the row names. */
function runnerSource({ sleepMs, green, unexpected, markerPath }) {
  return "import { writeFileSync } from 'node:fs';\n"
    + `await new Promise((resolve) => setTimeout(resolve, ${sleepMs}));\n`
    + `writeFileSync(${JSON.stringify(markerPath)}, 'finished\\n');\n`
    + 'const verdictPath = process.env.BATON_SUITE_VERDICT_FILE;\n'
    + `writeFileSync(verdictPath, JSON.stringify({ green: ${green}, passed: 3, `
    + `unexpected: ${JSON.stringify(unexpected)}, expectedRed: 0 }));\n`;
}

const contractBody = ({ subject, sha, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items: [{
    id: 'landing-off-loop', status: 'delivered', change: 'Run the landing steps out of process',
    files: ['impl/src/coordinator.mjs'], test: 'node --test test/issue459-integrate-off-loop.test.mjs',
    evidence: 'suite green',
  }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/**
 * A real repository with a target branch, a lane branch carrying one commit that moves
 * `impl/src/coordinator.mjs` (a path the landing table classifies, so the derived gate set is
 * never empty), an accepted contribution, and a live `SwarmRuntime` wired the way a resident wires
 * one: its landing authority names the repository alone (the deployment's DEFAULT regenerators and
 * DEFAULT gate runner), and its supervised pool is the deployment's own.
 */
async function world(t, { gate = {} } = {}) {
  const {
    sleepMs = 0, green = true, unexpected = [],
  } = gate;
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue459-'));
  const repo = join(directory, 'repo');
  const markerPath = join(directory, 'gate-run-finished.marker');
  // The host lease namespace this landing admits through: a directory of its own, so no row of
  // this file ever queues in the machine's shared verdict namespace (the authority's root is the
  // one thing a deployment names by environment).
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
  git(repo, 'config', 'user.name', 'Issue 459');
  git(repo, 'config', 'user.email', 'issue459@example.invalid');
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  for (const script of REGENERATORS) {
    write(repo, script, regeneratorSource(`${script.split('/').at(-1).replace(/\.mjs$/u, '')}.json`));
  }
  write(repo, 'impl/scripts/run-suite.mjs', runnerSource({ sleepMs, green, unexpected, markerPath }));
  // The install the repository actually carries, under a sub-directory (#451): the integration
  // checkout links it and writes the projection-exclude file beside the checkout, which is the
  // one file a sweep has to remove besides the checkout itself.
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
  git(repo, 'commit', '-qm', 'lane work (#459)');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const store = new CoordinationStore(join(directory, 'ledger'));
  // At HEAD the pool does not exist: the row then runs the deployment exactly as HEAD wires it and
  // fails on its OWN assertion (the stall, the missing row, the missing sweep) rather than on a
  // constructor that never got built.
  const pool = SupervisedProcesses === undefined ? null : new SupervisedProcesses();
  // The host this landing admits its gate run through: a STAGED one with room for one verdict, so
  // a row tests the landing's own admission rule and never the machine the suite happens to run on
  // (`suiteQueueTimeoutDecision` refuses on a live `load`/`budget` shortfall, and this repository's
  // host may well be saturated). `blockVerifyBudget` fills the lane when a row wants it taken.
  const G = 1024 ** 3;
  const hostCapacity = new HostCapacityAuthority({
    root: capacityRoot, residentId: 'issue459-resident', pollMs: 10,
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
    integration: { repoRoot: repo },
  });
  t.after(() => {
    runtime.close();
    pool?.killAll();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the lane (#459)', idempotencyKey: 'i459:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i459:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'The landing runs off the resident loop', sha: tip,
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integration = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i459:integrate', ...args,
  }, principal);
  // The runtime's own durable rows, read the way a reader with the ledger in hand reads them.
  const driverRows = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, seq: event.seq, ts: event.ts }));
  const integrateDriverRows = () => driverRows('swarm.integration_started');
  const failureRows = () => driverRows('swarm.integration_failed');
  const sweptRows = () => driverRows('swarm.integration_swept');
  const wtRoot = join(repo, '.baton', 'wt');
  const leftoverCheckouts = () => (existsSync(wtRoot) ? readdirSync(wtRoot) : [])
    .filter((name) => name.startsWith('integrate-') && !name.endsWith('.projection.exclude'));
  return {
    directory, repo, store, runtime, pool, hostCapacity, capacityRoot, integration, markerPath,
    tip, targetHead, observedHead,
    driverRows, integrateDriverRows, failureRows, sweptRows, wtRoot, leftoverCheckouts,
  };
}

/** Poll `probe` every 20 ms until it answers something truthy, or the bound is spent. Returns the
 * answer with WHEN it was first seen; null when the bound expired. */
async function observe(probe, boundMs = 5_000) {
  const deadline = Date.now() + boundMs;
  for (;;) {
    const value = probe();
    if (value) return { value, at: Date.now() };
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// ── (a) the resident answers while a landing's gate run is in flight ─────────────────────────────

test('459a: a served resident answers swarm.list while a landing\'s gate run is in flight', needsGit, async (t) => {
  const w = await world(t, { gate: { sleepMs: 1_500, green: true } });
  const landing = w.integration();

  // Let the landing reach its gate run — the runner sleeps 1 500 ms, so from here on the landing is
  // IN FLIGHT while the read below is issued. The runner writes its own marker when it finishes:
  // that marker is what proves the read was answered by a resident whose gate run was still running
  // (a resident that froze its loop would answer only after the run, marker and all).
  await new Promise((resolve) => setTimeout(resolve, 200));
  const answered = await Promise.race([
    w.runtime.command('swarm.list', {}, principal).then(() => 'answered'),
    new Promise((resolve) => setTimeout(() => resolve('stalled'), 600)),
  ]);

  assert.equal(answered, 'answered',
    'the resident answers a read while a landing\'s gate run is in flight (never a spawnSync on its loop)');
  assert.equal(existsSync(w.markerPath), false,
    'the answer arrived BEFORE the gate run finished — the read was not merely queued behind it');
  assert.equal(w.integrateDriverRows().length, 1,
    'and the landing the read was answered beside had opened its scratch checkout');

  const answer = await landing;
  assert.equal(answer.integration.dryRun, false);
  assert.equal(git(w.repo, 'rev-parse', 'master'), answer.integration.squashSha, 'the landing still lands');
});

// ── (b) the start row is durable before the gates finish, and the answer names it ────────────────

test('459b: the start row is durable before the gate run finishes and the answer names it', needsGit, async (t) => {
  const w = await world(t, { gate: { sleepMs: 1_200, green: true } });

  const landing = w.integration();
  const seen = await observe(() => w.integrateDriverRows()[0] ?? null);
  assert.ok(seen, 'the start row is durable while the landing runs');
  const answer = await landing;

  assert.equal(seen.value.swarmId, 's1');
  assert.equal(seen.value.contributionId, 'contribution:1');
  assert.equal(seen.value.participantId, 'lane-a', 'the start row names the seat whose work is landing');
  assert.equal(seen.value.target, 'master');
  assert.ok(seen.value.scratch.includes('.baton/wt/integrate-'),
    'the start row names the scratch checkout the landing opened');
  assert.equal(existsSync(seen.value.scratch), false, 'and that checkout is gone when the landing settles');

  // The answer's own receipt is the START row: this is the seq a follower bounds its observation
  // at (#331/#352's `since` rule), so the outcome row it waits for is never an earlier attempt's.
  assert.equal(answer.receipt.event.seq, seen.value.seq,
    'the answer\'s receipt names the start row this attempt recorded first');
  assert.equal(answer.integrationStarted.scratch, seen.value.scratch);
  assert.equal(answer.integrationStarted.seq, seen.value.seq);
  assert.equal(answer.integrationStarted.swept, undefined,
    'nothing was swept before this landing opened, so the row names nothing');
  assert.equal(answer.integration.squashSha, git(w.repo, 'rev-parse', 'master'), 'the landing landed');
});

// ── (c) a red gate lands a durable failure row and the scratch checkout is gone ──────────────────

test('459c: a red gate lands integration_failed with the unexpected rows and the scratch is gone', needsGit, async (t) => {
  const unexpected = [{ row: '459-fixture-red-row', name: 'a row the landing derived and the gate ran red' }];
  const w = await world(t, { gate: { sleepMs: 0, green: false, unexpected } });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integration().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red', 'the caller is refused with the gate code');
  assert.deepEqual(error.detail.unexpected, unexpected, 'the refusal names the unexpected rows');

  const failures = w.failureRows();
  assert.equal(failures.length, 1, 'the landing left ONE durable failure row for a caller that is gone');
  assert.equal(failures[0].contributionId, 'contribution:1');
  assert.equal(failures[0].code, 'integrate_gates_red', 'the row carries the code the landing failed under');
  assert.deepEqual(failures[0].detail.unexpected, unexpected, 'and the rows the gate ran red on');
  assert.equal(typeof failures[0].detail.verdictLine, 'string');

  assert.deepEqual(w.leftoverCheckouts(), [], 'the scratch checkout is gone');
  assert.equal(existsSync(join(w.wtRoot, 'integrate-contribution-1.projection.exclude')), false,
    'and so is the projection-exclude file it wrote');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'a red gate never moves the target');

  // The failure rides the class the #296 receipt registered — one class per ledger row, and the
  // sibling of `contribution_recorded` announces both halves of a landing.
  assert.equal(wakeClassFor({ kind: 'driver.recorded', payload: { kind: 'swarm.integration_failed' } }).wakeClass,
    'contribution_integrated', 'a failed landing wakes the landing class');
  assert.ok(Object.hasOwn(SWARM_REFUSAL_CODES, 'integrate_gates_busy'),
    'the gate run\'s own refusal is in the family\'s ONE closed set');
});

// ── (d) `--follow` returns on the outcome row ────────────────────────────────────────────────────

test('459d: baton swarm integrate --follow returns on the outcome row', needsGit, async (t) => {
  const w = await world(t, { gate: { sleepMs: 0, green: true } });
  const client = { command: (name, args, key) => w.runtime.command(name, args, principal, null, key) };
  const parsed = parseBatonCli(['--idempotency-key', 'i459:follow', 'swarm', 'integrate', 's1', 'contribution:1',
    '--onto', 'master', '--follow']);
  assert.equal(parsed.kind, 'swarm_integrate_follow', 'the verb parses to its own follow leg');

  const answer = await runBatonCli(parsed, client);

  assert.equal(answer.outcome, 'integrated', 'the follow leg returns the landing\'s own outcome');
  assert.equal(answer.refusal, null);
  assert.equal(answer.integration.squashSha, git(w.repo, 'rev-parse', 'master'));
  assert.equal(answer.contribution.contributionId, 'contribution:1');
});

test('459d: follow returns the durable failure row when the gate runs red', needsGit, async (t) => {
  const unexpected = [{ row: '459-follow-red', name: 'red under follow' }];
  const w = await world(t, { gate: { sleepMs: 0, green: false, unexpected } });
  const client = { command: (name, args, key) => w.runtime.command(name, args, principal, null, key) };
  const parsed = parseBatonCli(['--idempotency-key', 'i459:follow-red', 'swarm', 'integrate', 's1', 'contribution:1',
    '--onto', 'master', '--follow']);

  const answer = await runBatonCli(parsed, client);

  assert.equal(answer.outcome, 'failed', 'the follow leg returns the outcome the record holds');
  assert.equal(answer.failure.code, 'integrate_gates_red');
  assert.deepEqual(answer.failure.detail.unexpected, unexpected);
  assert.equal(answer.refusal.code, 'integrate_gates_red', 'the printed refusal names the same code');
});

// ── (e) a leftover checkout is swept on open, and named ──────────────────────────────────────────

test('459e: a leftover integrate-* checkout is swept when the resident opens, and named', needsGit, async (t) => {
  const w = await world(t, { gate: { sleepMs: 0, green: true } });
  // A checkout a PREVIOUS incarnation left behind: the real integration checkout, never cleaned up
  // (the landing that opened it died with its resident).
  const { createIntegrationCheckout } = await import('../src/worktree.mjs');
  const leftover = await createIntegrationCheckout(w.repo, 'contribution:stale', {});
  assert.ok(existsSync(leftover.dir), 'the fixture left a checkout behind');
  const leftoverName = leftover.dir.split('/').at(-1);
  assert.ok(existsSync(join(w.wtRoot, `${leftoverName}.projection.exclude`)),
    'the landing it belonged to wrote a projection-exclude file too');

  // The open of the next incarnation: a NEW runtime over the same store and repository.
  const opened = new SwarmRuntime({
    store: w.store,
    coordinator: { list: () => [], ...(w.pool === null ? {} : { supervisedProcesses: () => w.pool }) },
    hostCapacity: w.hostCapacity,
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: { repoRoot: w.repo },
  });
  t.after(() => opened.close());

  // The open's own entry: the first operation this incarnation serves sweeps what the last one left.
  await opened.command('swarm.list', {}, principal);
  assert.equal(existsSync(leftover.dir), false, 'the open swept the leftover checkout');
  assert.equal(existsSync(join(w.wtRoot, `${leftoverName}.projection.exclude`)), false,
    'and its projection-exclude file');
  const swept = w.sweptRows();
  assert.equal(swept.length, 1, 'the open recorded what it swept, once');
  assert.deepEqual(swept[0].swept, [leftoverName], 'naming the checkout it removed');
  assert.equal(swept[0].repoRoot, w.repo);

  // And the next landing's start row names it too: the row that opens a landing says which
  // leftovers this incarnation had to clear before it could open.
  const answer = await opened.command('swarm.integrate',
    { swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i459:swept-landing' },
    principal);
  assert.deepEqual(answer.integrationStarted.swept, [leftoverName]);
  assert.equal(answer.integration.squashSha, git(w.repo, 'rev-parse', 'master'));
});

// ── (f) a gate run that cannot take the verify lease refuses typed, never blocks ─────────────────

/**
 * The staged-authority blocker #424's rows use: one live verify lease fills the whole verdict
 * budget, so a request that honours the authority cannot admit beside it. Staged as the real
 * protocol (a 0600 record naming a live pid), never as a mock of it.
 */
function blockVerifyBudget(root, t, holder = 'seat-busy') {
  const nonce = createHash('sha256').update(`459:${process.pid}:${root}`).digest('hex').slice(0, 32);
  mkdirSync(join(root, 'leases'), { recursive: true, mode: 0o700 });
  const path = join(root, 'leases', `lease-verify-${nonce}.json`);
  writeFileSync(path, `${JSON.stringify({
    schemaVersion: 1, kind: 'verify', holder, nonce, pid: process.pid,
    residentId: 'issue459-blocker', acquiredAt: new Date().toISOString(),
  })}\n`, { mode: 0o600 });
  t.after(() => rmSync(path, { force: true }));
  return holder;
}

test('459f: a gate run behind the host verify lease waits in the queue and lands once the lease frees — never refused for waiting (#541)', needsGit, async (t) => {
  // The landing's gate run honours the operator bypass (BATON_HOST_CAPACITY_DISABLED=1) exactly as
  // a seat's suite does — under it nothing is acquired and nothing can be busy. This row pins the
  // STAGED authority's queue, so the ambient bypass a parallel gate runner pins must not win here.
  const bypass = process.env.BATON_HOST_CAPACITY_DISABLED;
  delete process.env.BATON_HOST_CAPACITY_DISABLED;
  t.after(() => { if (bypass !== undefined) process.env.BATON_HOST_CAPACITY_DISABLED = bypass; });
  const w = await world(t, { gate: { sleepMs: 0, green: true } });
  // A host whose verdict lane is already taken: the landing queues behind it, visibly, and no gate
  // run is spawned until the lane frees.
  blockVerifyBudget(w.capacityRoot, t, 'participant:swarm-wave15-20260918:seat-busy');
  const nonce = createHash('sha256').update(`459:${process.pid}:${w.capacityRoot}`).digest('hex').slice(0, 32);
  const blockerPath = join(w.capacityRoot, 'leases', `lease-verify-${nonce}.json`);
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const landing = w.integration();
  const queueEntries = () => (existsSync(join(w.capacityRoot, 'queue'))
    ? readdirSync(join(w.capacityRoot, 'queue')).filter((name) => name.endsWith('.json')) : []);
  // The landing prepares its scratch checkout, then asks the authority and waits as one visible
  // queue entry. Nothing is spawned and nothing moves while the lane is held.
  while (queueEntries().length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(queueEntries().length, 1, 'the landing waits as one visible queue entry');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(existsSync(w.markerPath), false, 'no gate run was spawned while the lane was held');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'nothing moved while waiting');

  // The lane frees; the queued landing is admitted, runs its gates, and lands.
  rmSync(blockerPath, { force: true });
  const answer = await landing;
  assert.equal(answer.integration.dryRun, false);
  assert.equal(git(w.repo, 'rev-parse', 'master'), answer.integration.squashSha, 'the landing lands once admitted');
  assert.equal(existsSync(w.markerPath), true, 'the gate run ran');
  assert.deepEqual(w.failureRows(), [], 'nothing was refused');
});

// ── (g) a gate run killed at its deadline leaves a failure row and no scratch ────────────────────

test('459g: a gate run the resident kills at its deadline lands the failure row and removes the scratch', needsGit, async (t) => {
  // A runner that never finishes: the resident's own backstop (the SAME knob the suite runner
  // honours for a hung file) kills it, and the landing must settle instead of hanging on it.
  const w = await world(t, { gate: { sleepMs: 30_000, green: true } });
  const restore = process.env.BATON_SUITE_IDLE_MS;
  process.env.BATON_SUITE_IDLE_MS = '400';
  t.after(() => {
    if (restore === undefined) delete process.env.BATON_SUITE_IDLE_MS;
    else process.env.BATON_SUITE_IDLE_MS = restore;
  });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integration().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing settles when its gate run is killed');
  assert.equal(error.code, 'integrate_gates_red');
  assert.equal(existsSync(w.markerPath), false, 'the run was killed before it could finish');
  const failures = w.failureRows();
  assert.equal(failures.length, 1, 'the killed run leaves its outcome in the record');
  assert.equal(failures[0].code, 'integrate_gates_red');
  assert.equal(failures[0].detail.unexpected[0].row, 'suite-timed-out',
    'the row names the timeout, never a red gate the runner never judged');
  assert.equal(failures[0].detail.unexpected[0].timedOut, true);
  assert.deepEqual(w.leftoverCheckouts(), [], 'the scratch checkout is gone');
  assert.equal(existsSync(join(w.wtRoot, 'integrate-contribution-1.projection.exclude')), false,
    'and so is the projection-exclude file');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'nothing moved');
});
