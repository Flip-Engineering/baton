// Issue #596: a landing whose target moves during its gate reuses the verdict when the target's
// delta does not touch the gate selection's covered surface, re-runs only the affected tests
// when part of the surface is touched, and refuses when the re-run is red.
//
// (a) target move with disjoint delta — verdict reused, no re-run
// (b) target move touching covered surface — affected tests re-run, verdict combined
// (c) target move touching covered surface, re-run red — refuses integrate_gates_red

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

// ── (a) disjoint delta ──────────────────────────────────────────────────────────

test('596a: target move with disjoint delta keeps the gate verdict', needsGit, async (t) => {
  const { repo, tip, publishRemote } = setupRepo(t);

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
      if (context?.rerunSubset) {
        throw new Error('re-run should not be called for a disjoint delta');
      }
      gateCallCount++;
      write(repo, 'docs/unrelated.md', 'documentation\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'target advanced with unrelated file');
      return {
        files: ['test/coordinator.test.mjs'],
        verdictLine: 'green — 1 file(s)',
        unexpected: [],
        coveredPaths: ['impl/src/coordinator.mjs', 'impl/test/coordinator.test.mjs'],
        testDeps: {
          'test/coordinator.test.mjs': ['impl/test/coordinator.test.mjs', 'impl/src/coordinator.mjs'],
        },
      };
    },
  });

  assert.equal(gateCallCount, 1, 'the gate ran exactly once');
  assert.ok(result.squashSha, 'the squash landed');
  assert.ok(result.gates.targetMoveHandled, 'the receipt names the handled target move');
  assert.deepStrictEqual(result.gates.targetMoveHandled.rerun, [], 'no tests were re-run');
  assert.deepStrictEqual(result.gates.targetMoveHandled.reused, ['test/coordinator.test.mjs']);
  assert.deepStrictEqual(result.gates.targetMoveHandled.delta, ['docs/unrelated.md']);
});

// ── (b) intersecting delta, re-run green ─────────────────────────────────────────

test('596b: target move touching covered surface re-runs only the affected tests', needsGit, async (t) => {
  const { repo, tip, publishRemote } = setupRepo(t);

  let rerunCalled = false;
  const result = await landContribution(repo, {
    contributionId: 'c-596b',
    target: 'master',
    commitSha: tip,
    message: 'lane landing (596b)',
    author: { name: 'lane-a', email: 'lane@example.invalid' },
    committer: { name: 'root', email: 'root@example.invalid' },
    publishRemote,
    runGates: async (dir, changed, context) => {
      if (context?.rerunSubset) {
        rerunCalled = true;
        assert.deepStrictEqual(context.rerunSubset, ['test/coordinator.test.mjs']);
        return {
          files: context.rerunSubset,
          verdictLine: 'green — 1 file(s) (re-run)',
          unexpected: [],
        };
      }
      write(repo, 'impl/src/helper.mjs', 'export const helper = "target-moved";\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'target advanced with covered file');
      return {
        files: ['test/coordinator.test.mjs'],
        verdictLine: 'green — 1 file(s)',
        unexpected: [],
        coveredPaths: ['impl/src/coordinator.mjs', 'impl/test/coordinator.test.mjs', 'impl/src/helper.mjs'],
        testDeps: {
          'test/coordinator.test.mjs': ['impl/test/coordinator.test.mjs', 'impl/src/coordinator.mjs', 'impl/src/helper.mjs'],
        },
      };
    },
  });

  assert.ok(rerunCalled, 'the affected tests were re-run');
  assert.ok(result.squashSha, 'the squash landed');
  assert.ok(result.gates.targetMoveHandled, 'the receipt names the handled target move');
  assert.deepStrictEqual(result.gates.targetMoveHandled.rerun, ['test/coordinator.test.mjs']);
  assert.deepStrictEqual(result.gates.targetMoveHandled.reused, []);
  assert.equal(result.gates.targetMoveHandled.rerunVerdictLine, 'green — 1 file(s) (re-run)');
});

// ── (c) intersecting delta, re-run red ───────────────────────────────────────────

test('596c: target move re-run failure refuses integrate_gates_red', needsGit, async (t) => {
  const { repo, tip, publishRemote } = setupRepo(t);

  const error = await landContribution(repo, {
    contributionId: 'c-596c',
    target: 'master',
    commitSha: tip,
    message: 'lane landing (596c)',
    author: { name: 'lane-a', email: 'lane@example.invalid' },
    committer: { name: 'root', email: 'root@example.invalid' },
    publishRemote,
    runGates: async (dir, changed, context) => {
      if (context?.rerunSubset) {
        return {
          files: context.rerunSubset,
          verdictLine: 'red — 1 file(s)',
          unexpected: [{ file: 'test/coordinator.test.mjs', row: 'FAIL' }],
        };
      }
      write(repo, 'impl/src/helper.mjs', 'export const helper = "target-moved";\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-qm', 'target advanced with covered file');
      return {
        files: ['test/coordinator.test.mjs'],
        verdictLine: 'green — 1 file(s)',
        unexpected: [],
        coveredPaths: ['impl/src/coordinator.mjs', 'impl/test/coordinator.test.mjs', 'impl/src/helper.mjs'],
        testDeps: {
          'test/coordinator.test.mjs': ['impl/test/coordinator.test.mjs', 'impl/src/coordinator.mjs', 'impl/src/helper.mjs'],
        },
      };
    },
  }).then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refuses');
  assert.equal(error.code, 'integrate_gates_red');
  assert.equal(error.unexpected.length, 1);
});
