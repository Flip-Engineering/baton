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
//   (b) a landing whose declared remote is unreachable refuses `integrate_publish_unreachable`
//       (#573: the pre-flight refuses before the gate run, so nothing ever moves and there is
//       no local fast-forward to roll back);
//   (c) a landing with a reachable declared remote publishes synchronously: the remote holds the
//       squash the moment the landing returns, with no background hook involved;
//   (d) a malformed declaration is refused at open, never first at landing time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

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
async function world(t, { publishRemote = undefined, bareRemote = false, onGates = null } = {}) {
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
      runGates: async (dir, files) => {
        if (onGates) await onGates();
        return { files, verdictLine: `green — ${files.length} file(s)`, unexpected: [] };
      },
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
  // Issue #573: the pre-flight refuses before the scratch checkout exists, so this row never
  // reaches the push whose failure #558 originally pinned here.
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of reporting a local success');
  assert.equal(error.code, 'integrate_publish_unreachable');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore,
    'the target holds no unpublished squash: the pre-flight refuses before anything moves');
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

// ── (f) the remote moves between the pre-flight and the push ────────────────────────────────

test('558f: a remote that accepts the pre-flight but cannot take the squash refuses integrate_publish_failed and rolls the target back', needsGit, async (t) => {
  // Issue #573 revision: the pre-flight moved the unreachable and unauthenticated refusals ahead
  // of the gate run, which left the push's own failure pinned nowhere — the live trigger is the
  // shared remote's target moving while the landing runs, so the real push arrives
  // non-fast-forward. This row restores that pin: the pre-flight passes, the gate run completes,
  // the shared remote's master advances during the gate run, and the push refuses with the
  // target rolled back and no receipt recorded.
  let gatesRan = 0;
  const w = await world(t, {
    bareRemote: true,
    onGates: async () => {
      // The shared remote's master advances while the landing's gate run holds. The side
      // repository shares no history with the fixture's lane work, so the landing's push of the
      // squash can only refuse non-fast-forward.
      gatesRan += 1;
      const side = join(w.directory, 'side');
      execFileSync('git', ['init', '-q', '-b', 'master', side], { env: { ...process.env, ...QUIET_GIT_ENV } });
      git(side, 'config', 'user.name', 'Side Race');
      git(side, 'config', 'user.email', 'side-race@example.invalid');
      write(side, 'UNRELATED.md', 'moved while the gates ran\n');
      git(side, 'add', '-A');
      git(side, 'commit', '-qm', 'unrelated race commit on the shared remote');
      execFileSync('git', ['push', '-q', w.remote, 'master:refs/heads/master'],
        { cwd: side, env: { ...process.env, ...QUIET_GIT_ENV } });
    },
  });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of reporting a local success');
  assert.equal(error.code, 'integrate_publish_failed',
    'the push failure after a successful pre-flight keeps its own refusal code');
  assert.equal(error.detail.script, 'git push', 'the refusal names the real push, never the pre-flight');
  assert.equal(error.detail.rolledBack, true, 'the local move rolled back');
  assert.equal(gatesRan, 1, 'the gate run completed — the failure came after it, at the push');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore,
    'the target holds no unpublished squash: the failed push rolled back');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
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

// ── (e) the deployment's own composition publishes ──────────────────────────────────────────
//
// Rows (a)-(c) hand `integration: {repoRoot, publishRemote}` to the SwarmRuntime CONSTRUCTOR. The
// resident never builds its runtime that way: application.mjs `_swarmRuntime()` assembles the
// landing authority itself and reads the declared remote off `this.driver.integrationPublishRemote`,
// a member createDriver must RETURN. That member is where this deployment's remote went missing —
// the option was validated and handed to the Coordinator, the returned driver object did not carry
// it, so the authority composed publishRemote null and every real landing refused
// integrate_publish_undeclared however the declaration was set. These two rows drive the
// deployment's own composition (createDriver with the option, exactly where openBatonDeployment
// passes it, then BatonApplication and the runtime the application builds), so they fail on a driver
// that drops the member and pass on one that carries it.

const deployedRepoId = 'repo-issue558-deployed';

// The lane change this fixture lands. This path affects no test file (measured with
// selectFromRepository), so the landing's derived gate set is empty and the receipt records the
// skip; these rows pin the PUBLISH half, and the gate half of the same landing is covered by the
// baton tree's own suite. The name deliberately carries no test file's own name: a changed path
// whose name matches one selects that test as a fixture path.
const DEPLOYED_ITEMS = [
  { id: 'publish-step', status: 'delivered', change: 'Publish the landed ref', files: ['docs/deployment-path-proof.md'], test: 'node --test test/issue558-landing-publish.test.mjs', evidence: 'suite green' },
];

const deployedProfile = Object.freeze({
  schemaVersion: 1, repoId: deployedRepoId,
  definitionOfDone: ['the landing publishes the landed ref'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification: Object.freeze({
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  }),
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const seatPrincipal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});

/** The three regenerators a landing runs, as exit-0 stubs: this fixture is about the authority's
 * declared remote, and the real regenerators belong to the baton tree, not to a temporary repo. The
 * supervisor runs each one as `node <script> --write` in the landing checkout. */
const REGENERATOR_STUBS = [
  'impl/scripts/seam-inventory.mjs',
  'impl/scripts/surface-gate.mjs',
  'impl/scripts/render-surface-docs.mjs',
];

/**
 * A real repository, lane branch and bare shared remote, wired the way the DEPLOYMENT wires them:
 * `createDriver` receives the declared remote as an option (as openBatonDeployment passes it), and
 * the landing authority is the one the application assembles in `_swarmRuntime()`. `declareRemote:
 * false` builds the same world over a driver that declares none.
 */
async function deployedWorld(t, { declareRemote = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue558-deployed-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 558');
  git(repo, 'config', 'user.email', 'issue558@example.invalid');
  write(repo, 'README.md', 'base\n');
  for (const script of REGENERATOR_STUBS) write(repo, script, 'process.exit(0);\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'docs/deployment-path-proof.md', 'lane change\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane one (#558)');
  const tip = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const remote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', remote], { env: { ...process.env, ...QUIET_GIT_ENV } });

  const driver = createDriver({
    repoRoot: repo, repoId: deployedRepoId, logDir: join(directory, 'log'),
    adapters: {
      mock: new MockAdapter({
        scenario: { outcome: 'completed' },
        card: { harness: 'mock', version: 'issue558-1', model: 'model-a' },
      }),
    },
    ...(declareRemote ? { integrationPublishRemote: remote } : {}),
  });
  const application = new BatonApplication({
    driver, repoId: deployedRepoId,
    profiles: { standard: deployedProfile },
    principals: {
      planner: seatPrincipal('planner'), dispatcher: seatPrincipal('dispatcher'),
      observer: seatPrincipal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    await application.shutdown(seatPrincipal('cleanup')).catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  });
  await application.ready;

  const actor = seatPrincipal('issue558-deployed');
  await application.command('swarm.create',
    { swarmId: 's1', purpose: 'publish the landing', idempotencyKey: 'i558e:create' }, actor);
  const record = (kind, payload, key) => driver.coordination.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: actor.actor, key: `i558e:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'publish the landing' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'Publish the landed ref', items: DEPLOYED_ITEMS, sha: tip, branch: 'baton/lane-1',
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  return {
    repo, remote, tip, targetHead,
    authority: application._swarmRuntime().integration,
    integrate: () => application.command('swarm.integrate', {
      swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i558e:integrate',
    }, actor),
    foldRow: () => driver.coordination.swarm('s1').contributions['contribution:1'],
  };
}

test('558e: the deployment assembles the declared remote onto the landing authority, and a landing through it publishes', needsGit, async (t) => {
  const w = await deployedWorld(t);
  assert.equal(w.authority.repoRoot, w.repo,
    'the authority the application assembles holds the deployment repository');
  assert.equal(w.authority.publishRemote, w.remote,
    'the declared remote must reach the landing authority through the driver createDriver returns');

  const answer = await w.integrate();
  const local = git(w.repo, 'rev-parse', 'master');
  assert.equal(answer.integration.squashSha, local, 'the squash landed locally through the deployment path');
  const published = execFileSync('git', ['--git-dir', w.remote, 'rev-parse', 'refs/heads/master'], {
    encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
  }).trim();
  assert.equal(published, answer.integration.squashSha,
    'the declared remote holds the landed squash the moment the landing returns');
  assert.equal(w.foldRow().integration.squashSha, answer.integration.squashSha);
});

test('558f: a deployment whose driver declares no remote composes an authority that declares none', needsGit, async (t) => {
  const w = await deployedWorld(t, { declareRemote: false });
  assert.equal(w.authority.publishRemote, null,
    'absence reads as the null that declares none, never as undefined');
  const error = await w.integrate().then(() => null, (thrown) => thrown);
  assert.ok(error, 'the landing refuses instead of reporting a local success');
  assert.equal(error.code, 'integrate_publish_undeclared');
  assert.equal(git(w.repo, 'rev-parse', 'master'), w.targetHead, 'the target is untouched');
});
