import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { realpathSync } from 'node:fs';

import { WORKTREE_GIT_SHARING, createFromBase, reap } from '../src/worktree.mjs';

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

function fixture(label) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue412-${label}-`));
  const repo = join(world, 'repo');
  try {
    mkdirSync(repo);
    git(['init', '-q'], repo);
    git(['config', 'user.name', 'Baton Issue 412'], repo);
    git(['config', 'user.email', 'issue412@example.invalid'], repo);
    writeFileSync(join(repo, 'README.md'), '# issue 412 fixture\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'issue 412 base'], repo);
    return { world, repo, baseSha: git(['rev-parse', 'HEAD'], repo) };
  } catch (error) {
    rmSync(world, { recursive: true, force: true });
    throw error;
  }
}

function commonDir(cwd) {
  return realpathSync(pathResolve(cwd, git(['rev-parse', '--git-common-dir'], cwd)));
}

test('issue 412: the creation seam states workspace separation is not git-ref isolation', () => {
  assert.equal(WORKTREE_GIT_SHARING.refNamespace, 'shared');
  assert.equal(WORKTREE_GIT_SHARING.objectStore, 'shared');
  assert.match(WORKTREE_GIT_SHARING.statement, /not git-ref isolation/);
  assert.match(WORKTREE_GIT_SHARING.statement, /repo-visible/);
  assert.match(WORKTREE_GIT_SHARING.statement, /object store/);
  assert.equal(WORKTREE_GIT_SHARING.branchForTask('t1'), 'baton/t1');
});

test('issue 412: a lane checkout publishes a repo-visible ref sharing the object store', async (t) => {
  const { world, repo, baseSha } = fixture('ref-visibility');
  const taskId = 'ref-visibility';
  const handle = await createFromBase(repo, taskId, baseSha);
  t.after(async () => {
    try { await reap(repo, taskId, { force: true, deleteBranch: true }); } catch { /* fixture root is removed below */ }
    rmSync(world, { recursive: true, force: true });
  });

  assert.equal(
    git(['rev-parse', '--verify', `refs/heads/${WORKTREE_GIT_SHARING.branchForTask(taskId)}`], repo),
    git(['rev-parse', 'HEAD'], handle.dir),
    'the lane branch ref is visible from the repository main checkout',
  );
  assert.equal(
    commonDir(handle.dir),
    commonDir(repo),
    'the lane checkout shares the repository object store',
  );
  assert.ok(
    dirname(realpathSync(handle.dir)) === realpathSync(join(repo, '.baton', 'wt')),
    'workspace separation still holds at the filesystem level: the checkout lives under .baton/wt/',
  );
});
