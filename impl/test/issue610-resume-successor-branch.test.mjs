// issue610-resume-successor-branch.test.mjs — issue #610. The owned-worktree gate compared the
// checkout's CURRENT branch to the branch its metadata recorded at creation, so a lane that moved
// its checkout onto its lane branch left a workspace no later admission could validate: the 18:27Z
// restart refused a --resume-from successor on its predecessor's workspace with "owned worktree
// branch identity mismatch" (coordination seq 328923 and 329381). The rows:
//   - 610a — a checkout moved onto another branch off its recorded base is admitted by the
//     session-context gate;
//   - 610b — the capture-path owned-worktree validation admits the same checkout, so a successor
//     working in it captures its work;
//   - 610c — a replaced history still refuses session_worktree_base_diverged: the branch name was
//     never what separated a re-cut from a replacement.
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

test('610: a resume-from successor is admitted on a predecessor checkout moved to its lane branch', async (t) => {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue610-'));
  const repo = join(world, 'repo');
  const logDir = join(world, 'driver-log');
  mkdirSync(repo);
  const driver = createDriver({ repoRoot: repo, logDir, adapters: {}, workerSparsePaths: [] });
  const taskId = 'issue610-ws';
  const laneBranch = 'baton/issue610-lane';
  let handle;
  t.after(async () => {
    if (handle) { try { await reap(repo, taskId, { force: true, deleteBranch: true }); } catch { /* fixture root is removed below */ } }
    try { driver.close(); } catch { /* evidence root cleanup below remains */ }
    rmSync(world, { recursive: true, force: true });
  });
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Issue 610'], repo);
  git(['config', 'user.email', 'issue610@example.invalid'], repo);
  const write = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  write('src/main.js', 'export const value = 1;\n');
  git(['add', '-A'], repo);
  git(['commit', '-qm', 'issue610 trunk'], repo);
  write('src/main.js', 'export const value = 2;\n');
  git(['commit', '-qam', 'issue610 admitted head'], repo);
  const admitted = git(['rev-parse', 'HEAD'], repo);

  handle = await driver.coordinator._worktrees.create(taskId, admitted);
  assert.equal(handle.baseSha, admitted);
  assert.match(handle.branch, /^baton\//u);
  // The predecessor moves its own checkout onto its lane branch. The recorded metadata keeps the
  // branch the worktree was created on, so the two names differ from here on.
  git(['checkout', '-q', '-B', laneBranch, admitted], handle.path);
  assert.equal(git(['branch', '--show-current'], handle.path), laneBranch);
  assert.notEqual(laneBranch, handle.branch);
  const context = sessionContext(repo, taskId, handle);

  // 610a — the session-context admission the 18:27Z restart refused.
  assert.deepEqual(await driver.coordinator._worktrees.validateSessionContext(context), { ok: true });
  await driver.coordinator._validateSessionContext(context);

  // 610b — a successor working in the checkout captures it: the capture path pins the branch the
  // session context names, which is the one the workspace recorded.
  validateOwnedWorktree(repo, handle.ownerTaskId, {
    expectedBaseSha: handle.baseSha,
    expectedBranch: handle.branch,
    sparseCheckoutIdentity: sparseCheckoutIdentity([]),
  });

  // 610c — a replaced history shares nothing with the recorded base and still refuses by name.
  const orphan = git(['commit-tree', git(['rev-parse', 'HEAD^{tree}'], handle.path), '-m',
    'issue610 unrelated root'], repo);
  git(['checkout', '-q', '-B', laneBranch, orphan], handle.path);
  const divergedVerdict = await driver.coordinator._worktrees.validateSessionContext(context);
  assert.equal(divergedVerdict.ok, false);
  assert.equal(divergedVerdict.code, 'session_worktree_base_diverged');
  await assert.rejects(() => driver.coordinator._validateSessionContext(context),
    (error) => error?.code === 'session_worktree_base_diverged');
});
