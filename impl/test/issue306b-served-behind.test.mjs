// issue306b-served-behind.test.mjs — issue #306 lane B. The doctor names the revision a resident
// serves, the target it is measured against and the commits between them (`served.target {ref, sha}`
// — with the #306 (2) `{ref, commit, behind}` projection kept beside it — `served.behind
// {count, commits}` bounded by the ONE registry row, and `upToDate`); a recruit on a resident whose
// served commit is behind its target is ADMITTED with the typed `base_behind` advisory on its
// receipt and one line of its brief; and the `host.reincarnated` row the successor records wakes
// the new closed `incarnation_changed` class instead of nothing. Hermetic: temp repositories under
// os.tmpdir(), fixture adapters, no provider process.
//
// Red-before at HEAD (observed, one row at a time): servedBehind absent (link-free namespace read),
// so (a) and (b) fail on the derivation; (c)/(d)/(e) fail on the absent advisory + brief line;
// (f) fails on wakeClassRow('incarnation_changed') === null.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The spawn counter (the ds-441b pattern): an ESM facade snapshots a builtin's named exports at its
// FIRST link, so the patch lands on the CJS module object BEFORE any module under test is imported —
// every import of the modules under test below is dynamic for exactly this reason. The pin it
// serves: the recruit advisory costs NO git read of its own — the runtime asks the deployment.
const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const realExecFileSync = childProcess.execFileSync;
const gitSpawns = [];
childProcess.execFileSync = (...args) => {
  if (args[0] === 'git') gitSpawns.push(args[1]);
  return realExecFileSync(...args);
};
const deployments = await import('../src/application-deployment.mjs');
const { CoordinationStore } = await import('../src/coordination-store.mjs');
const { SwarmRuntime } = await import('../src/swarm-runtime.mjs');
const { openBaton } = await import('../src/index.mjs');
const wake = await import('../src/wake-stream.mjs');
const { FRAME_LIMITS } = await import('../src/limits.mjs');

