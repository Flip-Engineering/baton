// Issue #570 — the integrate landing resolved its target head from the deployment's LOCAL target
// ref. When the local ref drifted behind the declared publish remote (the resident's own master
// sat six commits behind origin/master), the squash descended from the stale head, the push to the
// declared remote refused as a non-fast-forward, and the landing rolled itself back — the operator
// had to fetch by hand before any landing could publish. The fix: a real landing with a declared
// shared remote fetches the remote's target branch first, requires the local ref to be an ancestor
// of the fetched tip (refusing typed when the two have diverged), builds the squash on the fetched
// tip, and brings the local ref to the landed squash as part of the same landing.
//
// Every row below runs on a REAL temporary repository with a REAL lane branch and a REAL bare
// repository as the declared shared remote, following the issue558 fixture conventions:
//
//   (a) a landing whose local target ref is behind the declared remote's tip lands on the fetched
//       tip: the local ref and the remote tip both end at the landed squash;
//   (b) a target that has diverged from the declared remote (each side holds a commit the other
//       lacks) refuses `integrate_target_diverged` naming both heads, and nothing moves.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const principal = { actor: 'direct:issue570-root', principalId: 'issue570-root', sessionId: 'issue570-root' };
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
  { id: 'remote-tip-gate', status: 'delivered', change: 'Gate the landing on the fetched remote tip', files: ['impl/src/worktree.mjs'], test: 'node --test test/issue570-landing-fetches-remote-tip.test.mjs', evidence: 'suite green' },
];

/**
 * A real repository with a target branch and a lane branch, an accepted contribution naming the
 * lane tip, and a bare repository as the deployment's declared shared remote holding the target.
 * `advanceRemote` pushes one commit to the bare remote that the local ref lacks (the #570 drift);
 * `advanceLocal` commits one local-only commit on the target (the divergence case).
 */
async function world(t, { advanceRemote = false, advanceLocal = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue570-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 570');
  git(repo, 'config', 'user.email', 'issue570@example.invalid');
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const observedHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/worktree.mjs', '// lane change\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane one (#570)');
  const tip = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');

  const remote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', remote], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/master');
  git(repo, 'push', '-q', remote, 'master:master');

  let remoteTip = targetHead;
  if (advanceRemote) {
    // The remote tip moves one commit past the local ref — the drift the resident woke to.
    const advance = join(directory, 'advance');
    execFileSync('git', ['clone', '-q', remote, advance], { env: { ...process.env, ...QUIET_GIT_ENV } });
    git(advance, 'config', 'user.name', 'Issue 570 remote');
    git(advance, 'config', 'user.email', 'issue570-remote@example.invalid');
    write(advance, 'REMOTE_NOTE.md', 'landed on the shared remote ahead of the deployment\n');
    git(advance, 'add', '-A');
    git(advance, 'commit', '-qm', 'remote advance (#570)');
    git(advance, 'push', '-q', 'origin', 'master');
    remoteTip = git(remote, 'rev-parse', 'refs/heads/master');
    rmSync(advance, { recursive: true, force: true });
  }

  let localHead = targetHead;
  if (advanceLocal) {
    write(repo, 'LOCAL_NOTE.md', 'committed on the deployment target ahead of the shared remote\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'local-only advance (#570)');
    localHead = git(repo, 'rev-parse', 'master');
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
      publishRemote: remote,
      regenerate: async () => {},
      runGates: async (dir, files) => ({ files, verdictLine: `green — ${files.length} file(s)`, unexpected: [] }),
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });

  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land on the remote tip', idempotencyKey: 'i570:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i570:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land on the remote tip' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({
      subject: 'Gate the landing on the fetched remote tip', items: ITEMS, sha: tip, branch: 'baton/lane-1',
      observedHead, rebasedOnto: targetHead,
    }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' },
    'accept');

  const integrate = (args = {}) => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i570:integrate', ...args,
  }, principal);
  const foldRow = () => store.swarm('s1').contributions['contribution:1'];
  const remoteMaster = () => git(remote, 'rev-parse', 'refs/heads/master');
  return { directory, repo, remote, store, runtime, integrate, foldRow, remoteMaster, tip, targetHead, observedHead, remoteTip, localHead };
}

// ── (a) the local target ref is behind the declared remote's tip ─────────────────────────────

test('570a: a landing whose local target ref is behind the declared remote lands on the fetched tip', needsGit, async (t) => {
  const w = await world(t, { advanceRemote: true });
  assert.equal(git(w.repo, 'rev-parse', 'master'), w.targetHead, 'the fixture leaves the local ref behind');

  const answer = await w.integrate();

  const local = git(w.repo, 'rev-parse', 'master');
  assert.equal(local, answer.integration.squashSha,
    'the local target ref ends at the landed squash, not at the stale head it held');
  assert.equal(w.remoteMaster(), answer.integration.squashSha,
    'the declared remote holds the landed squash the moment the landing returns');
  assert.equal(answer.integration.targetHeadBefore, w.targetHead,
    'the receipt names the head the local ref held before the landing');
  // The squash descends from the fetched tip: the landing based the change on the remote's head.
  execFileSync('git', ['merge-base', '--is-ancestor', w.remoteTip, answer.integration.squashSha], {
    cwd: w.repo, env: { ...process.env, ...QUIET_GIT_ENV },
  });
  assert.equal(w.foldRow().integration.squashSha, answer.integration.squashSha);
});

// ── (b) the local target ref and the remote tip have diverged ────────────────────────────────

test('570b: a target diverged from the declared remote refuses typed naming both heads and moves nothing', needsGit, async (t) => {
  const w = await world(t, { advanceRemote: true, advanceLocal: true });

  const error = await w.integrate().then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses instead of dropping either side\'s commit');
  assert.equal(error.code, 'integrate_target_diverged');
  assert.equal(error.detail.localSha, w.localHead, 'the refusal names the local head');
  assert.equal(error.detail.fetchedSha, w.remoteTip, 'the refusal names the fetched remote tip');
  assert.equal(git(w.repo, 'rev-parse', 'master'), w.localHead, 'the local target is untouched');
  assert.equal(w.remoteMaster(), w.remoteTip, 'the remote tip is untouched');
  assert.equal(w.foldRow().integration, undefined, 'a refusal records no receipt');
});
