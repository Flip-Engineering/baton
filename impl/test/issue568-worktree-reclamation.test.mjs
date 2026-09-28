import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  allocatePhysicalWorkspaceOwner, applySnapshotToWorktree, createFromBase,
  listWorktrees, markStopped, physicalWorkspaceOwnerReceipt, reap, reconcile,
  seatLinkedWorktreeOwnershipPath,
} from '../src/worktree.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';
import { createBrief, createDriver, MockAdapter } from '../src/index.mjs';

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
  return { world, repo, baseSha: git(repo, ['rev-parse', 'HEAD']) };
}

/** Bounded wait on a read a fixture's own acts settle. */
async function until(read, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
  const rows = readFileSync(
    seatLinkedWorktreeOwnershipPath(dirname(dirname(dirname(workspace.dir))), workspace.receipt.physicalOwnerId),
    'utf8',
  ).trim().split('\n');
  return JSON.parse(rows.at(-1));
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

// #530: the ownership record's size clause left with its registry row, so the reclamation reads a
// record of any size; its row validation stays, and a malformed row still refuses and retains the
// checkout the record names.
test('568-E2 (#530): an ownership record past the old 1 MiB bound is read, and a malformed row refuses', async (t) => {
  const f = fixture(t, 'external-record-size');
  const before = authority('record-size-deployment', 'controller-before');
  const after = authority('record-size-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'record-size');
  const seat = projectedSeat(f, workspace, 'issue568-record-size');
  const external = join(dirname(f.repo), 'seat-created-record-size');
  addLinkedWorktree(seat, workspace, external);
  const recordPath = seatLinkedWorktreeOwnershipPath(f.repo, workspace.receipt.physicalOwnerId);
  const row = readFileSync(recordPath, 'utf8').trim();
  const keep = { ownerAuthority: after, snapshotUncommitted: true, beforeOwnerCleanup: () => true };

  // The integrity check first: one malformed row refuses the record, and the checkout is retained.
  const malformed = JSON.stringify({ ...JSON.parse(row), schemaVersion: 2 });
  writeFileSync(recordPath, `${row}\n${malformed}\n`, { mode: 0o600 });
  const refused = reconcile(f.repo, [], keep);
  assert.deepEqual(refused.diagnostics.map((entry) => entry.code), ['linked_worktree_ownership_invalid'],
    'the malformed record refuses typed');
  assert.equal(refused.retainedContentOwners.includes(workspace.receipt.physicalOwnerId), true,
    'and the owner is retained rather than reclaimed');
  assert.equal(existsSync(external), true, 'the checkout a record the pass cannot read is retained');
  assert.notEqual(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null,
    'and the owner receipt stays with it');

  // With every row valid, a record past the removed 1 MiB bound is read whole and reclaimed. The
  // real row comes first; the padding rows name paths no registration knows, so the pass reads
  // them and moves on.
  const stale = (index) => JSON.stringify({
    ...JSON.parse(row),
    worktreePath: `${external}-stale-${index}`,
    worktreeGitDir: `${external}-stale-${index}.git`,
    registrationNonce: `${String(index).padStart(8, '0')}${'a'.repeat(32)}`,
  });
  const padded = [row];
  while (Buffer.byteLength(padded.join('\n')) < 1024 * 1024) padded.push(stale(padded.length));
  assert.ok(Buffer.byteLength(padded.join('\n')) > 1024 * 1024, 'the fixture record really exceeds the removed bound');
  writeFileSync(recordPath, `${padded.join('\n')}\n`, { mode: 0o600 });
  const read = reconcile(f.repo, [], keep);
  assert.deepEqual(read.errors, []);
  assert.equal(existsSync(external), false, 'the checkout the oversized record names is reclaimed');
  assert.equal(existsSync(recordPath), false, 'the record is released with the checkout');
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

test('568-I: recovery retains an external checkout while a live process has a cwd inside it', async (t) => {
  const f = fixture(t, 'external-live-cwd');
  const before = authority('external-cwd-deployment', 'controller-before');
  const after = authority('external-cwd-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'external-live-cwd');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'live-cwd-seat-external');
  addLinkedWorktree(seat, workspace, external, ['-b', 'live-cwd-scratch']);
  const processDir = join(external, 'running');
  mkdirSync(processDir);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: processDir, stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });

  const retained = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => assert.fail('a live cwd keeps owner capacity'),
  });

  assert.deepEqual(retained.errors, []);
  const diagnostic = retained.diagnostics.find((row) => (
    row.physicalOwnerId === workspace.receipt.physicalOwnerId
      && row.code === 'linked_worktree_live_process_retained'
  ));
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.holders, [`pid:${child.pid}`]);
  assert.equal(existsSync(external), true);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));

  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
  const reclaimed = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => true,
  });
  assert.deepEqual(reclaimed.errors, []);
  assert.equal(existsSync(external), false);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null);
});

