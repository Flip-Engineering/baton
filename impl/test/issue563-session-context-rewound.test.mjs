// issue563-session-context-rewound.test.mjs — issue #563. A recorded session context whose commit
// is no longer an ancestor of the worktree's HEAD answers one generic `session_context_mismatch`,
// which names neither the revision that failed nor the direction it failed in. It is three
// different facts with three different remedies, and each row below pins one of them:
//   - session_worktree_base_rewound  — HEAD is an ancestor of the recorded base, so the branch
//     moved BEHIND the commit the session was admitted on (the issue's case);
//   - session_worktree_base_diverged — neither revision contains the other;
//   - session_worktree_base_unknown  — the recorded base is not a commit in this repository.
// 563a is the control: a context whose recorded base still contains HEAD keeps validating ok, so
// the classification provably narrows nothing on the happy path.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createDriver } from '../src/index.mjs';
import { reap } from '../src/worktree.mjs';

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

function write(root, relativePath, content) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

/** Two commits, so the worktree's recorded base has an ancestor to be rewound to. */
function fixture(label) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue563-${label}-`));
  const repo = join(world, 'repo');
  try {
    mkdirSync(repo);
    git(['init', '-q'], repo);
    git(['config', 'user.name', 'Baton Issue 563'], repo);
    git(['config', 'user.email', 'issue563@example.invalid'], repo);
    write(repo, 'src/main.js', 'export const value = 1;\n');
    git(['add', '-A'], repo);
    git(['commit', '-qm', 'issue563 lane base'], repo);
    const laneBase = git(['rev-parse', 'HEAD'], repo);
    write(repo, 'src/main.js', 'export const value = 2;\n');
    git(['commit', '-qam', 'issue563 admitted head'], repo);
    const admitted = git(['rev-parse', 'HEAD'], repo);
    return { world, repo, laneBase, admitted };
  } catch (error) {
    rmSync(world, { recursive: true, force: true });
    throw error;
  }
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

test('563: a recorded context base carries a named verdict for each way it can fail', async (t) => {
  const { world, repo, laneBase, admitted } = fixture('named-base-verdict');
  const logDir = mkdtempSync(join(tmpdir(), 'baton-issue563-driver-'));
  const driver = createDriver({ repoRoot: repo, logDir, adapters: {}, workerSparsePaths: [] });
  const taskId = 'issue563-lane';
  let handle;
  t.after(async () => {
    if (handle) { try { await reap(repo, taskId, { force: true, deleteBranch: true }); } catch { /* fixture root is removed below */ } }
    try { driver.close(); } catch { /* evidence root cleanup below remains */ }
    rmSync(logDir, { recursive: true, force: true });
    rmSync(world, { recursive: true, force: true });
  });

  handle = await driver.coordinator._worktrees.create(taskId, admitted);
  assert.equal(handle.baseSha, admitted);

  // 563a — the control: an untouched worktree whose recorded base contains HEAD validates ok, and
  // the coordinator's own gate admits it.
  const context = sessionContext(repo, taskId, handle);
  assert.deepEqual(await driver.coordinator._worktrees.validateSessionContext(context), { ok: true });
  await driver.coordinator._validateSessionContext(context);

  // 563b — the branch rewound behind the recorded base. The verdict names the rewind and both
  // revisions, and the coordinator's gate crosses that code instead of the generic mismatch.
  git(['reset', '--hard', laneBase], handle.path);
  const rewoundVerdict = await driver.coordinator._worktrees.validateSessionContext(context);
  assert.equal(rewoundVerdict.ok, false);
  assert.equal(rewoundVerdict.code, 'session_worktree_base_rewound');
  assert.match(rewoundVerdict.reason, new RegExp(laneBase, 'u'));
  assert.match(rewoundVerdict.reason, new RegExp(admitted, 'u'));
  await assert.rejects(() => driver.coordinator._validateSessionContext(context), (error) => {
    assert.notEqual(error.code, 'session_context_mismatch',
      'a rewind is its own fact, never the generic session context mismatch');
    assert.equal(error.code, 'session_worktree_base_rewound');
    assert.match(error.message, new RegExp(laneBase, 'u'));
    assert.match(error.message, new RegExp(admitted, 'u'));
    return true;
  });

  // 563d — histories that contain neither of each other. An unrelated root commit leaves the
  // recorded base present and unreachable in both directions.
  const orphan = git(['commit-tree', `${git(['rev-parse', 'HEAD^{tree}'], handle.path)}`, '-m',
    'issue563 unrelated root'], repo);
  git(['checkout', '-q', '-B', handle.branch, orphan], handle.path);
  const divergedVerdict = await driver.coordinator._worktrees.validateSessionContext(context);
  assert.equal(divergedVerdict.ok, false);
  assert.equal(divergedVerdict.code, 'session_worktree_base_diverged');
  assert.match(divergedVerdict.reason, new RegExp(orphan, 'u'));
  assert.match(divergedVerdict.reason, new RegExp(admitted, 'u'));
  await assert.rejects(() => driver.coordinator._validateSessionContext(context),
    codeIs('session_worktree_base_diverged'));

  // 563c — a recorded base that is not a commit in this repository says so, and names both sides.
  // A context carrying a physical-owner receipt is bound to the receipt's own base first (that
  // check answers `session physical workspace owner receipt mismatch`), so this row uses the
  // receipt-less context shape the validator also admits.
  const receiptless = {
    worktree: context.worktree, repoRoot: context.repoRoot, baseSha: context.baseSha,
    branch: context.branch, sparsePaths: context.sparsePaths,
  };
  const unknown = { ...receiptless, baseSha: '0'.repeat(40) };
  const unknownVerdict = await driver.coordinator._worktrees.validateSessionContext(unknown);
  assert.equal(unknownVerdict.ok, false);
  assert.equal(unknownVerdict.code, 'session_worktree_base_unknown');
  assert.match(unknownVerdict.reason, new RegExp(unknown.baseSha, 'u'));
  assert.match(unknownVerdict.reason, new RegExp(git(['rev-parse', 'HEAD'], handle.path), 'u'));
  await assert.rejects(() => driver.coordinator._validateSessionContext(unknown),
    codeIs('session_worktree_base_unknown'));
});
