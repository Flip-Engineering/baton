// Issue #596: when the target moves during a landing's gate run, the squash is re-prepared onto
// the new head. A clean rebase lands on the verdict the gate already produced (no re-run). A
// conflicting rebase refuses integrate_target_moved. The receipt carries targetMoveHandled
// with the from/to SHAs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { landContribution } from '../src/worktree.mjs';

const QUIET_GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' };
let HAVE_GIT = false;
try { execFileSync('git', ['--version'], { stdio: 'pipe' }); HAVE_GIT = true; } catch {}
const needsGit = { skip: HAVE_GIT ? false : 'git not found' };

const git = (repo, ...args) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV } }).trim();
const write = (repo, path, content) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};

function setupRepo(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue596-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 596');
  git(repo, 'config', 'user.email', 'issue596@example.invalid');
  write(repo, 'impl/src/coordinator.mjs', 'export const coordinator = "base";\n');
  write(repo, 'impl/src/helper.mjs', 'export const helper = "base";\n');
  write(repo, 'impl/test/coordinator.test.mjs', 'import { coordinator } from "../src/coordinator.mjs";\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const targetHead = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, 'impl/src/coordinator.mjs', 'export const coordinator = "lane";\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane change');
  const tip = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'master');

  const publishRemote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', publishRemote], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'push', '-q', publishRemote, 'master');

  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { repo, tip, targetHead, publishRemote, directory };
}

// ── (a) clean rebase: target moves with a disjoint file, verdict reused ─────────

test('596a: target move with clean rebase lands on the existing verdict', needsGit, async (t) => {
  const { repo, tip, targetHead, publishRemote } = setupRepo(t);

  let gateCallCount = 0;
  const result = await landContribution(repo, {
    contributionId: 'c-596a',
    target: 'master',
    commitSha: tip,
    message: 'lane landing (596a)',
    author: { name: 'lane-a', email: 'lane@example.invalid' },
    committer: { name: 'root', email: 'root@example.invalid' },
    publishRemote,
    runGates: async (dir, changed, context) => {
      gateCallCount++;
      write(repo, 'impl/src/helper.mjs', 'export const helper = "target-moved";\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'target advanced with disjoint file');
      return {
        files: ['test/coordinator.test.mjs'],
        verdictLine: 'green — 1 file(s)',
        unexpected: [],
      };
    },
  });

  assert.equal(gateCallCount, 1, 'the gate ran exactly once — no re-run');
  assert.ok(result.squashSha, 'the squash landed');
  assert.ok(result.gates.targetMoveHandled, 'the receipt carries targetMoveHandled');
  assert.equal(result.gates.targetMoveHandled.from, targetHead);
  assert.equal(typeof result.gates.targetMoveHandled.to, 'string');
  assert.notEqual(result.gates.targetMoveHandled.from, result.gates.targetMoveHandled.to);
});

// ── (b) conflicting rebase: target moves into the lane's file, refuses ──────────

test('596b: target move with conflicting rebase refuses integrate_target_moved', needsGit, async (t) => {
  const { repo, tip, publishRemote } = setupRepo(t);

  const error = await landContribution(repo, {
    contributionId: 'c-596b',
    target: 'master',
    commitSha: tip,
    message: 'lane landing (596b)',
    author: { name: 'lane-a', email: 'lane@example.invalid' },
    committer: { name: 'root', email: 'root@example.invalid' },
    publishRemote,
    runGates: async (dir, changed, context) => {
      write(repo, 'impl/src/coordinator.mjs', 'export const coordinator = "conflict";\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'target advanced with conflicting file');
      return {
        files: ['test/coordinator.test.mjs'],
        verdictLine: 'green — 1 file(s)',
        unexpected: [],
      };
    },
  }).then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.ok(
    error.code === 'integrate_target_moved' || error.code === 'integrate_conflict',
    `refuses with a merge-failure code (got ${error.code})`,
  );
});

// ── (c) receipt shape: targetMoveHandled carries from/to SHAs ────────────────────

test('596c: the receipt carries targetMoveHandled with from and to SHAs', needsGit, async (t) => {
  const { repo, tip, targetHead, publishRemote } = setupRepo(t);

  const result = await landContribution(repo, {
    contributionId: 'c-596c',
    target: 'master',
    commitSha: tip,
    message: 'lane landing (596c)',
    author: { name: 'lane-a', email: 'lane@example.invalid' },
    committer: { name: 'root', email: 'root@example.invalid' },
    publishRemote,
    runGates: async (dir, changed, context) => {
      write(repo, 'docs/unrelated.md', 'documentation\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'target advanced with unrelated file');
      return {
        files: ['test/coordinator.test.mjs'],
        verdictLine: 'green — 1 file(s)',
        unexpected: [],
      };
    },
  });

  assert.ok(result.squashSha, 'the squash landed');
  const handled = result.gates.targetMoveHandled;
  assert.ok(handled, 'targetMoveHandled is present');
  assert.equal(handled.from, targetHead, 'from is the original target head');
  assert.equal(typeof handled.to, 'string', 'to is a SHA');
  assert.notEqual(handled.from, handled.to, 'from and to differ');
  assert.match(handled.to, /^[0-9a-f]{40}$/, 'to is a full SHA');
});