test('568-J: a recycled Git registration at the same path and admin name is retained', async (t) => {
  const f = fixture(t, 'external-registration-recycled');
  const before = authority('external-registration-deployment', 'controller-before');
  const after = authority('external-registration-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'external-registration-recycled');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'recycled-registration-external');
  const ownership = addLinkedWorktree(seat, workspace, external, ['-b', 'first-generation']);
  assert.match(ownership.registrationNonce, /^[a-f0-9]{40,64}$/u);
  git(f.repo, ['worktree', 'remove', '--force', external]);
  git(f.repo, ['worktree', 'add', '-b', 'replacement-generation', external, 'HEAD']);
  const replacementGitDir = git(external, [
    'rev-parse', '--path-format=absolute', '--git-dir',
  ]);
  assert.equal(replacementGitDir, ownership.worktreeGitDir,
    'Git reused the same external path and administration directory spelling');

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => assert.fail('a recycled registration keeps owner capacity'),
  });

  assert.deepEqual(report.errors, []);
  assert.ok(report.diagnostics.some((row) => (
    row.physicalOwnerId === workspace.receipt.physicalOwnerId
      && row.code === 'linked_worktree_content_retained'
  )));
  assert.equal(existsSync(external), true);
  assert.equal(git(external, ['branch', '--show-current']), 'replacement-generation');
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));
});

test('568-K: a foreign-uid Linux process and a racing exit do not block cleanup', async (t) => {
  const f = fixture(t, 'linux-foreign-uid');
  const before = authority('linux-foreign-deployment', 'controller-before');
  const after = authority('linux-foreign-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'linux-foreign-uid');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'linux-foreign-external');
  addLinkedWorktree(seat, workspace, external, ['-b', 'linux-foreign-scratch']);
  const cwdReads = [];

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => true,
    linkedWorktreeObservation: {
      platform: 'linux', uid: 501, procRoot: '/synthetic-proc',
      readdirSync: () => ['101', '102'],
      statSync: (path) => ({ uid: path.endsWith('/101') ? 0 : 501 }),
      readlinkSync: (path) => {
        cwdReads.push(path);
        throw Object.assign(new Error('process exited'), { code: 'ENOENT' });
      },
    },
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(cwdReads, ['/synthetic-proc/102/cwd', '/synthetic-proc/102/cwd']);
  assert.equal(existsSync(external), false);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null);
});

test('568-L: an unreadable same-uid Linux cwd retains and names its process', async (t) => {
  const f = fixture(t, 'linux-same-uid-unreadable');
  const before = authority('linux-same-deployment', 'controller-before');
  const after = authority('linux-same-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'linux-same-uid-unreadable');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'linux-same-external');
  addLinkedWorktree(seat, workspace, external, ['-b', 'linux-same-scratch']);

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => assert.fail('an unreadable same-uid cwd keeps owner capacity'),
    linkedWorktreeObservation: {
      platform: 'linux', uid: 501, procRoot: '/synthetic-proc',
      readdirSync: () => ['202'],
      statSync: () => ({ uid: 501 }),
      readlinkSync: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    },
  });

  const diagnostic = report.diagnostics.find((row) => (
    row.physicalOwnerId === workspace.receipt.physicalOwnerId
      && row.code === 'linked_worktree_liveness_unobservable_retained'
  ));
  assert.deepEqual(diagnostic?.holders, ['pid:202']);
  assert.equal(existsSync(external), true);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));
});

