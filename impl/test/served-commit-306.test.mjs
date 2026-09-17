// served-commit-306.test.mjs — issue #306 (2): a deployment says which commit it serves, and how
// far behind its target that is. The served revision is the checkout's HEAD at open, frozen for
// the deployment's life (the code that loaded is the code that answers); the target — the
// checkout's branch, else the remote default — and the behind count are read fresh from the
// repository's refs at every doctor read, never from the network. Hermetic: temp repositories
// under os.tmpdir(), fixture adapters, no provider process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_BATON_DEPLOYMENT_ROUTES, servedRevision, servedTarget } from '../src/application-deployment.mjs';
import { openBaton } from '../src/index.mjs';

const dirs = [];
function tmp(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-served-${label}-`));
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
  git(['config', 'user.email', 'served@example.invalid'], root);
  git(['config', 'user.name', 'Served fixture'], root);
  writeFileSync(join(root, 'README.md'), '# served fixture\n');
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

test('#306 (2): servedRevision is the checkout HEAD and branch; servedTarget measures it against the branch tip, fresh', () => {
  const root = repo('unit');
  const base = git(['rev-parse', 'HEAD'], root);
  const served = servedRevision(root);
  assert.deepEqual(served, { commit: base, branch: 'main' });
  assert.deepEqual(servedTarget(root, served), { ref: 'main', commit: base, behind: 0 });
  const next = commit(root, 'one');
  const later = commit(root, 'two');
  assert.deepEqual(servedTarget(root, served), { ref: 'main', commit: later, behind: 2 },
    'the target is read fresh: two commits landed on the branch since the served revision');
  assert.notEqual(next, later);
});

test('#306 (2): a detached checkout measures against the remote default branch, and with no remote reports nulls — never a throw', () => {
  const upstream = repo('upstream');
  const tip = commit(upstream, 'landing');
  const clone = join(tmp('clone'), 'clone');
  git(['clone', '-q', upstream, clone], tmp('scratch'));
  const base = git(['rev-parse', 'HEAD~1'], clone);
  git(['checkout', '-q', '--detach', base], clone);
  const served = servedRevision(clone);
  assert.deepEqual(served, { commit: base, branch: null }, 'detached: no branch');
  const target = servedTarget(clone, served);
  assert.equal(target.ref, 'origin/main', 'a detached clone measures against the remote default branch');
  assert.equal(target.commit, tip);
  assert.equal(target.behind, 1);

  const lonely = repo('lonely');
  git(['checkout', '-q', '--detach', 'HEAD'], lonely);
  const lonelyServed = servedRevision(lonely);
  assert.equal(lonelyServed.branch, null);
  assert.deepEqual(servedTarget(lonely, lonelyServed), { ref: null, commit: null, behind: null },
    'no branch and no remote: nothing to measure against, said with nulls');

  assert.deepEqual(servedRevision(tmp('not-a-repo')), { commit: null, branch: null }, 'an unreadable checkout is absence, not a failure');
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
    reasoningEffort: ['low', 'medium', 'high', 'xhigh', 'max'], provenance: 'served-commit-test', refreshedAt: null,
  },
  providerCompatibility: { credentialState: 'available' },
  workerPolicy: WORKER_POLICY,
  permissions: { mode: 'bypassPermissions', sandbox: 'unverified', boundary: 'served-commit-test fixture' },
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

test('#306 (2): the deployment doctor and card carry the served revision, frozen at open, with the fresh behind count', async () => {
  const root = repo('deployment');
  const base = git(['rev-parse', 'HEAD'], root);
  let deployment = null;
  try {
    deployment = await openBaton({
      repo: root,
      advanced: {
        deploymentRoot: join(tmp('deployment-root'), 'deployment'),
        // The profile names only the routes the fixture adapter serves.
        routes: DEFAULT_BATON_DEPLOYMENT_ROUTES.filter((route) => route.harness === 'claude-code' && (route.provider ?? 'claude') === 'claude'),
        adapters: { 'claude-code:claude': new FixtureAdapter(CLAUDE_CARD) },
        verification: { command: process.execPath, arguments: ['--version'] },
        capacity: {
          estimate: () => ({ bytes: 1, inodes: 1 }),
          observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
        },
      },
    });
    const before = await deployment.doctor();
    assert.deepEqual(before.served, { commit: base, branch: 'main', target: { ref: 'main', commit: base, behind: 0 } });
    assert.deepEqual(deployment.card().readiness.served, before.served, 'the card reads the same row');
    const landed = commit(root, 'landing-after-open');
    const after = await deployment.doctor();
    assert.equal(after.served.commit, base, 'the served revision is frozen at open: the code running did not change');
    assert.deepEqual(after.served.target, { ref: 'main', commit: landed, behind: 1 },
      'the target and the behind count are read fresh at every doctor read');
  } finally {
    try { await deployment?.close(); } catch { /* fixture tree removed by tmp() */ }
  }
});

// ── #306 (3): a recruit on a resident that serves a commit behind its target carries baseBehind ──
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

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

test('#306 (3): swarm.recruit is admitted with a baseBehind advisory when the served commit is behind the target, and carries null when current or unknown', async () => {
  const behindSummary = () => ({
    workspace: null, hostCapacity: null,
    served: { commit: 'a'.repeat(40), branch: null, target: { ref: 'origin/main', commit: 'b'.repeat(40), behind: 4 } },
  });
  const stale = swarmFixture(behindSummary);
  await stale.call('create', { purpose: 'stale resident' });
  const recruited = await stale.call('recruit', { participantId: 'lane', objective: 'work' });
  assert.equal(recruited.admission.state, 'admitted', 'advisory, never a refusal');
  assert.deepEqual(recruited.baseBehind, {
    served: 'a'.repeat(40), branch: null, target: { ref: 'origin/main', commit: 'b'.repeat(40) }, behind: 4,
  });

  const current = swarmFixture(() => ({ workspace: null, hostCapacity: null, served: { commit: 'a'.repeat(40), branch: 'main', target: { ref: 'main', commit: 'a'.repeat(40), behind: 0 } } }));
  await current.call('create', { purpose: 'current resident' });
  assert.equal((await current.call('recruit', { participantId: 'lane', objective: 'work' })).baseBehind, null);

  const unknown = swarmFixture(() => ({ workspace: null, hostCapacity: null, served: { commit: 'a'.repeat(40), branch: null, target: { ref: null, commit: null, behind: null } } }));
  await unknown.call('create', { purpose: 'detached, no remote' });
  assert.equal((await unknown.call('recruit', { participantId: 'lane', objective: 'work' })).baseBehind, null);

  const unwired = swarmFixture(null);
  await unwired.call('create', { purpose: 'no summary' });
  assert.equal((await unwired.call('recruit', { participantId: 'lane', objective: 'work' })).baseBehind, null);
});
