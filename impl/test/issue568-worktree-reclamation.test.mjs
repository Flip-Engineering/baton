import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  allocatePhysicalWorkspaceOwner, applySnapshotToWorktree, createFromBase,
  markStopped, physicalWorkspaceOwnerReceipt, reap, reconcile,
  seatLinkedWorktreeOwnershipPath,
} from '../src/worktree.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';

const testRoot = dirname(fileURLToPath(import.meta.url));
const git = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');

function processStart() {
  return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function authority(deployment, controller) {
  return {
    deploymentId: digest(deployment), controllerId: digest(controller),
    pid: process.pid, pidStart: processStart(),
  };
}

function fixture(t, label) {
  // Issue #568 fixtures stay inside this checkout. The test removes the exact directory it owns.
  const world = mkdtempSync(join(testRoot, `.issue568-${label}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 568 Fixture']);
  git(repo, ['config', 'user.email', 'issue568@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-qm', 'base']);
  t.after(() => rmSync(world, { recursive: true, force: true }));
  return { repo, baseSha: git(repo, ['rev-parse', 'HEAD']) };
}

function ownerBinding(baseSha, suffix = 'owner') {
  return {
    runId: `run-${suffix}`, attemptId: `attempt-${suffix}`,
    logicalTaskId: `task-${suffix}`, processGeneration: 1, baseSha,
  };
}

async function ownedWorkspace(f, before, suffix) {
  const receipt = allocatePhysicalWorkspaceOwner(
    f.repo, ownerBinding(f.baseSha, suffix), before,
  );
  const created = await createFromBase(
    f.repo, receipt.physicalOwnerId, f.baseSha, { ownerReceipt: receipt },
  );
  return { receipt: created.ownerReceipt, ...created };
}

function projectedSeat(f, workspace, workerId = 'issue568-seat') {
  const runtime = new RuntimeIsolation({
    repoRoot: f.repo,
    root: join(f.repo, '.baton', 'runtime-568'),
    baseEnv: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: join(f.repo, '.operator-home') },
  });
  const lease = runtime.create(workerId, { card: { harness: 'omp' } });
  assert.equal(runtime.projectCheckout(workerId, workspace.dir), true);
  return { runtime, lease, git: join(lease.paths.bin, 'git') };
}

function addLinkedWorktree(seat, workspace, path, args = ['--detach']) {
  execFileSync(seat.git, ['worktree', 'add', ...args, path, 'HEAD'], {
    cwd: workspace.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...seat.lease.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  return JSON.parse(readFileSync(
    seatLinkedWorktreeOwnershipPath(dirname(dirname(dirname(workspace.dir))), workspace.receipt.physicalOwnerId),
    'utf8',
  ).trim());
}

function expectedOwner(receipt) {
  const ownerBound = {
    schemaVersion: 1,
    physicalOwnerId: receipt.physicalOwnerId,
    receiptDigest: receipt.receiptDigest,
    logicalTaskId: receipt.logicalTaskId,
    runId: receipt.runId,
    attemptId: receipt.attemptId,
    processGeneration: receipt.processGeneration,
    branch: receipt.branch,
    worktree: receipt.worktree,
    baseSha: receipt.baseSha,
    deploymentId: receipt.deploymentId,
    controllerId: receipt.controllerId,
  };
  return {
    expectationId: receipt.attemptId,
    handleRunId: receipt.runId,
    physicalOwnerId: receipt.physicalOwnerId,
    binding: {
      physicalOwnerId: receipt.physicalOwnerId,
      receiptDigest: receipt.receiptDigest,
      logicalTaskId: receipt.logicalTaskId,
      runId: receipt.runId,
      attemptId: receipt.attemptId,
      processGeneration: receipt.processGeneration,
      branch: receipt.branch,
      worktree: receipt.worktree,
      baseSha: receipt.baseSha,
      ownerBound,
    },
  };
}

test('568-A: restart captures a dead local owner, reclaims its checkout, and keeps its branch', async (t) => {
  const f = fixture(t, 'capture');
  const before = authority('stable-deployment', 'controller-before');
  const after = authority('stable-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'dirty');
  writeFileSync(join(workspace.dir, 'base.txt'), 'base edited before the crash\n');
  writeFileSync(join(workspace.dir, 'untracked.txt'), 'uncommitted evidence\n');

  const events = [];
  const settled = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: (physicalOwnerId) => {
      settled.push(physicalOwnerId);
      return true;
    },
    log: { append: (event) => events.push(event) },
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.retainedContentOwners, []);
  assert.deepEqual(report.removedPhysicalOwners, [workspace.receipt.physicalOwnerId]);
  assert.deepEqual(settled, [workspace.receipt.physicalOwnerId]);
  assert.equal(existsSync(workspace.dir), false, 'the checkout storage is reclaimed');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null,
    'the released checkout leaves no owner receipt');

  const removed = report.removedWorkspaces.find(
    (row) => row.physicalOwnerId === workspace.receipt.physicalOwnerId,
  );
  assert.ok(removed?.snapshot, 'the removal report names the preserved commit');
  assert.equal(git(f.repo, ['rev-parse', workspace.branch]), removed.snapshot);
  assert.equal(git(f.repo, ['show', `${removed.snapshot}:base.txt`]), 'base edited before the crash');
  assert.equal(git(f.repo, ['show', `${removed.snapshot}:untracked.txt`]), 'uncommitted evidence');
  assert.ok(events.some((event) => event.kind === 'worktree.snapshotted'
    && event.payload?.sha === removed.snapshot));
  assert.ok(events.some((event) => event.kind === 'worktree.removed'
    && event.payload?.snapshot === removed.snapshot));

  const successorReceipt = allocatePhysicalWorkspaceOwner(
    f.repo, ownerBinding(f.baseSha, 'successor'), after,
  );
  const successor = await createFromBase(
    f.repo, successorReceipt.physicalOwnerId, f.baseSha, { ownerReceipt: successorReceipt },
  );
  assert.deepEqual(
    applySnapshotToWorktree(f.repo, removed.snapshot, successor.dir, f.baseSha),
    ['base.txt', 'untracked.txt'],
  );
  assert.equal(readFileSync(join(successor.dir, 'base.txt'), 'utf8'),
    'base edited before the crash\n');
  assert.equal(readFileSync(join(successor.dir, 'untracked.txt'), 'utf8'),
    'uncommitted evidence\n');
});

test('568-B: active and shared workspaces remain under their existing custody', async (t) => {
  const f = fixture(t, 'live');
  const current = authority('live-deployment', 'live-controller');
  const active = await ownedWorkspace(f, current, 'active');
  const shared = await ownedWorkspace(f, current, 'shared');
  const activeExpectation = expectedOwner(active.receipt);
  const sharedSeat = projectedSeat(f, shared, 'issue568-shared-seat');
  const sharedExternal = join(dirname(f.repo), 'shared-seat-external');
  addLinkedWorktree(sharedSeat, shared, sharedExternal, ['-b', 'shared-scratch']);

  const report = reconcile(f.repo, [active.receipt.physicalOwnerId], {
    ownerAuthority: current,
    snapshotUncommitted: true,
    expectedOwnerBindings: [activeExpectation],
    custodyHolders: (physicalOwnerId) => (
      physicalOwnerId === shared.receipt.physicalOwnerId ? ['live-peer'] : []
    ),
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.validatedExpectedOwners, [active.receipt.physicalOwnerId]);
  assert.equal(existsSync(active.dir), true, 'the active owner keeps its checkout');
  assert.equal(existsSync(shared.dir), true, 'the shared checkout remains while a holder is live');
  assert.equal(existsSync(sharedExternal), true,
    'a linked checkout remains while its physical owner has another live holder');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === shared.receipt.physicalOwnerId
    && row.code === 'workspace_other_holder_live_retained'));
});

test('568-C: recovery retains ignored evidence that the snapshot policy cannot attribute', async (t) => {
  const f = fixture(t, 'ignored');
  writeFileSync(join(f.repo, '.gitignore'), '.env\n');
  git(f.repo, ['add', '.gitignore']);
  git(f.repo, ['commit', '-qm', 'ignore local environment']);
  f.baseSha = git(f.repo, ['rev-parse', 'HEAD']);
  const before = authority('ignored-deployment', 'controller-before');
  const after = authority('ignored-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'ignored');
  writeFileSync(join(workspace.dir, '.env'), 'TOKEN=preserve-this-file\n');

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => {
      assert.fail('capacity must not settle while evidence remains in the checkout');
    },
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.removedPhysicalOwners, []);
  assert.deepEqual(report.retainedContentOwners, [workspace.receipt.physicalOwnerId]);
  assert.equal(existsSync(workspace.dir), true);
  assert.equal(readFileSync(join(workspace.dir, '.env'), 'utf8'), 'TOKEN=preserve-this-file\n');
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));
});

test('568-D: restart releases a branch-only owner receipt and retains unique branch work', async (t) => {
  const f = fixture(t, 'branch-only');
  const before = authority('branch-deployment', 'controller-before');
  const after = authority('branch-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'branch-only');
  writeFileSync(join(workspace.dir, 'durable.txt'), 'durable branch evidence\n');
  git(workspace.dir, ['add', 'durable.txt']);
  git(workspace.dir, ['commit', '-qm', 'durable evidence']);
  const evidenceSha = git(workspace.dir, ['rev-parse', 'HEAD']);
  await markStopped(f.repo, workspace.receipt.physicalOwnerId);
  await reap(f.repo, workspace.receipt.physicalOwnerId, {
    deleteBranch: true, retainOwnerReceipt: true,
  });
  assert.equal(existsSync(workspace.dir), false);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));

  const report = reconcile(f.repo, [], { ownerAuthority: after });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.removedPhysicalOwners, [workspace.receipt.physicalOwnerId]);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null);
  assert.equal(git(f.repo, ['rev-parse', workspace.branch]), evidenceSha,
    'the durable lane branch survives receipt cleanup');
  assert.equal(git(f.repo, ['show', `${workspace.branch}:durable.txt`]), 'durable branch evidence');
});

test('568-E: restart reclaims a recorded external worktree and preserves dirty detached evidence', async (t) => {
  const f = fixture(t, 'external-detached');
  const before = authority('external-deployment', 'controller-before');
  const after = authority('external-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'external-detached');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'seat-created-external');
  assert.match(readFileSync(seat.lease.paths.checkoutFile, 'utf8'),
    new RegExp(`physicalOwnerId=${workspace.receipt.physicalOwnerId}`));
  const ownership = addLinkedWorktree(seat, workspace, external);

  assert.deepEqual({
    physicalOwnerId: ownership.physicalOwnerId,
    ownerCheckout: ownership.ownerCheckout,
    commonGitDir: ownership.commonGitDir,
    worktreePath: ownership.worktreePath,
    worktreeGitDir: ownership.worktreeGitDir,
  }, {
    physicalOwnerId: workspace.receipt.physicalOwnerId,
    ownerCheckout: workspace.dir,
    commonGitDir: join(f.repo, '.git'),
    worktreePath: external,
    worktreeGitDir: ownership.worktreeGitDir,
  });
  assert.equal(external.startsWith(join(f.repo, '.baton', 'wt')), false,
    'the linked worktree is outside the Baton worktree root');
  writeFileSync(join(external, 'detached-evidence.txt'), 'preserved external evidence\n');

  const events = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => true,
    log: { append: (event) => events.push(event) },
  });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(external), false, 'the recorded external checkout is reclaimed');
  assert.equal(existsSync(seatLinkedWorktreeOwnershipPath(
    f.repo, workspace.receipt.physicalOwnerId,
  )), false, 'the ownership record is released with the checkout');
  const reclaimed = events.find((event) => event.kind === 'worktree.linked_reclaimed');
  assert.match(reclaimed?.payload?.ref ?? '',
    new RegExp(`^refs/baton/seat-worktrees/${workspace.receipt.physicalOwnerId}/`));
  assert.equal(git(f.repo, ['show', `${reclaimed.payload.ref}:detached-evidence.txt`]),
    'preserved external evidence');
  assert.equal(git(f.repo, ['rev-parse', reclaimed.payload.ref]), reclaimed.payload.sha);
});

test('568-F: active owner retains its recorded external worktree', async (t) => {
  const f = fixture(t, 'external-active');
  const current = authority('external-active-deployment', 'controller-current');
  const workspace = await ownedWorkspace(f, current, 'external-active');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'active-seat-external');
  addLinkedWorktree(seat, workspace, external, ['-b', 'active-scratch']);
  const expectation = expectedOwner(workspace.receipt);

  const report = reconcile(f.repo, [workspace.receipt.physicalOwnerId], {
    ownerAuthority: current,
    snapshotUncommitted: true,
    expectedOwnerBindings: [expectation],
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.validatedExpectedOwners, [workspace.receipt.physicalOwnerId]);
  assert.equal(existsSync(external), true);
  assert.equal(git(external, ['branch', '--show-current']), 'active-scratch');
  assert.equal(existsSync(seatLinkedWorktreeOwnershipPath(
    f.repo, workspace.receipt.physicalOwnerId,
  )), true);
});

test('568-G: a recycled external path is retained because its Git identity no longer matches', async (t) => {
  const f = fixture(t, 'external-recycled');
  const before = authority('external-recycled-deployment', 'controller-before');
  const after = authority('external-recycled-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'external-recycled');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'recycled-seat-external');
  addLinkedWorktree(seat, workspace, external, ['-b', 'recycled-scratch']);
  git(f.repo, ['worktree', 'remove', '--force', external]);
  mkdirSync(external);
  writeFileSync(join(external, 'unrelated.txt'), 'new owner content\n');

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => assert.fail('retained linked content keeps owner capacity'),
  });

  assert.deepEqual(report.errors, []);
  assert.ok(report.diagnostics.some((row) => (
    row.physicalOwnerId === workspace.receipt.physicalOwnerId
      && row.code === 'linked_worktree_content_retained'
  )));
  assert.equal(readFileSync(join(external, 'unrelated.txt'), 'utf8'), 'new owner content\n');
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));
});

test('568-H: normal seat stop reclaims its linked worktree and keeps its branch evidence', async (t) => {
  const f = fixture(t, 'external-stop');
  const current = authority('external-stop-deployment', 'controller-current');
  const workspace = await ownedWorkspace(f, current, 'external-stop');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'stopped-seat-external');
  addLinkedWorktree(seat, workspace, external, ['-b', 'stopped-scratch']);
  writeFileSync(join(external, 'stop-evidence.txt'), 'seat stop evidence\n');
  await markStopped(f.repo, workspace.receipt.physicalOwnerId);

  await reap(f.repo, workspace.receipt.physicalOwnerId, { deleteBranch: true });

  assert.equal(existsSync(external), false);
  assert.equal(existsSync(workspace.dir), false);
  assert.equal(git(f.repo, ['show', 'stopped-scratch:stop-evidence.txt']), 'seat stop evidence');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null);
});