test('568-M: macOS lsof stderr makes a successful partial scan retain', async (t) => {
  const f = fixture(t, 'macos-partial-lsof');
  const before = authority('macos-partial-deployment', 'controller-before');
  const after = authority('macos-partial-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'macos-partial-lsof');
  const seat = projectedSeat(f, workspace);
  const external = join(dirname(f.repo), 'macos-partial-external');
  addLinkedWorktree(seat, workspace, external, ['-b', 'macos-partial-scratch']);

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => assert.fail('an incomplete lsof scan keeps owner capacity'),
    linkedWorktreeObservation: {
      platform: 'darwin', uid: 501,
      spawnSync: (command, args) => {
        assert.equal(command, '/usr/sbin/lsof');
        assert.deepEqual(args, ['-a', '-u', '501', '-d', 'cwd', '-Fpn']);
        return { status: 0, signal: null, stdout: '', stderr: 'incomplete scan\n' };
      },
    },
  });

  const diagnostic = report.diagnostics.find((row) => (
    row.physicalOwnerId === workspace.receipt.physicalOwnerId
      && row.code === 'linked_worktree_liveness_unobservable_retained'
  ));
  assert.match(diagnostic?.reason ?? '', /incomplete observation/u);
  assert.equal(existsSync(external), true);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));
});

test('568-O: macOS lsof result guards retain failures and accept a clean no-match', async (t) => {
  const cases = [
    {
      label: 'no-match', retained: false,
      result: () => ({ status: 1, signal: null, stdout: '', stderr: '' }),
    },
    {
      label: 'signal', retained: true, reason: /SIGTERM/u,
      result: () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }),
    },
    {
      label: 'overflow', retained: true, reason: /ENOBUFS/u,
      result: () => ({
        status: 0, signal: null, stdout: 'truncated', stderr: '',
        error: Object.assign(new Error('maxBuffer exceeded'), { code: 'ENOBUFS' }),
      }),
    },
    {
      label: 'missing', retained: true, reason: /ENOENT/u,
      result: () => ({
        status: null, signal: null, stdout: '', stderr: '',
        error: Object.assign(new Error('missing lsof'), { code: 'ENOENT' }),
      }),
    },
    {
      label: 'bad-status', retained: true, reason: /status 2/u,
      result: () => ({ status: 2, signal: null, stdout: '', stderr: '' }),
    },
  ];
  for (const item of cases) {
    const f = fixture(t, `macos-lsof-${item.label}`);
    const before = authority(`macos-lsof-${item.label}-deployment`, 'controller-before');
    const after = authority(`macos-lsof-${item.label}-deployment`, 'controller-after');
    const workspace = await ownedWorkspace(f, before, `macos-lsof-${item.label}`);
    const seat = projectedSeat(f, workspace);
    const external = join(dirname(f.repo), `macos-lsof-${item.label}-external`);
    addLinkedWorktree(seat, workspace, external, ['-b', `macos-lsof-${item.label}`]);

    const report = reconcile(f.repo, [], {
      ownerAuthority: after,
      snapshotUncommitted: true,
      beforeOwnerCleanup: () => {
        assert.equal(item.retained, false, `${item.label} must keep owner capacity when retained`);
        return true;
      },
      linkedWorktreeObservation: {
        platform: 'darwin', uid: 501, spawnSync: () => item.result(),
      },
    });

    const diagnostic = report.diagnostics.find((row) => (
      row.physicalOwnerId === workspace.receipt.physicalOwnerId
        && row.code === 'linked_worktree_liveness_unobservable_retained'
    ));
    if (item.retained) {
      assert.match(diagnostic?.reason ?? '', item.reason);
      assert.equal(existsSync(external), true);
      assert.ok(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId));
    } else {
      assert.equal(diagnostic, undefined);
      assert.equal(existsSync(external), false);
      assert.equal(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null);
    }
  }
});

