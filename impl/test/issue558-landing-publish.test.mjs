// Issue #558 — a landing that stays local is a lost landing. `swarm.integrate` landed a
// contribution with `git update-ref` inside the resident repository and never pushed, so every
// landing that succeeded locally reached no shared remote. The fix: the deployment DECLARES its
// shared remote (`advanced.integration.publishRemote`, validated at open, never inferred from
// `origin` or `repoId`), the landing publishes the landed ref to it after the fast-forward, and a
// landing that cannot publish refuses typed instead of reporting a local success.
//
// Every row below runs on a REAL temporary repository with a REAL lane branch and, where a
// publish is expected, a REAL bare repository as the declared shared remote:
//
//   (a) a landing with no declared remote refuses `integrate_publish_undeclared`, pre-effect:
//       the target does not move and no receipt is recorded;
//   (b) a landing whose declared remote is unreachable refuses `integrate_publish_failed`, and
//       the local fast-forward is rolled back: the target holds no unpublished squash;
//   (c) a landing with a reachable declared remote publishes synchronously: the remote holds the
//       squash the moment the landing returns, with no background hook involved;
//   (d) a malformed declaration is refused at open, never first at landing time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { createDriver } from '../src/index.mjs';

const principal = { actor: 'direct:issue558-root', principalId: 'issue558-root', sessionId: 'issue558-root' };
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

const contractBody = ({ subject, items, sha, branch, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch },
  items,
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

const ITEMS = [
  { id: 'publish-step', status: 'delivered', change: 'Publish the landed ref', files: ['impl/src/worktree.mjs'], test: 'node --test test/issue558-landing-publish.test.mjs', evidence: 'suite green' },
];

/**
 * A real repository with a target branch and a lane branch, plus an accepted contribution naming
 * the lane tip. `publishRemote` is the deployment's declared shared remote: the string the
 * landing must publish to, or undefined when the deployment declares none. `bareRemote` decides
 * whether the fixture also creates a bare repository for the declaration to name.
 */
async function world(t, { publishRemote = undefined, bareRemote = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue558-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 558');
  git(repo, 'config', 'user.email', 'issue558@example.invalid');
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/worktree.mjs', '// lane change\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane one (#558)');
  const tip = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  let remote = publishRemote;
  if (bareRemote) {
    remote = join(directory, 'shared.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { env: { ...process.env, ...QUIET_GIT_ENV } });
  }

  const store = new CoordinationStore(join(directory, 'ledger'));
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [] },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    integration: {
      repoRoot: repo,
      ...(remote === undefined ? {} : { publishRemote: remote }),
      regenerate: async () => {},
      runGates: async (dir, files) => ({ files, verdictLine: `green — ${files.length} file(s)`, unexpected: [] }),
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'publish the landing', idempotencyKey: 'i558:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i558:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'publish the landing' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'Publish the landed ref', items: ITEMS, sha: tip, branch: 'baton/lane-1',
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i558:integrate', ...args,
  }, principal);
  const foldRow = () => store.swarm('s1').contributions['contribution:1'];
  return { directory, repo, remote, store, runtime, integrate, foldRow, tip, targetHead, observedHead };
}

// ── (a) no declared remote refuses pre-effect ────────────────────────────────────────────────

test('558a: a landing with no declared shared remote refuses typed and moves nothing', needsGit, async (t) => {
  const w = await world(t);
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of reporting a local success');
  assert.equal(error.code, 'integrate_publish_undeclared');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
});

// ── (b) an unreachable remote refuses and rolls the local move back ──────────────────────────

test('558b: a landing that cannot reach the declared remote refuses typed and leaves no unpublished squash', needsGit, async (t) => {
  const w = await world(t, { publishRemote: join('no-such-directory', 'shared.git') });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of reporting a local success');
  assert.equal(error.code, 'integrate_publish_failed');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore,
    'the local fast-forward is rolled back: the target holds no unpublished squash');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
});

// ── (c) a reachable remote holds the squash the moment the landing returns ──────────────────

test('558c: a landing publishes the landed ref to the declared remote synchronously', needsGit, async (t) => {
  const w = await world(t, { bareRemote: true });

  const answer = await w.integrate();

  const local = git(w.repo, 'rev-parse', 'master');
  assert.equal(answer.integration.squashSha, local, 'the squash landed locally');
  // No waiting, no polling, no background hook: the remote holds the squash on return.
  const published = execFileSync('git', ['--git-dir', w.remote, 'rev-parse', 'refs/heads/master'], {
    encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
  }).trim();
  assert.equal(published, answer.integration.squashSha,
    'the declared remote holds the landed squash the moment the landing returns');
  assert.equal(w.foldRow().integration.squashSha, answer.integration.squashSha);
});

// ── (d) a malformed declaration is refused at open ───────────────────────────────────────────

test('558d: a malformed publishRemote declaration is refused at deployment open', needsGit, async (t) => {
  const { openBaton } = await import('../src/index.mjs');
  // A hermetic repository: the open refuses the declaration before any state write, so the
  // cheapest repo that `repositoryAuthority` accepts — an init with one commit — is enough, and
  // the row never contends with another lane's deployment open.
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue558-open-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });

  const error = await openBaton({
    repo,
    advanced: { integration: { publishRemote: '' } },
  }).then(() => null, (thrown) => thrown);

  assert.ok(error, 'the open refuses a malformed declaration');
  assert.equal(error.code, 'deployment_config_invalid');
  assert.match(error.message, /publishRemote/u, 'the refusal names the declaration');
});

// ── (e) the declared value reaches the landing authority ───────────────────────────────

const principalOf = (id) => Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });

function applicationOver(t, repo, { publishRemote } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue558-app-'));
  const logDir = join(directory, 'log');
  mkdirSync(logDir, { recursive: true });
  const repoId = 'repo-issue558-app';
  const driver = createDriver({
    repoRoot: repo, repoId, logDir,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [] } }) },
    ...(publishRemote === undefined ? {} : { integrationPublishRemote: publishRemote }),
  });
  const application = new BatonApplication({
    driver, repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65_536, requiredPredecessorEvidence: [] },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principalOf('application-planner'),
      dispatcher: principalOf('application-dispatcher'),
      observer: principalOf('application-observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    rmSync(directory, { recursive: true, force: true });
  });
  return application;
}

test('558e: the declared remote rides the driver to the landing authority, verbatim', needsGit, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue558-app-repo-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });

  const declared = applicationOver(t, repo, { publishRemote: 'https://shared.example.test/baton.git' });
  assert.equal(declared._swarmRuntime().integration.repoRoot, repo);
  assert.equal(declared._swarmRuntime().integration.publishRemote, 'https://shared.example.test/baton.git',
    'the landing authority carries the declared value itself, never an inference');

  const undeclared = applicationOver(t, repo);
  assert.equal(undeclared._swarmRuntime().integration.publishRemote, null,
    'no declaration reads as absence, never a guessed remote');
});
