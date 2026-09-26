// Issue #254 (the operator ruling after the 2026-09-26 observation that a node_modules
// symlink and __pycache__ trees reached branches): build debris must not ride the two paths a
// seat's work takes to a branch. At CAPTURE, the uncommitted snapshot judges its staged
// additions against the deployment repository's own ignore rules — the checkout's copy can be
// stale — and the dropped paths are named on the snapshot commit. At INTEGRATE, the squash
// drops every ADDED path the repository's .gitignore matches, and the landing receipt names
// them beside the landing. Modifications and deletions pass untouched at both sites.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, mkdir as _mkdir } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { landContribution } from '../src/worktree.mjs';
import { WorktreePreserver } from '../src/worktree-preserve.mjs';

const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
}).trim();

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

// ---------------------------------------------------------------------------
// Integrate: the squash drops ignored additions and the receipt names them.
// ---------------------------------------------------------------------------

const LANE_FILE = 'impl/src/lane.mjs';

function landingWorld(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-254-landing-'));
  const repo = join(directory, 'repo');
  const remote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  execFileSync('git', ['init', '-q', '--bare', remote], { env: { ...process.env, ...QUIET_GIT_ENV } });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 254', GIT_COMMITTER_NAME: 'Issue 254' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue254@example.invalid', GIT_COMMITTER_EMAIL: 'issue254@example.invalid' });
  // The lane's checkout predates the __pycache__ rule — its `add -A` staged the debris, the
  // same stale-copy gap the 2026-09-26 branches carried. The target's canonical rules move on.
  write(repo, '.gitignore', 'node_modules/\n');
  write(repo, 'README.md', 'base\n');
  write(repo, LANE_FILE, 'export const lane = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, LANE_FILE, 'export const lane = 2;\n');
  write(repo, '__pycache__/junk.pyc', 'debris\n');
  write(repo, 'notes.txt', 'real work\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane work');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  write(repo, '.gitignore', 'node_modules/\n__pycache__/\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'ignore pycache');
  git(repo, 'checkout', '-q', 'master');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { repo, remote, tip };
}

test('254-a: the landing squash drops ignored additions and the receipt names them', needsGit, async (t) => {
  const w = landingWorld(t);
  const answer = await landContribution(w.repo, {
    contributionId: 'c254', target: 'master', commitSha: w.tip, message: 'lane work',
    publishRemote: w.remote,
    author: { name: 'lane-a', email: 'lane-a@baton.invalid' },
    committer: { name: 'root', email: 'root@baton.invalid' },
    runGates: async () => ({ files: ['test/lane.test.mjs'], verdictLine: 'green', unexpected: [] }),
  });
  assert.deepEqual(answer.debris, ['__pycache__/junk.pyc'],
    'the ignored addition is named on the receipt as dropped');
  assert.equal(answer.changedPaths.includes('__pycache__/junk.pyc'), false,
    'the debris path is not in the landed change set');
  assert.equal(answer.changedPaths.includes(LANE_FILE), true, 'the real work lands');
  assert.equal(answer.changedPaths.includes('notes.txt'), true, 'untracked-but-unignored work lands');
  const tree = git(w.repo, 'ls-tree', '-r', '--name-only', 'master');
  assert.equal(tree.includes('__pycache__/junk.pyc'), false, 'the target branch carries no debris');
  assert.equal(tree.includes('notes.txt'), true);
});

// ---------------------------------------------------------------------------
// Capture: the uncommitted snapshot judges staged additions against the
// deployment repository's own ignore rules, not the checkout's possibly
// stale copy, and names what it dropped on the snapshot commit.
// ---------------------------------------------------------------------------

function preserveWorld(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-254-preserve-'));
  const origin = join(directory, 'origin.git');
  const repoRoot = join(directory, 'repo');
  const worktree = join(directory, 'seat-wt');
  execFileSync('git', ['init', '-q', '--bare', '--initial-branch', 'master', origin], { env: { ...process.env, ...QUIET_GIT_ENV } });
  execFileSync('git', ['init', '-q', '-b', 'master', repoRoot], { env: { ...process.env, ...QUIET_GIT_ENV } });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 254', GIT_COMMITTER_NAME: 'Issue 254' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue254@example.invalid', GIT_COMMITTER_EMAIL: 'issue254@example.invalid' });
  // The seat's base: a .gitignore that does not yet know the debris pattern.
  write(repoRoot, '.gitignore', 'node_modules/\n');
  write(repoRoot, 'file.txt', 'one\n');
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'base');
  git(repoRoot, 'push', '-q', origin, 'master');
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'baton/seat-254', worktree, 'master'], { cwd: repoRoot, env: { ...process.env, ...QUIET_GIT_ENV } });
  // The repository's canonical rules move on; the seat's checkout keeps its stale copy.
  write(repoRoot, '.gitignore', 'node_modules/\n__pycache__/\n');
  git(repoRoot, 'add', '-A');
  git(repoRoot, 'commit', '-qm', 'ignore pycache');
  // The seat's uncommitted state: real work beside build debris its own checkout ignores not.
  write(worktree, 'work.txt', 'real work\n');
  write(join(worktree, '__pycache__'), 'junk.pyc', 'debris\n');
  const rows = [];
  const preserver = new WorktreePreserver({
    repoRoot, remote: origin,
    record: (kind, payload, key) => rows.push({ kind, payload, key }),
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { origin, repoRoot, worktree, preserver, rows };
}

test('254-b: the snapshot judges staged additions against the repository ignore rules and names what it dropped', needsGit, (t) => {
  const w = preserveWorld(t);
  w.preserver.preserveUncommitted({ swarmId: 's254', participantId: 'seat-a', worktree: w.worktree });
  const sha = execFileSync('git', ['--git-dir', w.origin, 'rev-parse', 'refs/baton/preserve/uncommitted/seat-a'], { encoding: 'utf8' }).trim();
  const paths = execFileSync('git', ['--git-dir', w.origin, 'diff-tree', '-r', '--name-only', '--root', sha], { encoding: 'utf8' })
    .split('\n').filter((line) => line.length > 0);
  assert.equal(paths.includes('__pycache__/junk.pyc'), false, 'the debris path is not in the snapshot');
  assert.equal(paths.includes('work.txt'), true, 'the real uncommitted work is');
  const message = execFileSync('git', ['--git-dir', w.origin, 'log', '-1', '--format=%B', sha], { encoding: 'utf8' });
  assert.match(message, /ignored additions dropped: __pycache__\/junk\.pyc/u,
    'the snapshot commit names what the filter dropped');
});