test('568-N: a Git observation failure retains its row and examines later rows', async (t) => {
  const f = fixture(t, 'git-observation-failure');
  const before = authority('git-observation-deployment', 'controller-before');
  const after = authority('git-observation-deployment', 'controller-after');
  const workspace = await ownedWorkspace(f, before, 'git-observation-failure');
  const seat = projectedSeat(f, workspace);
  const first = join(dirname(f.repo), 'git-observation-first');
  const second = join(dirname(f.repo), 'git-observation-second');
  const firstOwnership = addLinkedWorktree(seat, workspace, first, ['-b', 'git-observation-first']);
  addLinkedWorktree(seat, workspace, second, ['-b', 'git-observation-second']);
  const indexPath = join(firstOwnership.worktreeGitDir, 'index');
  const originalIndex = readFileSync(indexPath);
  writeFileSync(indexPath, 'not a Git index');
  const observed = [];

  const retained = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => assert.fail('an unobservable Git row keeps owner capacity'),
    linkedWorktreeHolders: (path) => { observed.push(path); return []; },
  });

  const diagnostic = retained.diagnostics.find((row) => (
    row.physicalOwnerId === workspace.receipt.physicalOwnerId
      && row.code === 'linked_worktree_git_observation_unobservable_retained'
  ));
  assert.deepEqual(diagnostic?.failedObservations?.map((row) => ({
    worktreePath: row.worktreePath, observation: row.observation,
  })), [{ worktreePath: first, observation: 'git_status' }]);
  assert.deepEqual(new Set(observed), new Set([first, second]));
  const recorded = readFileSync(
    seatLinkedWorktreeOwnershipPath(f.repo, workspace.receipt.physicalOwnerId), 'utf8',
  );
  assert.match(recorded, new RegExp(first.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.equal(existsSync(first), true);
  assert.equal(existsSync(second), true);

  writeFileSync(indexPath, originalIndex);
  const reclaimed = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    beforeOwnerCleanup: () => true,
    linkedWorktreeHolders: () => [],
  });
  assert.deepEqual(reclaimed.errors, []);
  assert.equal(existsSync(first), false);
  assert.equal(existsSync(second), false);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, workspace.receipt.physicalOwnerId), null);
});

// Issue #608: after a recovered startup a dead worker's checkout stayed registered in Git. The
// startup reconciliation asks the deployment's custody seam who holds each owner's checkout, and
// the replayed dead generation's OWN handle answered yes (a terminal handle with an unreleased
// hold), so the reconciliation read the dead worker as a live holder of its own checkout and
// retained it. Observed 2026-09-26: digest-lead16t verified #319 on master c55199aa
// (contribution-07ff5ec1) and found the two dead workers' worktrees still registered. This row
// drives the production open path (`coordinationAsyncOpen`, the one the resident uses), where the
// custody seam is wired before the reconstruction runs.
test('568-P: a recovered startup reclaims a dead generation\'s still-registered checkout', async (t) => {
  const f = fixture(t, 'recovered-startup');
  const logDir = join(f.world, 'log');
  const options = () => ({
    repoRoot: f.repo, repoId: 'repo-issue568-recovered-startup', logDir,
    adapters: {
      mock: new MockAdapter({
        scenario: {
          outcome: 'completed', edits: [],
          ask: { kind: 'question', question: 'hold the checkout', blocking: true, afterEditIndex: 0 },
        },
      }),
    },
    coordinationAsyncOpen: true,
  });
  const before = createDriver(options());
  await before.coordinationOpened;
  const handle = await before.coordinator.spawn('mock', createBrief({
    goal: 'hold a checkout while this incarnation is lost',
    constraints: [], pathScope: ['**'], definitionOfDone: 'wait for an answer',
    verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  }), { taskId: 'issue568-608', runId: 'run-issue568-608' });
  const context = await until(() => before.coordinator.list()
    .find((row) => row.id === handle.id)?.sessionContext ?? null, 'the seat checkout');

  // The seat committed work on its lane branch: the checkout is clean, and the branch is what
  // reclamation has to keep.
  writeFileSync(join(context.worktree, 'seat-work.txt'), 'work the seat committed\n');
  git(context.worktree, ['add', 'seat-work.txt']);
  git(context.worktree, ['commit', '-qm', 'seat work']);
  const seatSha = git(f.repo, ['rev-parse', `baton/${context.ownerTaskId}`]);
  assert.notEqual(seatSha, f.baseSha, 'the lane branch carries the seat\'s commit');
  assert.equal(existsSync(context.worktree), true);
  assert.deepEqual(listWorktrees(f.repo).map((row) => row.dir).filter((dir) => dir !== f.repo),
    [context.worktree], 'Git registers the live seat checkout before the recovered startup');

  // The incarnation is lost with its writer lease released and no drain: the state a crashed
  // resident leaves behind.
  before.coordination.releaseWriterLease();

  const after = createDriver(options());
  await after.coordinationOpened;
  await after.coordinator.startupReady();

  assert.equal(existsSync(context.worktree), false,
    'the recovered startup reclaims the dead generation\'s checkout');
  assert.deepEqual(listWorktrees(f.repo).map((row) => row.dir).filter((dir) => dir !== f.repo), [],
    'the recovered startup removes the dead generation\'s Git registration');
  assert.equal(git(f.repo, ['rev-parse', `baton/${context.ownerTaskId}`]), seatSha,
    'the seat\'s lane branch keeps its work');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, context.ownerTaskId), null,
    'the reclaimed checkout leaves no owner receipt');
});