const dirs = [];
function tmp(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-306b-${label}-`));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repo(label) {
  const root = join(tmp(label), 'repo');
  mkdirSync(root);
  git(['init', '-q', '-b', 'main'], root);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'served-behind@example.invalid', GIT_COMMITTER_EMAIL: 'served-behind@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Served-behind fixture', GIT_COMMITTER_NAME: 'Served-behind fixture' });
  writeFileSync(join(root, 'README.md'), '# served-behind fixture\n');
  git(['add', '.'], root);
  git(['commit', '-qm', 'base'], root);
  return root;
}

function commit(root, name) {
  writeFileSync(join(root, `${name}.txt`), `${name}\n`);
  git(['add', '.'], root);
  git(['commit', '-qm', name], root);
  return git(['rev-parse', 'HEAD'], root);
}

/** The served-behind facts ONE derivation answers, or the row the registry does not hold yet. */
function behindOf(root, served, options = undefined) {
  const derive = deployments.servedBehind;
  assert.equal(typeof derive, 'function',
    'stage[served-behind-derivation-missing]: application-deployment.mjs must export the ONE '
    + 'served-behind derivation (servedBehind) the doctor and the recruit advisory both read');
  return options === undefined ? derive(root, served) : derive(root, served, options);
}

test('#306b (a1): servedBehind names the target and the commits between it and the served revision', () => {
  const root = repo('unit');
  const base = git(['rev-parse', 'HEAD'], root);
  const served = deployments.servedRevision(root);
  assert.deepEqual(served, { commit: base, branch: 'main' });
  const one = commit(root, 'one');
  const two = commit(root, 'two');
  const facts = behindOf(root, served);
  assert.deepEqual(facts.target, { ref: 'main', sha: two },
    'the target is the branch the residents serve, read fresh, named by ref and sha');
  assert.equal(facts.behind.count, 2, 'behind.count is the commits the served revision lacks');
  assert.deepEqual(facts.behind.commits, [
    { sha: two, subject: 'two' },
    { sha: one, subject: 'one' },
  ], 'the commits page names each missing commit newest-first with its subject');
  assert.equal(facts.upToDate, false, 'count > 0 reads upToDate: false');
  // The #306 (2) spelling stays readable beside it — one derivation, two projections.
  assert.deepEqual(deployments.servedTarget(root, served), { ref: 'main', commit: two, behind: 2 },
    'the landed {ref, commit, behind} projection is derived from the SAME facts');
});

test('#306b (a2): the commits page is bounded by the registry row while the count stays the truth', () => {
  const root = repo('page');
  const served = deployments.servedRevision(root);
  commit(root, 'p1');
  const tip = commit(root, 'p2');
  const limit = FRAME_LIMITS['view.served_behind.commits'];
  assert.ok(limit, 'stage[served-behind-row-missing]: the registry declares the commits page row');
  assert.equal(limit.lane, 'view.served_behind.commits');
  assert.equal(limit.class, 'view', 'a bounded read sheds, it never refuses a durable write');
  assert.equal(limit.unit, 'items');
  assert.ok(Number.isSafeInteger(limit.value) && limit.value > 1, 'the page is a bounded item count');
  const facts = behindOf(root, served);
  assert.equal(facts.behind.count, 2);
  assert.equal(facts.behind.commits.length, Math.min(facts.behind.count, limit.value),
    'the page carries the whole history up to the declared page');
  const bounded = behindOf(root, served, { limit: 1 });
  assert.deepEqual(bounded.behind.commits, [{ sha: tip, subject: 'p2' }],
    'a narrower page truncates the page, newest first');
  assert.equal(bounded.behind.count, 2, 'the count is the whole truth, never the page length');
});

test('#306b (a3): a resident serving its target reads upToDate: true, and an unknown target says null', () => {
  const root = repo('current');
  const served = deployments.servedRevision(root);
  const facts = behindOf(root, served);
  assert.deepEqual(facts.behind, { count: 0, commits: [] });
  assert.equal(facts.upToDate, true, 'behind.count 0 reads upToDate: true');
  const lonely = repo('lonely');
  git(['checkout', '-q', '--detach', 'HEAD'], lonely);
  const detached = deployments.servedRevision(lonely);
  const unknown = behindOf(lonely, detached);
  assert.deepEqual(unknown.target, { ref: null, sha: null });
  assert.deepEqual(unknown.behind, { count: null, commits: [] });
  assert.equal(unknown.upToDate, null, 'nothing to measure against is unknown, never a false zero');
});

// A served route card so the deployment opens on fixture adapters (no muse binary, no network).
const WORKER_POLICY = Object.freeze({
  schemaVersion: 1,
  autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'launch', mechanisms: ['permission-mode-yolo'] },
  access: { supported: ['full'], default: 'full', perTask: false, observation: 'launch', mechanisms: ['muse-unsandboxed-permissions'] },
  containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: ['worktree-cwd', 'profile-isolation'], observation: 'unavailable' },
});
const CLAUDE_CARD = Object.freeze({
  harness: 'claude-code', version: '2.0.0', authPosture: 'subscription',
  modelSelection: {
    mode: 'exact', configuredDefault: 'claude-opus-4-6', available: ['claude-opus-4-6'],
    family: 'claude', acceptedPrefixes: ['claude-'], acceptedAliases: [],
    reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'], provenance: 'served-behind-test', refreshedAt: null,
  },
  providerCompatibility: { credentialState: 'available' },
  workerPolicy: WORKER_POLICY,
  permissions: { mode: 'bypassPermissions', sandbox: 'unverified', boundary: 'served-behind-test fixture' },
});
class FixtureAdapter {
  constructor(card) { this._card = card; this._onEvent = null; }
  card() { return this._card; }
  onEvent(callback) { this._onEvent = callback; }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

async function openFixture(root, label) {
  return openBaton({
    repo: root,
    advanced: {
      deploymentRoot: join(tmp(`root-${label}`), 'deployment'),
      routes: deployments.DEFAULT_BATON_DEPLOYMENT_ROUTES
        .filter((route) => route.harness === 'claude-code' && (route.provider ?? 'claude') === 'claude'),
      adapters: { 'claude-code:claude': new FixtureAdapter(CLAUDE_CARD) },
      verification: { command: process.execPath, arguments: ['--version'] },
      capacity: {
        estimate: () => ({ bytes: 1, inodes: 1 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
}

test('#306b (b): the doctor carries served.target {ref, sha}, the bounded commit page and upToDate', async () => {
  const root = repo('doctor');
  const base = git(['rev-parse', 'HEAD'], root);
  let deployment = null;
  try {
    deployment = await openFixture(root, 'doctor');
    const before = await deployment.doctor();
    assert.equal(before.served.commit, base, 'the served revision is frozen at open');
    assert.deepEqual(before.served.target, { ref: 'main', commit: base, behind: 0 },
      'the landed #306 (2) projection is byte-identical');
    assert.equal(before.served.target.sha, base, 'the same target facts publish its sha');
    assert.equal(before.served.upToDate, true);
    const one = commit(root, 'landing-one');
    const two = commit(root, 'landing-two');
    const after = await deployment.doctor();
    assert.equal(after.served.commit, base);
    assert.deepEqual(deploymentModuleTarget(after), { ref: 'main', sha: two },
      'the target is read fresh: two commits landed on the branch since the served revision');
    assert.equal(after.served.behind.count, 2);
    assert.deepEqual(after.served.behind.commits, [
      { sha: two, subject: 'landing-two' },
      { sha: one, subject: 'landing-one' },
    ], 'the doctor names WHICH commits the served revision lacks, newest first');
    assert.equal(after.served.upToDate, false);
    assert.deepEqual(after.served.target, { ref: 'main', commit: two, behind: 2 },
      'one derivation, two projections: the landed spelling never disagrees with the new one');
  } finally {
    try { await deployment?.close(); } catch { /* fixture tree removed by tmp() */ }
  }
});

/** The new target projection, read by property access (its fields are additive). */
function deploymentModuleTarget(doctor) {
  const target = doctor?.served?.target;
  assert.ok(target && typeof target === 'object' && 'sha' in target,
    'stage[served-target-sha-missing]: the doctor served.target must publish `sha` beside the '
    + 'landed `commit`/`behind` keys');
  return { ref: target.ref, sha: target.sha };
}

function swarmFixture(deploymentSummary) {
  const directory = tmp('swarm');
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = { list: () => workers, pausedTurns: () => [] };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, deploymentSummary,
    prepareRun: async (request) => request,
    startRun: async (request) => {
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: false });
      }
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(command === 'view' ? {} : { idempotencyKey: `request-${++key}` }), ...args }, owner);
  return { call };
}

/** The ONE line the brief names the stale base with, exactly as the issue spells it. */
function baseLine(served, count, ref) {
  return `This resident serves ${served}, ${count} commits behind ${ref}; your base is the served commit.`;
}

test('#306b (c): a crew is told nothing when the resident is current or the target is unknown', async () => {
  const currentSha = 'a'.repeat(40);
  const current = swarmFixture(() => ({
    workspace: null, hostCapacity: null,
    served: { commit: currentSha, branch: 'main', target: { ref: 'main', commit: currentSha, behind: 0 } },
  }));
  await current.call('create', { purpose: 'current resident' });
  const recruited = await current.call('recruit', { participantId: 'lane', objective: 'work' });
  assert.equal(recruited.advisory, null, 'a current resident raises no advisory');
  const unknown = swarmFixture(() => ({
    workspace: null, hostCapacity: null,
    served: { commit: currentSha, branch: null, target: { ref: null, commit: null, behind: null } },
  }));
  await unknown.call('create', { purpose: 'detached, no remote' });
  assert.equal((await unknown.call('recruit', { participantId: 'lane', objective: 'work' })).advisory, null,
    'an unknown target raises no advisory (absence is never a fabricated zero)');
});

test('#306b (d): a recruit on a behind resident is ADMITTED with the typed base_behind advisory, and its brief says so in one line', async () => {
  const served = 'a'.repeat(40);
  const target = 'b'.repeat(40);
  const fixture = swarmFixture(() => ({
    workspace: null, hostCapacity: null,
    served: { commit: served, branch: null, target: { ref: 'origin/main', commit: target, behind: 4 } },
  }));
  await fixture.call('create', { purpose: 'stale resident' });
  const recruited = await fixture.call('recruit', { participantId: 'lane', objective: 'work' });
  assert.equal(recruited.admission.state, 'admitted', 'the advisory never refuses the seat');
  assert.deepEqual(recruited.advisory, {
    kind: 'base_behind', served, target: { ref: 'origin/main', sha: target }, count: 4,
    next: 'baton deployment reincarnate <target>',
  });
  assert.deepEqual(recruited.baseBehind, {
    served, branch: null, target: { ref: 'origin/main', commit: target }, behind: 4,
  }, 'the landed baseBehind receipt keeps its exact shape — one derivation, two projections');
  // #464 (third half): a roster row carries the brief's REACH; the text rides the scoped read.
  const view = await fixture.call('view', { participantId: 'lane' });
  const seat = view.participants.find((row) => row.participantId === 'lane');
  assert.ok(typeof seat?.brief === 'string' && seat.brief.length > 0, 'the seat carries its composed brief');
  assert.ok(seat.brief.includes(baseLine(served, 4, 'origin/main')),
    `the brief names the stale base in one line: ${baseLine(served, 4, 'origin/main')}`);
  assert.equal(seat.brief.includes(baseLine(served, 0, 'origin/main')), false);
});

test('#306b (e): the doctor and the advisory are ONE derivation — and the runtime reads no git of its own', async () => {
  const root = repo('one-derivation');
  const servedHead = git(['rev-parse', 'HEAD'], root);
  let deployment = null;
  try {
    deployment = await openFixture(root, 'one-derivation');
    commit(root, 'landing-one');
    const tip = commit(root, 'landing-two');
    const doctor = await deployment.doctor();
    assert.ok(doctor.served.behind.count > 0, 'the fixture resident is behind its target');
    const fixture = swarmFixture(() => deployment.doctorReadiness());
    await fixture.call('create', { purpose: 'the deployment summary is the doctor row' });
    const recruited = await fixture.call('recruit', { participantId: 'lane', objective: 'work' });
    assert.equal(recruited.advisory.served, doctor.served.commit);
    assert.equal(recruited.advisory.target.sha, doctor.served.target.sha, 'the target sha is the doctor\'s own');
    assert.equal(recruited.advisory.target.sha, tip);
    assert.equal(recruited.advisory.count, doctor.served.behind.count, 'the count is the doctor\'s own');
    assert.deepEqual(recruited.advisory.target, { ref: doctor.served.target.ref, sha: doctor.served.target.sha });

    // The runtime asks the DEPLOYMENT, never git: a recruit against a summary that carries the row
    // (so nothing else in the path can reach for a repository) spawns no git at all.
    const frozen = swarmFixture(() => ({
      workspace: null, hostCapacity: null,
      served: { commit: servedHead, branch: 'main', target: { ref: 'main', commit: tip, behind: 2 } },
    }));
    await frozen.call('create', { purpose: 'no git authority wired' });
    const before = gitSpawns.length;
    const alone = await frozen.call('recruit', { participantId: 'lane', objective: 'work' });
    assert.equal(gitSpawns.length, before, 'the advisory path spawns no git — the runtime never re-derives it');
    assert.deepEqual(alone.advisory, {
      kind: 'base_behind', served: servedHead, target: { ref: 'main', sha: tip }, count: 2,
      next: 'baton deployment reincarnate <target>',
    });
  } finally {
    try { await deployment?.close(); } catch { /* fixture tree removed by tmp() */ }
  }
});

test('#306b (f): a host.reincarnated row wakes the closed incarnation_changed class', () => {
  const row = wake.wakeClassRow('incarnation_changed');
  assert.ok(row, 'stage[incarnation-changed-class-missing]: the ONE closed wake-class table must map '
    + 'the successor\'s host.reincarnated row to a class — never a side list');
  assert.equal(row.scope, 'deployment', 'the class is a sibling of dead: a deployment-scope row');
  assert.equal(row.terminal, false, 'the class does not end the watch: the wake is "re-read the view"');
  assert.equal(row.next, null, 'a non-terminal class names no command (the table invariant)');
  assert.match(row.summary, /re-read the view/u, 'the guidance the non-terminal class carries is in its summary');
  assert.ok(wake.WAKE_CLASSES.includes('incarnation_changed'));
  assert.ok(wake.wakeClassHelpLines().some((line) => line.startsWith('incarnation_changed')),
    'the CLI help renders it from the table, so --wake-class admits it');
  // The row the successor records reaches the class through the shape the coordinator really writes.
  assert.equal(wake.wakeClassFor({ kind: 'driver.recorded', payload: { kind: 'host.reincarnated' } }).wakeClass,
    'incarnation_changed');
  assert.equal(wake.wakeClassFor({ kind: 'host.reincarnated' }).wakeClass, 'incarnation_changed');
  const frame = wake.deriveWakeFrame({
    seq: 41, ts: '2026-09-18T00:00:00.000Z', kind: 'driver.recorded',
    actor: 'deployment:repo-fixture:resident',
    payload: { kind: 'host.reincarnated', from: { incarnation: 'i-1', commit: 'a'.repeat(40) },
      to: { incarnation: 'i-2', commit: 'b'.repeat(40) } },
  });
  // The frame carries the class; the terminality a consumer acts on is the table's (`next` is the
  // class's own, never the frame's).
  assert.equal(wake.wakeClassRow(frame.wakeClass).terminal, false);
  assert.equal(frame.next, null);
  const filter = wake.parseWakeFilter({ kinds: 'incarnation_changed' });
  assert.deepEqual([...filter.kinds], ['incarnation_changed'], 'the --wake-class filter admits the new class');
  assert.equal(wake.wakeMatches(frame, filter), true);
  const live = new CoordinationStore(tmp('ledger'));
  live.recordDriver('host.reincarnated',
    { from: { incarnation: 'i-1', commit: 'a'.repeat(40) }, to: { incarnation: 'i-2', commit: 'b'.repeat(40) } },
    { actor: 'deployment:repo-fixture:resident', key: 'reincarnated:1' });
  const recorded = wake.wakeClassFor(live.events().at(-1));
  assert.equal(recorded?.wakeClass, 'incarnation_changed', 'a real ledger row wakes the class');
});
