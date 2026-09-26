// issue603-resume-rebase-bind.test.mjs — issue #603. A seat may re-cut its lane onto a moved
// target, so a checkout whose custody is exact can carry a recorded base its HEAD no longer
// descends from. The bind refused that shape as session_worktree_base_diverged, and a
// --resume-from successor could never inherit the checkout. The rows:
//   - 603a — a history that still shares a fork point with the recorded base (a re-base onto a
//     sibling target) validates ok through the session gate and the owned-worktree gate;
//   - 603b — the same checkout passes the capture-path owned-worktree validation directly;
//   - 603c — a replaced history (an unrelated root commit) still refuses
//     session_worktree_base_diverged: shared history is what separates a re-base from a
//     replacement;
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDriver } from '../src/index.mjs';
import { reap, sparseCheckoutIdentity, validateOwnedWorktree } from '../src/worktree.mjs';

function git(args, cwd, opts = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...opts,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      ...(opts.env ?? {}),
    },
  }).trim();
}

function sessionContext(repo, taskId, handle) {
  return {
    worktree: handle.path,
    repoRoot: repo,
    baseSha: handle.baseSha,
    branch: handle.branch,
    ownerTaskId: handle.ownerTaskId,
    logicalTaskId: handle.logicalTaskId ?? taskId,
    ownerReceiptDigest: handle.ownerReceiptDigest,
    sparsePaths: [...handle.sparsePaths],
  };
}

function codeIs(expected) {
  return (error) => error?.code === expected;
}

test('603: a lane re-cut onto a moved target binds; replacement and rewind keep their refusals', async (t) => {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue603-'));
  const repo = join(world, 'repo');
  const logDir = join(world, 'driver-log');
  mkdirSync(repo);
  const driver = createDriver({ repoRoot: repo, logDir, adapters: {}, workerSparsePaths: [] });
  const taskId = 'issue603-lane';
  let handle;
  t.after(async () => {
    if (handle) { try { await reap(repo, taskId, { force: true, deleteBranch: true }); } catch { /* fixture root is removed below */ } }
    try { driver.close(); } catch { /* evidence root cleanup below remains */ }
    rmSync(world, { recursive: true, force: true });
  });
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Issue 603'], repo);
  git(['config', 'user.email', 'issue603@example.invalid'], repo);
  const write = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  write('src/main.js', 'export const value = 1;\n');
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'issue603 trunk'], repo);
  const trunk = git(['rev-parse', 'HEAD'], repo);
  write('src/main.js', 'export const value = 2;\n');
  git(['commit', '-qam', 'issue603 lane base'], repo);
  const laneBase = git(['rev-parse', 'HEAD'], repo);
  write('src/main.js', 'export const value = 3;\n');
  git(['commit', '-qam', 'issue603 admitted head'], repo);
  const admitted = git(['rev-parse', 'HEAD'], repo);

  handle = await driver.coordinator._worktrees.create(taskId, admitted);
  assert.equal(handle.baseSha, admitted);
  const context = sessionContext(repo, taskId, handle);

  // 603a — the seat re-cuts its lane onto a sibling target: a commit beside the recorded base,
  // sharing the trunk. Neither revision contains the other, but the histories keep their fork
  // point, and the bind admits the checkout.
  const recut = git(['commit-tree', git(['rev-parse', 'HEAD^{tree}'], repo), '-p', trunk, '-m',
    'issue603 re-cut onto moved target'], repo);
  git(['checkout', '-q', '-B', handle.branch, recut], handle.path);
  assert.deepEqual(await driver.coordinator._worktrees.validateSessionContext(context), { ok: true });
  await driver.coordinator._validateSessionContext(context);

  // 603b — the capture-path owned-worktree gate admits the same re-cut checkout.
  validateOwnedWorktree(repo, handle.ownerTaskId, {
    expectedBaseSha: handle.baseSha,
    expectedBranch: handle.branch,
    sparseCheckoutIdentity: sparseCheckoutIdentity([]),
  });

  // 603c — a replaced history shares nothing with the recorded base and still refuses by name.
  const orphan = git(['commit-tree', git(['rev-parse', 'HEAD^{tree}'], handle.path), '-m',
    'issue603 unrelated root'], repo);
  git(['checkout', '-q', '-B', handle.branch, orphan], handle.path);
  const divergedVerdict = await driver.coordinator._worktrees.validateSessionContext(context);
  assert.equal(divergedVerdict.ok, false);
  assert.equal(divergedVerdict.code, 'session_worktree_base_diverged');
  await assert.rejects(() => driver.coordinator._validateSessionContext(context),
    codeIs('session_worktree_base_diverged'));

  // 603d — a rewound history keeps its own refusal.
  git(['reset', '--hard', laneBase], handle.path);
  const rewoundVerdict = await driver.coordinator._worktrees.validateSessionContext(context);
  assert.equal(rewoundVerdict.ok, false);
  assert.equal(rewoundVerdict.code, 'session_worktree_base_rewound');
});