// Issue #616: 105 registered worktrees (23 GiB) for about 12 live seats. Seats that ended before an
// earlier restart stayed registered on disk, because the startup reconciliation captured only a
// checkout whose uncommitted content a capture had already recorded. Observed 2026-09-27 09:30Z on
// the resident: 311 workspace directories before a restart, 338 after, free disk down to 4.3 GiB.
// The row below is the reported sequence: a blocking seat with an uncommitted file, a lost
// incarnation, a restart, another SIGKILL-and-restart. The first recovered startup ends the seat
// (its session is not reattached) and KEEPS the checkout — that seat is the predecessor a
// `resume-from` successor carries (#385/#517) — and the next startup, which begins from state that
// already holds the seat's end, captures the uncommitted content into the lane branch and reclaims
// the checkout.
test('568-Q: a later startup reclaims an ended seat\'s dirty checkout and captures its content first', async (t) => {
  const f = fixture(t, 'ended-dirty');
  const logDir = join(f.world, 'log');
  const options = () => ({
    repoRoot: f.repo, repoId: 'repo-issue568-ended-dirty', logDir,
    adapters: {
      mock: new MockAdapter({
        scenario: {
          outcome: 'completed', edits: [],
          ask: { kind: 'question', question: 'hold the checkout', blocking: true, afterEditIndex: 0 },
        },
      }),
    },
    coordinationAsyncOpen: true,
  });
  const first = createDriver(options());
  await first.coordinationOpened;
  const handle = await first.coordinator.spawn('mock', createBrief({
    goal: 'hold a checkout while this incarnation is lost',
    constraints: [], pathScope: ['**'], definitionOfDone: 'wait for an answer',
    verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  }), { taskId: 'issue568-616', runId: 'run-issue568-616' });
  const context = await until(() => first.coordinator.list()
    .find((row) => row.id === handle.id)?.sessionContext ?? null, 'the seat checkout');
  writeFileSync(join(context.worktree, 'uncommitted.txt'), 'work no capture recorded\n');
  assert.deepEqual(listWorktrees(f.repo).map((row) => row.dir).filter((dir) => dir !== f.repo),
    [context.worktree], 'Git registers the seat checkout before the restarts');

  // The incarnation is lost with its writer lease released and no drain: the state the SIGKILLs
  // leave behind.
  first.coordination.releaseWriterLease();

  const second = createDriver(options());
  await second.coordinationOpened;
  await second.coordinator.startupReady();
  assert.equal(second.coordination.task('issue568-616').status, 'failed',
    'the recovered startup ends the seat whose session it could not reattach');
  assert.equal(existsSync(context.worktree), true,
    'the seat this startup ended keeps its checkout for the successor that may resume from it');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, context.ownerTaskId) !== null, true,
    'the kept checkout keeps its owner receipt');
  second.coordination.releaseWriterLease();

  const third = createDriver(options());
  await third.coordinationOpened;
  await third.coordinator.startupReady();
  assert.equal(existsSync(context.worktree), false,
    'the startup that begins from the seat\'s own end reclaims its checkout');
  assert.deepEqual(listWorktrees(f.repo).map((row) => row.dir).filter((dir) => dir !== f.repo), [],
    'the reclaimed checkout\'s Git registration is removed');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, context.ownerTaskId), null,
    'the reclaimed checkout leaves no owner receipt');
  assert.equal(git(f.repo, ['show', `baton/${context.ownerTaskId}:uncommitted.txt`]),
    'work no capture recorded', 'the uncommitted content entered the lane branch before removal');
});

/** Spawn one seat through the production coordinator, wait for the seat's own turn to end, and
 * return the handle, its session context and the terminal task row. The adapter's scenario commits
 * the seat's work, so the checkout is clean and its lane branch names that work — the state a seat
 * reaches before anything is written after its capture. */
