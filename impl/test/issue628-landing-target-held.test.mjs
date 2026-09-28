// Issue #628 — a seat's worktree reached HEAD at a new base with an index still at the old one,
// and the commit recorded there carried the old base's content, so its diff against its own
// parent reverted that parent on 19 paths the lane never declared (2026-09-28: rigidity-lead18's
// worktree at HEAD 2e6a7e7f with f154c260's files; the landed 42196dda re-added everything
// 2e6a7e7f had just removed). The state is produced by a ref-only move of a branch a checkout has
// current: `git update-ref refs/heads/<b> <new>` moves that checkout's HEAD while its index and
// files stay where they were. Two rules close the class:
//
//   (a) the landing's fast-forward IS that move, so `swarm.integrate` refuses
//       `integrate_target_held` — naming the holding worktrees — before the ref moves, and the
//       target is untouched;
//   (b) a contribution whose diff against its OWN parent restores the parent's parent content on
//       a path the contribution does not declare refuses `integrate_parent_reverted` before the
//       landing opens: landing it would drop what the parent landed, undeclared.
//
// Every row runs on a real repository, a real linked checkout and the real landing. The rows:
//   628a — a linked checkout has the target branch current: the landing refuses, names it, and
//          the checkout's index still matches its HEAD (nothing moved under it);
//   628b — the same landing with that checkout detached lands: the refusal is the held state, not
//          a blanket refusal of every landing;
//   628c — a lane commit that reverts its own parent on an undeclared path refuses
//          `integrate_parent_reverted`, pre-effect;
//   628d — the same reversion, declared by the contribution, lands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const principal = { actor: 'direct:issue628-root', principalId: 'issue628-root', sessionId: 'issue628-root' };
const GIT_ENV = {
  GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Issue 628', GIT_AUTHOR_EMAIL: 'issue628@example.invalid',
  GIT_COMMITTER_NAME: 'Issue 628', GIT_COMMITTER_EMAIL: 'issue628@example.invalid',
};
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const git = (repo, ...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...GIT_ENV },
}).trim();

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** The path the target lands and a stale-index commit would revert, and the path the lane adds. */
const PARENT_PATH = 'impl/src/parent.mjs';
const LANE_PATH = 'impl/src/lane-one.mjs';

const contractBody = ({ items, sha, observedHead, rebasedOnto }) => ({
  subject: 'Issue 628 landing row',
  base: { observedHead, rebasedOnto },
  commit: { sha, branch: 'baton/lane-1' },
  items,
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/**
 * A real repository with a lane branch, an accepted contribution naming its tip, and — when the
 * row asks for one — a linked checkout that has the target branch current.
 *
 * `parentChange` makes the target land its own file before the lane branches, so the lane's commit
 * has a parent with a delta to revert; `revert` makes the lane commit restore that file to the
 * content the parent's parent had (the stale-index signature). `declared` is what the
 * contribution's contract names; `holder` adds the linked checkout.
 */
async function world(t, {
  parentChange = false, revert = false, declared = [LANE_PATH],
  publishRemote = undefined, bareRemote = false, holder = false,
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue628-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...GIT_ENV } });
  write(repo, 'README.md', 'base\n');
  // The gate set is the runner's own selector over the squash's checkout, so the fixture carries
  // one test file that statically imports the module the lane moves.
  write(repo, 'impl/test/gate-fixture.test.mjs', "import '../src/worktree.mjs';\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');
  if (parentChange) {
    write(repo, PARENT_PATH, '// the target landed this file\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'the target lands its own file');
  }

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, LANE_PATH, '// lane change\n');
  if (revert) git(repo, 'rm', '-q', PARENT_PATH);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane one (#628)');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  let holderDir = null;
  if (holder) {
    // A seat's worktree reaches this state by checking out the base it is about to re-cut from.
    // The main checkout detaches first so the branch is free for the linked one.
    git(repo, 'checkout', '-q', '--detach');
    holderDir = join(directory, 'held-checkout');
    git(repo, 'worktree', 'add', '-q', holderDir, 'master');
  }

  let remote = publishRemote;
  if (bareRemote) {
    remote = join(directory, 'shared.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { env: { ...process.env, ...GIT_ENV } });
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

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the 628 row', idempotencyKey: 'i628:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i628:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the 628 row' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      items: [{ id: 'lane', status: 'delivered', change: 'Land the lane', files: declared,
        test: 'node --test test/issue628-landing-target-held.test.mjs', evidence: 'suite green' }],
      sha: tip, observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i628:integrate', ...args,
  }, principal);
  const foldRow = () => store.swarm('s1').contributions['contribution:1'];
  return { directory, repo, remote, store, runtime, integrate, foldRow, tip, targetHead, holderDir };
}

// ── (a) the target branch is current in a linked checkout ─────────────────────────────────────

test('628a: a landing whose target is checked out in a worktree refuses typed and moves nothing', needsGit, async (t) => {
  const w = await world(t, { holder: true, bareRemote: true });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of moving a branch a checkout holds');
  assert.equal(error.code, 'integrate_target_held');
  const holders = error.detail?.holders ?? [];
  assert.equal(holders.length, 1, 'the refusal names the one holding checkout');
  assert.equal(realpathSync(holders[0]), realpathSync(w.holderDir), 'named by its own path');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
  // The harm the refusal avoids: had the ref moved, the holder's index would still hold the
  // commit it was at and `git status` would show the delta as staged.
  assert.equal(git(w.holderDir, 'status', '--porcelain'), '',
    'the holding checkout still matches its own HEAD');
});

test('628b: the same landing lands once no checkout has the target current', needsGit, async (t) => {
  const w = await world(t, { holder: true, bareRemote: true });
  git(w.repo, 'worktree', 'remove', '--force', w.holderDir);

  const answer = await w.integrate();

  assert.ok(answer.integration?.squashSha, 'the landing completed');
  assert.equal(git(w.repo, 'rev-parse', 'master'), answer.integration.squashSha,
    'the target holds the squash');
});

// ── (b) the contribution reverts its own parent on an undeclared path ─────────────────────────
test('628c: a contribution that reverts its own parent on an undeclared path refuses pre-effect', needsGit, async (t) => {
  const w = await world(t, { parentChange: true, revert: true, declared: [LANE_PATH] });
  const headBefore = git(w.repo, 'rev-parse', 'master');

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses a commit that reverts its parent undeclared');
  assert.equal(error.code, 'integrate_parent_reverted');
  assert.deepEqual(error.detail?.paths, [PARENT_PATH], 'the refusal names the path the target would lose');
  assert.deepEqual(error.detail?.declared, [LANE_PATH], 'and what the contribution did declare');
  assert.equal(git(w.repo, 'rev-parse', 'master'), headBefore, 'the target is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal raised before the landing records no receipt');
  assert.equal(git(w.repo, 'worktree', 'list').includes('integrate-contribution'), false,
    'no scratch checkout was opened');
});

test('628d: the same reversion lands when the contribution declares the path', needsGit, async (t) => {
  const w = await world(t, {
    parentChange: true, revert: true, declared: [LANE_PATH, PARENT_PATH], bareRemote: true,
  });

  const answer = await w.integrate();

  assert.ok(answer.integration?.squashSha, 'the declared reversion lands');
  assert.deepEqual(answer.integration.changedPaths, [LANE_PATH, PARENT_PATH],
    'the squash carries exactly the declared change');
  assert.equal(git(w.repo, 'ls-tree', '--name-only', answer.integration.squashSha, '--', PARENT_PATH), '',
    'the landed commit no longer holds the parent file');
});
