// Issue #620 — a `.baton/wt` directory that is no longer a registered Git worktree.
//
// OBSERVED (2026-09-27 18:55Z, the restart onto a0cb91cd, which carries #616's startup
// reclamation): the resident's `.baton/wt` held `ws-*`/`integrate-*` entries that `git worktree
// list` no longer named, several GiB of them belonging to seats that had ended. #616 reclaims the
// registered worktrees of ended seats; these directories were unregistered, so the reconciliation
// reached them with no owner receipt and retained them with `workspace_owner_receipt_missing`.
//
// The residue the incident reports is the administratively-removed state. `git worktree remove
// --force` deletes the checkout's whole administration directory `.git/worktrees/<name>` before it
// walks the working tree, so a walk that is interrupted or refused leaves the checkout on disk
// with its `.git` file naming a Git directory that is gone and no Git command inside it resolving
// the repository; `observeOwnedWorktreeContent` answers `unobservable` for it. Rows 620-F…620-Q and
// 620-S produce that state — 620-F, 620-M…620-Q and 620-S with the plain pruned administration,
// 620-G…620-L with the real command and its recorded refusal — and pin the reclaim, the retention
// of content no ref holds, and the live-holder retention.
//
// The reconciliation reads such a checkout against its lane branch with the common Git directory
// named explicitly and a throwaway index built from that branch: `git diff --quiet <ref> --` and
// `git diff --name-only <ref>` for the tracked tree, `git ls-files --others --exclude-standard`
// and `git ls-files --others --ignored --exclude-standard` for the rest. Only the untracked and
// ignored listings are filtered by the `meta.json`-attested infrastructure roots: a tracked
// modification or deletion beneath an attested root is somebody's work whatever the metadata says
// (620-N, 620-O), while an untracked or ignored path beneath that root is the one infrastructure a
// checkout may hold without a capture (620-P). MEASURED against a real pruned checkout: equal
// content exits 0 and lists nothing, one modified tracked file exits 1 and names it, one deleted
// tracked file exits 1 and names it, an untracked file is listed by the first `ls-files` form, and
// an ignored file by the second.
//
// An unregistered checkout Git can still read is the second state, covered by 620-A…620-D: `git
// worktree list` names a checkout only while its administration directory holds a `gitdir` file
// naming the checkout's `.git` file, and with that file gone the checkout is unregistered and every
// Git command inside it still works through its own `.git` file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  allocatePhysicalWorkspaceOwner, createFromBase, reconcile,
} from '../src/worktree.mjs';
import { spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const testRoot = dirname(fileURLToPath(import.meta.url));
const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;

// The same environment discipline the module's own Git calls keep: an ambient `GIT_DIR`,
// `GIT_WORK_TREE` or `GIT_INDEX_FILE` would redirect a fixture's Git calls at another repository.
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

const git = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: GIT_ENV,
}).trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** A small scratch repository. Every fixture stays inside this checkout and is removed with it. */
function fixture(t, label) {
  const world = mkdtempSync(join(testRoot, `.issue620-${label}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 620 Fixture']);
  git(repo, ['config', 'user.email', 'issue620@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-qm', 'base']);
  t.after(() => rmSync(world, { recursive: true, force: true }));
  return { world, repo, baseSha: git(repo, ['rev-parse', 'HEAD']) };
}

/** A fixture repository holding an untracked `deps` directory: the copied dependency root that
 * `createFromBase` materializes into a checkout and `meta.copiedDependencies` attests. `deps`
 * stays untracked because `createFromBase` refuses to copy a directory a checkout already holds.
 * `*.env` is ignored so a row can also place an ignored file beneath that root. */
function dependencyFixture(t, label) {
  const f = fixture(t, label);
  writeFileSync(join(f.repo, '.gitignore'), '*.env\n');
  mkdirSync(join(f.repo, 'deps'));
  writeFileSync(join(f.repo, 'deps', 'dependency.txt'), 'dependency\n');
  git(f.repo, ['add', '.gitignore']);
  git(f.repo, ['commit', '-qm', 'ignore the local environment']);
  f.baseSha = git(f.repo, ['rev-parse', 'HEAD']);
  assert.equal(git(f.repo, ['ls-files', 'deps']), '', 'the dependency root stays untracked');
  return f;
}

function ownerBinding(baseSha, suffix) {
  return {
    runId: `run-${suffix}`, attemptId: `attempt-${suffix}`,
    logicalTaskId: `task-${suffix}`, processGeneration: 1, baseSha,
  };
}

async function ownedWorkspace(f, owner, suffix, createOpts = {}) {
  const receipt = allocatePhysicalWorkspaceOwner(f.repo, ownerBinding(f.baseSha, suffix), owner);
  const created = await createFromBase(
    f.repo, receipt.physicalOwnerId, f.baseSha, { ownerReceipt: receipt, ...createOpts },
  );
  return { receipt: created.ownerReceipt, ...created };
}

/** The paths `git worktree list --porcelain` currently names. */
function registeredPaths(repo) {
  return git(repo, ['worktree', 'list', '--porcelain']).split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
}

/** Take one checkout out of Git's registration while leaving it resolvable: the administration
 * directory loses the file that names the checkout, so `git worktree list` stops naming it. */
function unregister(repo, physicalOwnerId) {
  const admin = join(repo, '.git', 'worktrees', physicalOwnerId);
  assert.equal(existsSync(join(admin, 'gitdir')), true,
    'the checkout is registered before the row unregisters it');
  rmSync(join(admin, 'gitdir'), { force: true });
  assert.equal(registeredPaths(repo).includes(join(repo, '.baton', 'wt', physicalOwnerId)), false,
    `git worktree list no longer names ${physicalOwnerId}`);
  assert.equal(git(join(repo, '.baton', 'wt', physicalOwnerId), ['rev-parse', 'HEAD']).length, 40,
    'the unregistered checkout still resolves its own repository');
}

function receiptFile(repo, physicalOwnerId) {
  return join(repo, '.git', 'baton', 'workspace-owners', `${physicalOwnerId}.json`);
}

function dropReceipt(repo, physicalOwnerId) {
  const receipt = receiptFile(repo, physicalOwnerId);
  assert.equal(existsSync(receipt), true, 'the owner receipt exists before the row removes it');
  rmSync(receipt, { force: true });
}

/** A Git read that answers `null` where the command fails: a checkout whose administration
 * directory is gone answers no Git command about itself. */
function gitOrNull(cwd, args) {
  try { return git(cwd, args); } catch { return null; }
}

/** Produce the residue `git worktree remove --force` leaves when its walk cannot finish. The
 * command deletes the checkout's whole administration directory BEFORE it walks the working tree,
 * so a refused walk leaves the checkout on disk with its `.git` file naming a Git directory that
 * no longer exists. The checkout's own directory mode is what refuses the walk, so the command
 * deletes nothing inside it. Returns the refusal text, which is the evidence that this state is
 * the one the command produces. */
function refusedWorktreeRemoval(repo, dir) {
  const root = realpathSync(dir);
  chmodSync(root, 0o500);
  let stderr = null;
  try { git(repo, ['worktree', 'remove', '--force', dir]); } catch (error) { stderr = String(error.stderr || error.message).trim(); }
  chmodSync(root, 0o700);
  assert.match(stderr ?? '', /failed to delete .*Permission denied/u,
    'the removal was refused part-way through its walk, which is the residue this row needs');
  assert.equal(existsSync(join(repo, '.git', 'worktrees', basename(dir))), false,
    'the administration directory is gone');
  assert.equal(registeredPaths(repo).includes(dir), false, 'Git no longer names the checkout');
  assert.equal(existsSync(join(dir, '.git')), true, 'the checkout keeps the .git file that names it');
  assert.equal(gitOrNull(dir, ['rev-parse', 'HEAD']), null,
    'no Git command inside the checkout resolves the repository');
  return stderr;
}

/** Produce the incident's residue the way Git leaves it: the checkout's administration entry is
 * gone entirely, so the checkout's `.git` file names a directory that is not there and no Git
 * command inside it resolves the repository. */
function prunedAdministration(repo, dir) {
  rmSync(join(repo, '.git', 'worktrees', basename(dir)), { recursive: true, force: true });
  assert.equal(registeredPaths(repo).includes(dir), false, 'Git no longer names the checkout');
  assert.equal(existsSync(join(dir, '.git')), true, 'the checkout keeps the .git file that names it');
  assert.equal(gitOrNull(dir, ['rev-parse', 'HEAD']), null,
    'no Git command inside the checkout resolves the repository');
}

function commitFile(dir, name, body) {
  writeFileSync(join(dir, name), body);
  git(dir, ['add', name]);
  git(dir, ['commit', '-qm', body.trim()]);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** The expectation row a live seat's owner binding produces (the issue568 idiom). */
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

test('620-A: an unregistered receipt-less checkout is reclaimed and its lane branch keeps the work', async (t) => {
  const f = fixture(t, 'unregistered');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'unregistered');
  const id = workspace.receipt.physicalOwnerId;
  const tip = commitFile(workspace.dir, 'durable.txt', 'issue620 durable work\n');
  unregister(f.repo, id);
  dropReceipt(f.repo, id);

  const events = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: owner,
    log: { append: (event) => events.push(event) },
  });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), false, 'the unregistered directory is reclaimed');
  assert.deepEqual(report.removedZombieDirs, [workspace.dir]);
  const removed = report.removedWorkspaces.find((row) => row.physicalOwnerId === id);
  assert.ok(removed, 'the removal report names the reclaimed workspace');
  assert.equal(removed.snapshot, tip, 'the snapshot is the lane-branch tip that held the work');
  assert.equal(removed.branch, `baton/${id}`);
  assert.equal(git(f.repo, ['rev-parse', `refs/heads/baton/${id}`]), tip,
    'the lane branch survives the removal');
  assert.equal(git(f.repo, ['show', `baton/${id}:durable.txt`]), 'issue620 durable work');
  assert.deepEqual(report.removedPhysicalOwners, [], 'there is no owner receipt to release');
  assert.ok(events.some((event) => event.kind === 'worktree.snapshotted'
    && event.payload?.workspaceId === id && event.payload?.sha === tip));
  assert.ok(events.some((event) => event.kind === 'worktree.removed'
    && event.payload?.workspaceId === id && event.payload?.snapshot === tip));
});

test('620-B: an unregistered checkout holding content no capture recorded is retained', async (t) => {
  const f = fixture(t, 'unpreserved');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'unpreserved');
  const id = workspace.receipt.physicalOwnerId;
  writeFileSync(join(workspace.dir, 'base.txt'), 'issue620 uncommitted edit\n');
  writeFileSync(join(workspace.dir, 'notes.txt'), 'issue620 untracked notes\n');
  unregister(f.repo, id);
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'the directory holding unpreserved content remains');
  assert.equal(readFileSync(join(workspace.dir, 'base.txt'), 'utf8'), 'issue620 uncommitted edit\n');
  assert.equal(readFileSync(join(workspace.dir, 'notes.txt'), 'utf8'), 'issue620 untracked notes\n');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_uncommitted_content_retained' && row.retained === true));
  assert.ok(report.retainedContentOwners.includes(id));
  assert.deepEqual(report.removedWorkspaces, []);
});

test('620-C: a live expected owner and an expected receipt-less owner both keep their directories', async (t) => {
  const f = fixture(t, 'expected');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const live = await ownedWorkspace(f, owner, 'live');
  const receiptless = await ownedWorkspace(f, owner, 'receiptless');
  unregister(f.repo, receiptless.receipt.physicalOwnerId);
  dropReceipt(f.repo, receiptless.receipt.physicalOwnerId);

  const report = reconcile(
    f.repo,
    [live.receipt.physicalOwnerId, receiptless.receipt.physicalOwnerId],
    { ownerAuthority: owner, expectedOwnerBindings: [expectedOwner(live.receipt)] },
  );

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.validatedExpectedOwners, [live.receipt.physicalOwnerId]);
  assert.equal(existsSync(live.dir), true, 'the live seat keeps its checkout');
  assert.equal(existsSync(receiptless.dir), true, 'the expected owner set keeps its checkout');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === receiptless.receipt.physicalOwnerId
    && row.code === 'workspace_owner_binding_ambiguous' && row.retained === true));
  assert.deepEqual(report.removedWorkspaces, []);
});

test('620-D: a still-registered receipt-less checkout is retained', async (t) => {
  const f = fixture(t, 'registered');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'registered');
  const id = workspace.receipt.physicalOwnerId;
  commitFile(workspace.dir, 'durable.txt', 'issue620 registered durable work\n');
  dropReceipt(f.repo, id);
  assert.equal(registeredPaths(f.repo).includes(workspace.dir), true, 'the checkout is registered');

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'a registered checkout remains');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_owner_receipt_missing' && row.retained === true));
  assert.deepEqual(report.removedWorkspaces, []);
});

test('620-E: an integration directory under .baton/wt is untouched', async (t) => {
  const f = fixture(t, 'integration');
  const dir = join(f.repo, '.baton', 'wt', 'integrate-contribution-6200000000000000000000000000');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'candidate.txt'), 'issue620 integration candidate\n');

  const report = reconcile(f.repo, []);

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(join(dir, 'candidate.txt')), true, 'the integration directory remains');
  assert.equal(readFileSync(join(dir, 'candidate.txt'), 'utf8'), 'issue620 integration candidate\n');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === 'integrate-contribution-6200000000000000000000000000'
    && row.code === 'workspace_content_unobservable_retained' && row.retained === true));
  assert.deepEqual(report.removedZombieDirs, []);
});

test('620-F: a pruned checkout holding only its branch tree is reclaimed', async (t) => {
  const f = fixture(t, 'pruned');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'pruned');
  const id = workspace.receipt.physicalOwnerId;
  const tip = commitFile(workspace.dir, 'durable.txt', 'issue620 pruned durable work\n');
  prunedAdministration(f.repo, workspace.dir);
  dropReceipt(f.repo, id);

  const events = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: owner,
    log: { append: (event) => events.push(event) },
  });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), false, 'the pruned directory is reclaimed');
  assert.deepEqual(report.removedZombieDirs, [workspace.dir]);
  const removed = report.removedWorkspaces.find((row) => row.physicalOwnerId === id);
  assert.equal(removed?.snapshot, tip, 'the snapshot is the lane-branch tip that held the work');
  assert.equal(removed?.branch, `baton/${id}`);
  assert.equal(git(f.repo, ['rev-parse', `refs/heads/baton/${id}`]), tip,
    'the lane branch survives the removal');
  assert.equal(git(f.repo, ['show', `baton/${id}:durable.txt`]), 'issue620 pruned durable work');
  assert.deepEqual(report.removedPhysicalOwners, [], 'there is no owner receipt to release');
  assert.ok(events.some((event) => event.kind === 'worktree.snapshotted'
    && event.payload?.workspaceId === id && event.payload?.sha === tip));
  assert.ok(events.some((event) => event.kind === 'worktree.removed'
    && event.payload?.workspaceId === id && event.payload?.snapshot === tip));
});

test('620-G: an administration-less checkout holding a file the branch does not is retained', async (t) => {
  const f = fixture(t, 'adminless-uncaptured');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'adminless-uncaptured');
  const id = workspace.receipt.physicalOwnerId;
  const tip = commitFile(workspace.dir, 'durable.txt', 'issue620 adminless durable work\n');
  refusedWorktreeRemoval(f.repo, workspace.dir);
  writeFileSync(join(workspace.dir, 'after-capture.txt'), 'issue620 work after the capture\n');
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'the directory holding uncaptured content remains');
  assert.equal(readFileSync(join(workspace.dir, 'after-capture.txt'), 'utf8'),
    'issue620 work after the capture\n');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_uncommitted_content_retained' && row.retained === true
    && row.dirtyPaths.includes('after-capture.txt')));
  assert.deepEqual(report.removedWorkspaces, []);
  assert.equal(git(f.repo, ['rev-parse', `refs/heads/baton/${id}`]), tip,
    'the lane branch is untouched');
});

test('620-H: an administration-less checkout with no lane branch is retained', async (t) => {
  const f = fixture(t, 'adminless-no-branch');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'adminless-no-branch');
  const id = workspace.receipt.physicalOwnerId;
  commitFile(workspace.dir, 'durable.txt', 'issue620 adminless durable work\n');
  refusedWorktreeRemoval(f.repo, workspace.dir);
  dropReceipt(f.repo, id);
  git(f.repo, ['update-ref', '-d', `refs/heads/baton/${id}`]);
  assert.equal(gitOrNull(f.repo, ['rev-parse', '--verify', `refs/heads/baton/${id}`]), null);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'the directory with no branch naming its work remains');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_uncommitted_content_retained' && row.retained === true
    && row.dirtyPaths.length === 0));
  assert.deepEqual(report.removedWorkspaces, []);
});

test('620-I: an administration-less checkout bound to another repository is retained', async (t) => {
  const f = fixture(t, 'adminless-foreign');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'adminless-foreign');
  const id = workspace.receipt.physicalOwnerId;
  commitFile(workspace.dir, 'durable.txt', 'issue620 adminless durable work\n');
  refusedWorktreeRemoval(f.repo, workspace.dir);
  const other = join(f.world, 'other');
  mkdirSync(other);
  git(other, ['init', '-q']);
  git(other, ['config', 'user.name', 'Other Fixture']);
  git(other, ['config', 'user.email', 'other@example.invalid']);
  writeFileSync(join(other, 'base.txt'), 'other\n');
  git(other, ['add', 'base.txt']);
  git(other, ['commit', '-qm', 'other base']);
  writeFileSync(join(workspace.dir, '.git'), `gitdir: ${join(other, '.git', 'worktrees', id)}\n`);
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true,
    'a checkout bound to another repository administration root remains');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_content_unobservable_retained' && row.retained === true));
  assert.deepEqual(report.removedWorkspaces, []);
});

test('620-J: an administration-less checkout of an ended seat is reclaimed with its receipt', async (t) => {
  const f = fixture(t, 'adminless-receipt');
  const before = authority('issue620-deployment', 'issue620-controller-before');
  const after = authority('issue620-deployment', 'issue620-controller-after');
  const workspace = await ownedWorkspace(f, before, 'adminless-receipt');
  const id = workspace.receipt.physicalOwnerId;
  const tip = commitFile(workspace.dir, 'durable.txt', 'issue620 receipt-bearing durable work\n');
  const refusal = refusedWorktreeRemoval(f.repo, workspace.dir);
  assert.equal(existsSync(receiptFile(f.repo, id)), true,
    'the refused removal leaves the owner receipt beside the checkout');
  console.log(`issue620 620-J refused removal: ${refusal}`);

  const events = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    log: { append: (event) => events.push(event) },
  });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), false, 'the administration-less directory is reclaimed');
  assert.deepEqual(report.removedPhysicalOwners, [id], 'the owner receipt is released');
  assert.equal(existsSync(receiptFile(f.repo, id)), false, 'no owner receipt remains on disk');
  const removed = report.removedWorkspaces.find((row) => row.physicalOwnerId === id);
  assert.equal(removed?.snapshot, tip, 'the snapshot is the lane-branch tip that held the work');
  assert.equal(git(f.repo, ['rev-parse', `refs/heads/baton/${id}`]), tip,
    'the lane branch survives the removal');
  assert.equal(git(f.repo, ['show', `baton/${id}:durable.txt`]), 'issue620 receipt-bearing durable work');
  assert.ok(events.some((event) => event.kind === 'worktree.snapshotted'
    && event.payload?.workspaceId === id && event.payload?.sha === tip));
  assert.ok(events.some((event) => event.kind === 'worktree.removed'
    && event.payload?.workspaceId === id && event.payload?.snapshot === tip));
});

test('620-K: an administration-less checkout whose seat had not ended is retained with its receipt', async (t) => {
  const f = fixture(t, 'adminless-seat-open');
  const before = authority('issue620-deployment', 'issue620-controller-before');
  const after = authority('issue620-deployment', 'issue620-controller-after');
  const workspace = await ownedWorkspace(f, before, 'adminless-seat-open');
  const id = workspace.receipt.physicalOwnerId;
  commitFile(workspace.dir, 'durable.txt', 'issue620 receipt-bearing durable work\n');
  refusedWorktreeRemoval(f.repo, workspace.dir);

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    ownerSeatEndedBeforeStartup: () => false,
  });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'the checkout of a seat that had not ended remains');
  assert.equal(readFileSync(join(workspace.dir, 'durable.txt'), 'utf8'),
    'issue620 receipt-bearing durable work\n');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_content_unobservable_retained' && row.retained === true));
  assert.equal(existsSync(receiptFile(f.repo, id)), true, 'the owner receipt remains');
  assert.deepEqual(report.removedWorkspaces, []);
  assert.deepEqual(report.removedPhysicalOwners, []);
});

test('620-L: an administration-less checkout whose branch does not hold all its content is retained', async (t) => {
  const f = fixture(t, 'adminless-receipt-uncaptured');
  const before = authority('issue620-deployment', 'issue620-controller-before');
  const after = authority('issue620-deployment', 'issue620-controller-after');
  const workspace = await ownedWorkspace(f, before, 'adminless-receipt-uncaptured');
  const id = workspace.receipt.physicalOwnerId;
  commitFile(workspace.dir, 'durable.txt', 'issue620 receipt-bearing durable work\n');
  refusedWorktreeRemoval(f.repo, workspace.dir);
  writeFileSync(join(workspace.dir, 'after-capture.txt'), 'issue620 work after the capture\n');

  const report = reconcile(f.repo, [], {
    ownerAuthority: after,
    snapshotUncommitted: true,
    ownerSeatEndedBeforeStartup: () => true,
  });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'the directory holding uncaptured content remains');
  assert.equal(readFileSync(join(workspace.dir, 'after-capture.txt'), 'utf8'),
    'issue620 work after the capture\n');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_uncommitted_content_retained' && row.retained === true
    && row.dirtyPaths.includes('after-capture.txt')));
  assert.equal(existsSync(receiptFile(f.repo, id)), true, 'the owner receipt remains');
  assert.deepEqual(report.removedWorkspaces, []);
  assert.deepEqual(report.removedPhysicalOwners, []);
});

test('620-M: a pruned checkout another live holder names is retained', async (t) => {
  const f = fixture(t, 'pruned-held');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'pruned-held');
  const id = workspace.receipt.physicalOwnerId;
  commitFile(workspace.dir, 'durable.txt', 'issue620 pruned durable work\n');
  prunedAdministration(f.repo, workspace.dir);
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], {
    ownerAuthority: owner,
    custodyHolders: (physicalOwnerId) => (physicalOwnerId === id ? ['live-peer'] : []),
  });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'the checkout a live holder names remains');
  assert.equal(readFileSync(join(workspace.dir, 'durable.txt'), 'utf8'),
    'issue620 pruned durable work\n');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_content_unobservable_retained' && row.retained === true));
  assert.deepEqual(report.removedWorkspaces, []);
});

test('620-N: a pruned checkout with a tracked edit beneath an attested dependency root is retained', async (t) => {
  const f = dependencyFixture(t, 'deps-edit');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'deps-edit', { dependencyDirs: ['deps'] });
  const id = workspace.receipt.physicalOwnerId;
  assert.deepEqual([...workspace.copiedDependencies], ['deps']);
  writeFileSync(join(workspace.dir, 'deps', 'file.txt'), 'captured\n');
  git(workspace.dir, ['add', '-f', 'deps/file.txt']);
  git(workspace.dir, ['commit', '-qm', 'hold the dependency file']);
  const captured = git(workspace.dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(workspace.dir, 'deps', 'file.txt'), 'UNPRESERVED EDIT\n');
  prunedAdministration(f.repo, workspace.dir);
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true,
    'the checkout holding a tracked edit beneath the attested root remains');
  assert.equal(readFileSync(join(workspace.dir, 'deps', 'file.txt'), 'utf8'), 'UNPRESERVED EDIT\n');
  assert.deepEqual(report.removedWorkspaces, []);
  assert.deepEqual(report.removedZombieDirs, []);
  assert.deepEqual(report.removedPhysicalOwners, []);
  assert.equal(git(f.repo, ['rev-parse', `refs/heads/baton/${id}`]), captured,
    'the lane branch stays at the captured commit');
  assert.equal(git(f.repo, ['show', `baton/${id}:deps/file.txt`]), 'captured');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_uncommitted_content_retained' && row.retained === true
    && row.dirtyPaths.includes('deps/file.txt')));
});

test('620-O: a pruned checkout with a tracked deletion beneath an attested dependency root is retained', async (t) => {
  const f = dependencyFixture(t, 'deps-deleted');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'deps-deleted', { dependencyDirs: ['deps'] });
  const id = workspace.receipt.physicalOwnerId;
  writeFileSync(join(workspace.dir, 'deps', 'file.txt'), 'captured\n');
  git(workspace.dir, ['add', '-f', 'deps/file.txt']);
  git(workspace.dir, ['commit', '-qm', 'hold the dependency file']);
  const captured = git(workspace.dir, ['rev-parse', 'HEAD']);
  rmSync(join(workspace.dir, 'deps', 'file.txt'));
  prunedAdministration(f.repo, workspace.dir);
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true,
    'the checkout missing a tracked file beneath the attested root remains');
  assert.deepEqual(report.removedWorkspaces, []);
  assert.deepEqual(report.removedZombieDirs, []);
  assert.deepEqual(report.removedPhysicalOwners, []);
  assert.equal(git(f.repo, ['rev-parse', `refs/heads/baton/${id}`]), captured);
  assert.equal(git(f.repo, ['show', `baton/${id}:deps/file.txt`]), 'captured',
    'the branch still holds the deleted file');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_uncommitted_content_retained' && row.retained === true
    && row.dirtyPaths.includes('deps/file.txt')));
});

test('620-P: a pruned checkout holding only infrastructure beneath the attested root is reclaimed', async (t) => {
  const f = dependencyFixture(t, 'deps-infrastructure');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'deps-infrastructure', { dependencyDirs: ['deps'] });
  const id = workspace.receipt.physicalOwnerId;
  writeFileSync(join(workspace.dir, 'deps', 'file.txt'), 'captured\n');
  git(workspace.dir, ['add', '-f', 'deps/file.txt']);
  git(workspace.dir, ['commit', '-qm', 'hold the dependency file']);
  const captured = git(workspace.dir, ['rev-parse', 'HEAD']);
  writeFileSync(join(workspace.dir, 'deps', 'artifact.txt'), 'build output\n');
  writeFileSync(join(workspace.dir, 'deps', 'notes.env'), 'TOKEN=infrastructure\n');
  prunedAdministration(f.repo, workspace.dir);
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), false,
    'a checkout holding only untracked and ignored paths beneath the attested root is reclaimed');
  const removed = report.removedWorkspaces.find((row) => row.physicalOwnerId === id);
  assert.equal(removed?.snapshot, captured, 'the snapshot is the lane-branch tip');
  assert.equal(git(f.repo, ['rev-parse', `refs/heads/baton/${id}`]), captured,
    'the lane branch survives the removal');
  assert.equal(git(f.repo, ['show', `baton/${id}:deps/file.txt`]), 'captured');
});

test('620-Q: a pruned checkout missing a tracked file its branch holds is retained', async (t) => {
  const f = fixture(t, 'pruned-deleted');
  const owner = authority('issue620-deployment', 'issue620-controller');
  const workspace = await ownedWorkspace(f, owner, 'pruned-deleted');
  const id = workspace.receipt.physicalOwnerId;
  commitFile(workspace.dir, 'durable.txt', 'issue620 pruned durable work\n');
  rmSync(join(workspace.dir, 'base.txt'));
  prunedAdministration(f.repo, workspace.dir);
  dropReceipt(f.repo, id);

  const report = reconcile(f.repo, [], { ownerAuthority: owner });

  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(workspace.dir), true, 'the checkout whose tree is not its branch remains');
  assert.equal(readFileSync(join(workspace.dir, 'durable.txt'), 'utf8'),
    'issue620 pruned durable work\n');
  assert.ok(report.diagnostics.some((row) => row.physicalOwnerId === id
    && row.code === 'workspace_uncommitted_content_retained' && row.retained === true
    && row.dirtyPaths.includes('base.txt')));
  assert.deepEqual(report.removedWorkspaces, []);
});

/** The serve fixture: a real `baton serve` child over a real deployment, with a private home and
 * configuration root (the issue351 idiom). */
function residentFixture(t, label) {
  const root = mkdtempSync(join(testRoot, `.issue620-r-${label}-`));
  const repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 620 Resident Fixture']);
  git(repo, ['config', 'user.email', 'issue620@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']);
  git(repo, ['commit', '-qm', 'base']);
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const env = { XDG_CONFIG_HOME: configRoot, HOME: home };
  const modulePath = join(root, 'deployment.mjs');
  writeFileSync(modulePath, `
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue620 fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', mechanisms: [], configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue620-resident', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
export const createBatonDeployment = async () => openBaton({ repo: process.cwd(), advanced: {
  deploymentRoot: ${JSON.stringify(deploymentRoot)},
  adapters: { codex: adapter() },
  routes: [{ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' }],
  verification: { command: 'node', arguments: ['--test'] },
  resident: { env: ${JSON.stringify(env)}, home: ${JSON.stringify(home)}, webDrainMs: 2_000, sessionTtlMs: 60_000 },
} });
`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, repo, home, configRoot, deploymentRoot, modulePath, env };
}

function worktreeEntry(dir) {
  const base = join(dir, 'base.txt');
  return {
    exists: existsSync(dir),
    entries: existsSync(dir) ? gitOrNull(dir, ['status', '--porcelain', '--ignored']) : null,
    bytes: existsSync(base) ? readFileSync(base, 'utf8') : null,
  };
}

test('620-R: a real resident reclaims the unregistered ended-seat checkout at startup', async (t) => {
  const f = residentFixture(t, 'startup');
  f.baseSha = git(f.repo, ['rev-parse', 'HEAD']);
  const owner = authority('issue620-resident-deployment', 'issue620-resident-controller');
  const a = await ownedWorkspace(f, owner, 'resident-a');
  const b = await ownedWorkspace(f, owner, 'resident-b');
  const c = await ownedWorkspace(f, owner, 'resident-c');
  const idA = a.receipt.physicalOwnerId;
  const idB = b.receipt.physicalOwnerId;
  const idC = c.receipt.physicalOwnerId;
  const tipA = commitFile(a.dir, 'durable.txt', 'issue620 resident durable work\n');
  const tipC = commitFile(c.dir, 'durable.txt', 'issue620 resident registered work\n');
  // ws-A and ws-B leave Git's registration; ws-B and ws-C lose their owner receipt as well.
  unregister(f.repo, idA);
  unregister(f.repo, idB);
  dropReceipt(f.repo, idA);
  dropReceipt(f.repo, idB);
  dropReceipt(f.repo, idC);
  writeFileSync(join(b.dir, 'base.txt'), 'issue620 resident uncommitted edit\n');
  writeFileSync(join(b.dir, 'notes.txt'), 'issue620 resident untracked notes\n');

  const observe = () => ({
    worktrees: git(f.repo, ['worktree', 'list', '--porcelain']),
    a: worktreeEntry(a.dir),
    b: worktreeEntry(b.dir),
    c: worktreeEntry(c.dir),
  });
  const before = observe();

  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', f.modulePath],
    cwd: f.repo,
    env: { ...process.env, HOME: f.home, XDG_CONFIG_HOME: f.configRoot },
  });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal, at: Date.now() }; });

  const deadline = Date.now() + 60_000;
  while (!state.stderr.includes('baton serve: answering (open ')
    && Date.now() < deadline && state.exited === null) {
    await sleep(50);
  }
  assert.equal(state.exited, null, `the serve child stayed up:\n${state.stderr.slice(-2_000)}`);
  assert.ok(state.stderr.includes('baton serve: answering (open '),
    `the serve flip never printed:\n${state.stderr.slice(-2_000)}`);

  const after = observe();
  const evidence = {
    pid: child.pid,
    before,
    after,
    branchA: {
      tip: tipA,
      ref: git(f.repo, ['rev-parse', `refs/heads/baton/${idA}`]),
      durable: git(f.repo, ['show', `baton/${idA}:durable.txt`]),
    },
    branchC: {
      tip: tipC,
      ref: git(f.repo, ['rev-parse', `refs/heads/baton/${idC}`]),
    },
    stderr: state.stderr,
  };
  console.log(`issue620 620-R evidence:\n${JSON.stringify(evidence, null, 2)}`);

  assert.equal(after.a.exists, false, 'the unregistered ended-seat checkout is gone after startup');
  assert.equal(evidence.branchA.ref, tipA, 'the lane branch keeps the unregistered checkout work');
  assert.equal(evidence.branchA.durable, 'issue620 resident durable work');
  assert.equal(after.b.exists, true, 'the checkout holding unpreserved content remains');
  assert.equal(after.b.bytes, 'issue620 resident uncommitted edit\n');
  assert.equal(readFileSync(join(b.dir, 'notes.txt'), 'utf8'), 'issue620 resident untracked notes\n');
  assert.equal(after.c.exists, true, 'the registered checkout remains');
  assert.equal(after.c.bytes, 'base\n');
});

test('620-S: a real resident reclaims the administration-less ended-seat checkout at startup', async (t) => {
  const f = residentFixture(t, 'adminless-startup');
  f.baseSha = git(f.repo, ['rev-parse', 'HEAD']);
  const owner = authority('issue620-resident-deployment', 'issue620-resident-adminless-controller');
  const a = await ownedWorkspace(f, owner, 'adminless-a');
  const b = await ownedWorkspace(f, owner, 'adminless-b');
  const idA = a.receipt.physicalOwnerId;
  const idB = b.receipt.physicalOwnerId;
  const tipA = commitFile(a.dir, 'durable.txt', 'issue620 adminless resident durable work\n');
  // ws-A holds only its branch tree; ws-B gains a modified tracked file and an untracked file the
  // branch does not hold, after the administration entry of each is gone.
  prunedAdministration(f.repo, a.dir);
  prunedAdministration(f.repo, b.dir);
  writeFileSync(join(b.dir, 'base.txt'), 'issue620 adminless resident edited base\n');
  writeFileSync(join(b.dir, 'after-capture.txt'), 'issue620 adminless resident survivor\n');
  dropReceipt(f.repo, idA);
  dropReceipt(f.repo, idB);

  const observe = () => ({
    worktrees: git(f.repo, ['worktree', 'list', '--porcelain']),
    a: worktreeEntry(a.dir),
    b: worktreeEntry(b.dir),
    survivor: existsSync(join(b.dir, 'after-capture.txt'))
      ? readFileSync(join(b.dir, 'after-capture.txt'), 'utf8') : null,
    editedBase: existsSync(join(b.dir, 'base.txt'))
      ? readFileSync(join(b.dir, 'base.txt'), 'utf8') : null,
    aGit: gitOrNull(a.dir, ['rev-parse', 'HEAD']),
    bGit: gitOrNull(b.dir, ['rev-parse', 'HEAD']),
  });
  const before = observe();
  assert.equal(before.aGit, null, 'the seeded checkout answers no Git command before startup');
  assert.equal(before.bGit, null, 'the seeded checkout answers no Git command before startup');

  const child = spawnFixtureResident(t, {
    args: [SCRIPT, 'serve', f.modulePath],
    cwd: f.repo,
    env: { ...process.env, HOME: f.home, XDG_CONFIG_HOME: f.configRoot },
  });
  const state = { stderr: '', exited: null };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  child.on('exit', (code, signal) => { state.exited = { code, signal, at: Date.now() }; });

  const deadline = Date.now() + 60_000;
  while (!state.stderr.includes('baton serve: answering (open ')
    && Date.now() < deadline && state.exited === null) {
    await sleep(50);
  }
  assert.equal(state.exited, null, `the serve child stayed up:\n${state.stderr.slice(-2_000)}`);
  assert.ok(state.stderr.includes('baton serve: answering (open '),
    `the serve flip never printed:\n${state.stderr.slice(-2_000)}`);

  const after = observe();
  const evidence = {
    pid: child.pid,
    before,
    after,
    branchA: {
      tip: tipA,
      ref: git(f.repo, ['rev-parse', `refs/heads/baton/${idA}`]),
      durable: git(f.repo, ['show', `baton/${idA}:durable.txt`]),
    },
    stderr: state.stderr,
  };
  console.log(`issue620 620-S evidence:\n${JSON.stringify(evidence, null, 2)}`);

  assert.equal(after.a.exists, false, 'the administration-less ended-seat checkout is gone');
  assert.equal(evidence.branchA.ref, tipA, 'the lane branch keeps the administration-less work');
  assert.equal(evidence.branchA.durable, 'issue620 adminless resident durable work');
  assert.equal(after.b.exists, true, 'the checkout whose branch does not hold all its content remains');
  assert.equal(after.survivor, 'issue620 adminless resident survivor\n');
  assert.equal(after.editedBase, 'issue620 adminless resident edited base\n');
});