async function seatAfterItsOwnCapture(t, f, { label, edits, logDir }) {
  const options = () => ({
    repoRoot: f.repo, repoId: `repo-issue568-${label}`, logDir,
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits } }) },
    coordinationAsyncOpen: true,
  });
  const driver = createDriver(options());
  await driver.coordinationOpened;
  await driver.coordinator.startupReady();
  const handle = await driver.coordinator.spawn('mock', createBrief({
    goal: 'work, then leave residue', constraints: [], pathScope: ['**'],
    definitionOfDone: 'the turn ends',
    verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  }), { taskId: `issue568-${label}`, runId: `run-issue568-${label}` });
  const context = await until(() => driver.coordinator.list()
    .find((row) => row.id === handle.id)?.sessionContext ?? null, 'the seat checkout');
  const task = await until(() => {
    const row = driver.coordination.task(`issue568-${label}`);
    return row && ['completed', 'failed', 'cancelled'].includes(row.status) ? row : null;
  }, 'the seat task terminal');
  return { driver, handle, context, task };
}

// Issue #616, the path the observed resident actually took (09:30Z 2026-09-27, master f643762f):
// seats that ended normally did not leave their checkouts behind because the stop could not
// preserve; they left them behind because the stop DID preserve earlier and then the seat wrote
// more. The 67 dirty workspaces read out of `baton-resident` held untracked build output, scratch
// trees and logs written after the seat's own contribution was captured, and a prior capture is not
// evidence that the checkout holds nothing more. `_removeOwnedTaskWorktree` skipped preservation for
// exactly those seats (a completed task, or a pinned checkpoint), so the reap refused the content,
// the handle released its hold, and the registration stayed until a later startup reclaimed it.
// Here the seat ends by the production stop the operator's own stop uses, and the checkout and its
// registration must be gone when the stop resolves.
test('568-R: a seat that writes after its own capture is stopped and its checkout is removed', async (t) => {
  const f = fixture(t, 'residue-after-capture');
  const logDir = join(f.world, 'log');
  const { driver, handle, context, task } = await seatAfterItsOwnCapture(t, f, {
    label: 'residue', logDir, edits: [{ path: 'seat-work.txt', content: 'captured work\n' }],
  });
  assert.equal(task.status, 'completed', 'the seat\'s own turn ended and was accepted');
  assert.equal(git(context.worktree, ['status', '--porcelain']), '',
    'the seat\'s own capture left its checkout clean');
  assert.equal(git(f.repo, ['show', `baton/${context.ownerTaskId}:seat-work.txt`]), 'captured work',
    'the seat\'s contribution is on its lane branch');
  assert.deepEqual(listWorktrees(f.repo).map((row) => row.dir).filter((dir) => dir !== f.repo),
    [context.worktree], 'Git registers the seat checkout before it is stopped');

  // The residue the observed resident was full of: build output and scratch trees written after the
  // contribution was recorded.
  writeFileSync(join(context.worktree, 'residue.txt'), 'residue no capture recorded\n');
  const stopped = await driver.coordinator.kill(handle.id, 'policy');
  assert.equal(stopped.result, 'confirmed', 'the production stop of the seat resolves');

  assert.equal(existsSync(context.worktree), false,
    'the ended seat\'s checkout is removed when the stop resolves');
  assert.deepEqual(listWorktrees(f.repo).map((row) => row.dir).filter((dir) => dir !== f.repo), [],
    'its Git registration is removed with it');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, context.ownerTaskId), null,
    'and it leaves no owner receipt');
  assert.equal(git(f.repo, ['show', `baton/${context.ownerTaskId}:residue.txt`]),
    'residue no capture recorded', 'the residue entered the lane branch before removal');
  assert.equal(git(f.repo, ['show', `baton/${context.ownerTaskId}:seat-work.txt`]), 'captured work',
    'the seat\'s original contribution stays in the branch history the residue commit was added to');
  assert.equal(driver.log.read(handle.id).some((event) => event.kind === 'worktree.progress_checkpointed'),
    true, 'the residual work was preserved as a checkpoint, not only left on disk');
});

// The other half of the same rule: a seat that ends with nothing written after its capture must keep
// closing exactly as it closed before — no second checkpoint, no new receipt, the same removal.
test('568-S: a seat that ends with nothing new mints no second checkpoint and still reclaims', async (t) => {
  const f = fixture(t, 'nothing-new');
  const logDir = join(f.world, 'log');
  const { driver, handle, context } = await seatAfterItsOwnCapture(t, f, {
    label: 'nothing-new', logDir, edits: [{ path: 'seat-work.txt', content: 'captured work\n' }],
  });
  const seatSha = git(f.repo, ['rev-parse', `baton/${context.ownerTaskId}`]);

  const stopped = await driver.coordinator.kill(handle.id, 'policy');
  assert.equal(stopped.result, 'confirmed', 'the production stop of the seat resolves');

  assert.equal(existsSync(context.worktree), false, 'the seat\'s checkout is still removed');
  assert.deepEqual(listWorktrees(f.repo).map((row) => row.dir).filter((dir) => dir !== f.repo), [],
    'and its Git registration with it');
  assert.equal(git(f.repo, ['rev-parse', `baton/${context.ownerTaskId}`]), seatSha,
    'the lane branch keeps the revision the seat already had, with no snapshot commit added');
  assert.deepEqual(driver.log.read(handle.id)
    .map((event) => event.kind)
    .filter((kind) => kind.startsWith('worktree.progress_')), [],
    'a checkout that did not move past its recorded capture mints no checkpoint');
});

// Issue #616, the checkpoint exclusion the same review named: a stop that already pinned a
// checkpoint (or recorded `no_progress`) skipped every later preservation, so content written after
// that checkpoint was stranded in a checkout the reap then refused. The row drives the coordinator's
// own preservation step — the step every stop, stall reap and crash close runs before the reap —
// with a real checkout: the first call pins the checkpoint for the work present, and the second call,
// taken after more work was written, must pin the work that arrived since rather than answer with the
// earlier checkpoint. In production the second call is the same stop's own cleanup step (a dying
// seat's children write while the stop drains) and a verification close after a diagnostic
// checkpoint; the seam is driven directly here because the window between the two is a race.
test('568-T: a checkout that gained work after its checkpoint is captured before the next reap', async (t) => {
  const f = fixture(t, 'checkpoint-then-residue');
  const logDir = join(f.world, 'log');
  const driver = createDriver({
    repoRoot: f.repo, repoId: 'repo-issue568-checkpoint-then-residue', logDir,
    adapters: {
      mock: new MockAdapter({
        scenario: {
          outcome: 'completed', edits: [],
          ask: { kind: 'question', question: 'hold the checkout', blocking: true, afterEditIndex: 0 },
        },
      }),
    },
    coordinationAsyncOpen: true,
  });
  await driver.coordinationOpened;
  await driver.coordinator.startupReady();
  const spawned = await driver.coordinator.spawn('mock', createBrief({
    goal: 'reach a checkpoint, then write more', constraints: [], pathScope: ['**'],
    definitionOfDone: 'wait for an answer',
    verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  }), { taskId: 'issue568-checkpoint-then-residue', runId: 'run-issue568-checkpoint-then-residue' });
  await until(() => driver.coordinator.list().find((row) => row.id === spawned.id)?.worktree ?? null,
    'the seat checkout');
  const handle = driver.coordinator._workers.get(spawned.id);
  const task = driver.coordinator._tasks.get(handle.taskId);
  const worktree = join(f.repo, '.baton', 'wt', task.sessionContext.ownerTaskId);
  writeFileSync(join(worktree, 'turn-work.txt'), 'work the checkpoint was pinned for\n');

  const first = await driver.coordinator._preserveProgressBeforeReap(handle, task, null, true);
  assert.equal(first.state, 'pinned', 'the first capture pins the work the checkout held');
  assert.equal(git(f.repo, ['show', `${first.sha}:turn-work.txt`]), 'work the checkpoint was pinned for');

  writeFileSync(join(worktree, 'residue.txt'), 'work written after the checkpoint\n');
  const second = await driver.coordinator._preserveProgressBeforeReap(handle, task, null, true);
  assert.equal(second.state, 'pinned', 'the second capture pins the work that arrived after it');
  assert.notEqual(second.sha, first.sha, 'the checkpoint moved past the revision it replaced');
  assert.equal(git(f.repo, ['show', `${second.sha}:residue.txt`]), 'work written after the checkpoint',
    'the later work is in the branch, not left to a reap refusal');
  assert.equal(git(f.repo, ['show', `${second.sha}:turn-work.txt`]),
    'work the checkpoint was pinned for', 'and the work the earlier checkpoint held is still carried');
  assert.equal(git(f.repo, ['rev-parse', `${second.sha}^`]), first.sha,
    'the newer checkpoint builds on the revision the earlier one pinned');
});
