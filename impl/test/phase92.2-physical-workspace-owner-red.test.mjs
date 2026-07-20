import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import test from 'node:test';

import { MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import {
  allocatePhysicalWorkspaceOwner, createFromBase, physicalWorkspaceOwnerReceipt, reap,
  reconcile, releasePhysicalWorkspaceOwner, listWorktrees,
} from '../src/worktree.mjs';

const git = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).trim();
const digest = (value) => createHash('sha256').update(value).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(label) {
  const world = mkdtempSync(join(tmpdir(), `baton-phase92-2-${label}-`));
  const repo = join(world, 'repo'); mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Phase 92.2 Fixture']);
  git(repo, ['config', 'user.email', 'phase92.2@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']); git(repo, ['commit', '-qm', 'base']);
  return { world, repo, baseSha: git(repo, ['rev-parse', 'HEAD']) };
}

function commonGit(repo) {
  const raw = git(repo, ['rev-parse', '--git-common-dir']);
  return isAbsolute(raw) ? raw : resolve(repo, raw);
}

function canonicalMissingLeaf(path) {
  let cursor = resolve(path); const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return resolve(path);
    suffix.unshift(basename(cursor)); cursor = parent;
  }
  return join(realpathSync(cursor), ...suffix);
}

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

function binding(baseSha) {
  return {
    runId: 'run-shared-logical-identity', attemptId: 'attempt-reviewer-1',
    logicalTaskId: 'same-logical-task', processGeneration: 1, baseSha,
  };
}

async function until(read, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read(); if (value) return value;
    await sleep(5);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const brief = () => createBrief({
  goal: 'hold the physical workspace while independent controllers are reconciled',
  constraints: [], pathScope: ['**'], definitionOfDone: 'wait for an addressed answer',
  verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
  budget: { tokens: 1_000, usd: 1, wallMin: 1 },
});

function blockingAdapter() {
  return new MockAdapter({ scenario: {
    outcome: 'completed', edits: [],
    ask: { kind: 'question', question: 'continue?', blocking: true, afterEditIndex: 0 },
  } });
}

test('P92.2-PO2: exclusive receipt publication is failure-atomic before final-path visibility', (t) => {
  const f = fixture('atomic-owner-receipt-publication');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const ownerRoot = join(commonGit(f.repo), 'baton', 'workspace-owners');
  const originalWriteFileSync = fs.writeFileSync;
  let injected = false;
  fs.writeFileSync = (target, ...args) => {
    if (!injected && typeof target === 'number') {
      injected = true;
      throw Object.assign(new Error('injected receipt temp write failure'), {
        code: 'injected_receipt_publication_failure',
      });
    }
    return originalWriteFileSync(target, ...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(
      () => allocatePhysicalWorkspaceOwner(
        f.repo, binding(f.baseSha), authority('atomic-publication', 'controller-fault'),
      ),
      (error) => error?.code === 'injected_receipt_publication_failure',
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    syncBuiltinESMExports();
  }
  assert.equal(injected, true);
  assert.deepEqual(readdirSync(ownerRoot), [],
    'failed publication leaves neither a malformed target nor an owner temp');

  const retry = allocatePhysicalWorkspaceOwner(
    f.repo, binding(f.baseSha), authority('atomic-publication', 'controller-retry'),
  );
  assert.deepEqual(readdirSync(ownerRoot), [`${retry.physicalOwnerId}.json`]);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, retry.physicalOwnerId)?.receiptDigest,
    retry.receiptDigest);
  assert.equal(releasePhysicalWorkspaceOwner(
    f.repo, retry.physicalOwnerId, { requireAllocated: true },
  ), true);
  assert.deepEqual(readdirSync(ownerRoot), []);
});

test('P92.2-PO2: exclusive publication has an exact durable-link commit boundary', async (t) => {
  const cases = [
    { label: 'link', fault: 'link', returns: false, unknown: false },
    { label: 'first-dir-fsync', fault: 'first-dir-fsync', returns: false, unknown: false },
    { label: 'target-cleanup', fault: 'target-cleanup', returns: false, unknown: true },
    { label: 'temp-unlink', fault: 'temp-unlink', returns: true, unknown: false },
    { label: 'second-dir-fsync', fault: 'second-dir-fsync', returns: true, unknown: false },
  ];
  for (const row of cases) await t.test(row.label, () => {
    const f = fixture(`publication-${row.label}`);
    const ownerRoot = join(commonGit(f.repo), 'baton', 'workspace-owners');
    const ownerAuthority = authority(`publication-${row.label}`, 'controller');
    const original = {
      fsyncSync: fs.fsyncSync, linkSync: fs.linkSync, rmSync: fs.rmSync,
    };
    let fsyncCalls = 0;
    fs.fsyncSync = (fd) => {
      fsyncCalls += 1;
      if ((row.fault === 'first-dir-fsync' || row.fault === 'target-cleanup')
        && fsyncCalls === 2) throw Object.assign(new Error('injected first directory fsync'), { code: 'injected_first_dir_fsync' });
      if (row.fault === 'second-dir-fsync' && fsyncCalls === 3) {
        throw Object.assign(new Error('injected cleanup directory fsync'), { code: 'injected_second_dir_fsync' });
      }
      return original.fsyncSync(fd);
    };
    fs.linkSync = (...args) => {
      if (row.fault === 'link') throw Object.assign(new Error('injected link refusal'), { code: 'injected_link_failure' });
      return original.linkSync(...args);
    };
    fs.rmSync = (target, ...args) => {
      const path = String(target);
      if (row.fault === 'target-cleanup' && path.endsWith('.json')) {
        throw Object.assign(new Error('injected final target cleanup refusal'), { code: 'injected_target_cleanup_failure' });
      }
      if (row.fault === 'temp-unlink' && path.includes('.json.tmp-')) {
        throw Object.assign(new Error('injected publication temp cleanup refusal'), { code: 'injected_temp_cleanup_failure' });
      }
      return original.rmSync(target, ...args);
    };
    syncBuiltinESMExports();
    let receipt = null; let failure = null;
    try {
      receipt = allocatePhysicalWorkspaceOwner(f.repo, binding(f.baseSha), ownerAuthority);
    } catch (error) { failure = error; }
    fs.fsyncSync = original.fsyncSync;
    fs.linkSync = original.linkSync;
    fs.rmSync = original.rmSync;
    syncBuiltinESMExports();
    try {
      assert.equal(Boolean(receipt), row.returns);
      assert.equal(failure?.code === 'workspace_owner_publication_unknown', row.unknown);
      if (!row.returns && !row.unknown) assert.ok(failure);

      if (row.unknown) {
        assert.match(failure.physicalOwnerId, /^ws-[a-f0-9]{32}$/u);
        assert.equal(failure.ownerReceipt.physicalOwnerId, failure.physicalOwnerId);
        assert.equal(physicalWorkspaceOwnerReceipt(f.repo, failure.physicalOwnerId)?.receiptDigest,
          failure.ownerReceipt.receiptDigest);
      }
      const retried = allocatePhysicalWorkspaceOwner(f.repo, binding(f.baseSha), ownerAuthority);
      if (receipt) assert.equal(retried.physicalOwnerId, receipt.physicalOwnerId);
      if (failure?.physicalOwnerId) assert.equal(retried.physicalOwnerId, failure.physicalOwnerId);
      assert.deepEqual(readdirSync(ownerRoot), [`${retried.physicalOwnerId}.json`],
        'retry leaves one durable final receipt and no publication temp');
      assert.equal(releasePhysicalWorkspaceOwner(
        f.repo, retried.physicalOwnerId, { requireAllocated: true },
      ), true);
    } finally {
      rmSync(f.world, { recursive: true, force: true });
    }
  });
});

test('P92.2-PO2: allocated publication temp cannot survive ready rewrite and cleanup', async (t) => {
  const f = fixture('allocated-temp-ready-cleanup');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const ownerRoot = join(commonGit(f.repo), 'baton', 'workspace-owners');
  const originalRmSync = fs.rmSync;
  let refusedTemp = false;
  fs.rmSync = (target, ...args) => {
    if (!refusedTemp && String(target).includes('.json.tmp-')) {
      refusedTemp = true;
      throw Object.assign(new Error('injected allocated temp unlink refusal'), {
        code: 'injected_allocated_temp_unlink',
      });
    }
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  let receipt;
  try {
    receipt = allocatePhysicalWorkspaceOwner(
      f.repo, binding(f.baseSha), authority('temp-ready-cleanup', 'controller'),
    );
  } finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  assert.equal(refusedTemp, true);
  assert.equal(readdirSync(ownerRoot).filter((name) => name.includes('.json.tmp-')).length, 1);
  await createFromBase(f.repo, receipt.physicalOwnerId, f.baseSha, { ownerReceipt: receipt });
  await reap(f.repo, receipt.physicalOwnerId, { force: true, deleteBranch: true });
  assert.deepEqual(readdirSync(ownerRoot), [],
    'ready-state inode replacement cannot strand an allocated publication alias');
});

test('P92.2-PO2: restart reconciles an exact dead-controller temp-only publication', (t) => {
  const f = fixture('dead-controller-temp-publication');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const ownerRoot = join(commonGit(f.repo), 'baton', 'workspace-owners');
  const before = authority('temp-restart-deployment', 'controller-before');
  const originalRmSync = fs.rmSync;
  let refusedTemp = false;
  fs.rmSync = (target, ...args) => {
    if (!refusedTemp && String(target).includes('.json.tmp-')) {
      refusedTemp = true;
      throw new Error('injected temp retention before restart');
    }
    return originalRmSync(target, ...args);
  };
  syncBuiltinESMExports();
  let receipt;
  try { receipt = allocatePhysicalWorkspaceOwner(f.repo, binding(f.baseSha), before); }
  finally {
    fs.rmSync = originalRmSync;
    syncBuiltinESMExports();
  }
  rmSync(canonicalMissingLeaf(join(ownerRoot, `${receipt.physicalOwnerId}.json`)));
  assert.deepEqual(readdirSync(ownerRoot), readdirSync(ownerRoot).filter((name) => (
    name.startsWith(`${receipt.physicalOwnerId}.json.tmp-`)
  )));
  const settled = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: authority('temp-restart-deployment', 'controller-after'),
    beforeOwnerCleanup: (physicalOwnerId) => { settled.push(physicalOwnerId); return true; },
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(settled, [receipt.physicalOwnerId]);
  assert.deepEqual(report.removedPhysicalOwners, [receipt.physicalOwnerId]);
  assert.deepEqual(readdirSync(ownerRoot), []);
});

test('P92.2-PO1/PO2: concurrent controllers keep one logical task but allocate disjoint opaque physical owners', async (t) => {
  const f = fixture('concurrent');
  let first; let second;
  t.after(async () => {
    for (const driver of [first, second]) {
      try { await driver?.drainAndClose('phase92.2:test'); }
      catch { try { driver?.coordination.releaseWriterLease(); } catch { /* best effort */ } }
    }
    rmSync(f.world, { recursive: true, force: true });
  });
  first = createDriver({ repoRoot: f.repo, repoId: 'repo-phase92-2', logDir: join(f.world, 'deployment-a'), adapters: { mock: blockingAdapter() } });
  second = createDriver({ repoRoot: f.repo, repoId: 'repo-phase92-2', logDir: join(f.world, 'deployment-b'), adapters: { mock: blockingAdapter() } });
  const callerNominatedOwner = 'caller-chosen-owner';

  const [a, b] = await Promise.all([
    first.coordinator.spawn('mock', brief(), {
      taskId: 'same-logical-task', runId: 'same-logical-run', physicalOwnerId: callerNominatedOwner,
    }),
    second.coordinator.spawn('mock', brief(), { taskId: 'same-logical-task', runId: 'same-logical-run' }),
  ]);
  const [liveA, liveB] = await Promise.all([
    until(() => first.coordinator.list().find((row) => row.id === a.id)?.sessionContext, 'controller A worktree'),
    until(() => second.coordinator.list().find((row) => row.id === b.id)?.sessionContext, 'controller B worktree'),
  ]);

  assert.notEqual(liveA.ownerTaskId, liveB.ownerTaskId);
  assert.match(liveA.ownerTaskId, /^ws-[a-f0-9]{32}$/u);
  assert.match(liveB.ownerTaskId, /^ws-[a-f0-9]{32}$/u);
  assert.notEqual(liveA.ownerTaskId, callerNominatedOwner);
  assert.notEqual(liveA.branch, liveB.branch);
  assert.equal(first.coordinator.list()[0].taskId, 'same-logical-task');
  assert.equal(second.coordinator.list()[0].taskId, 'same-logical-task');

  for (const [driver, context] of [[first, liveA], [second, liveB]]) {
    const ownerBound = driver.log.read(driver.coordinator.list()[0].id)
      .find((event) => event.kind === 'worktree.owner_bound');
    assert.deepEqual({
      physicalOwnerId: ownerBound.payload.physicalOwnerId,
      branch: ownerBound.payload.branch,
      worktree: ownerBound.payload.worktree,
      baseSha: ownerBound.payload.baseSha,
      logicalTaskId: ownerBound.payload.logicalTaskId,
      runId: ownerBound.payload.runId,
      processGeneration: ownerBound.payload.processGeneration,
    }, {
      physicalOwnerId: context.ownerTaskId,
      branch: context.branch,
      worktree: context.worktree,
      baseSha: f.baseSha,
      logicalTaskId: 'same-logical-task',
      runId: 'same-logical-run',
      processGeneration: 1,
    });
  }

  const cross = second.coordinator._worktrees.reconcile([liveB.ownerTaskId]);
  assert.equal(existsSync(liveA.worktree), true);
  assert.equal(existsSync(liveB.worktree), true);
  assert.ok(cross.diagnostics.some((row) => row.code === 'workspace_owner_live_foreign'
    && row.physicalOwnerId === liveA.ownerTaskId));

  await Promise.all([first.drainAndClose('phase92.2:first'), second.drainAndClose('phase92.2:second')]);
  first = null; second = null;
  assert.equal(git(f.repo, ['branch', '--list', 'baton/ws-*']), '');
  assert.deepEqual(git(f.repo, ['worktree', 'list', '--porcelain']).split('\n')
    .filter((line) => line.startsWith('worktree ')).length, 1);
  const receipts = join(commonGit(f.repo), 'baton', 'workspace-owners');
  assert.equal(!existsSync(receipts) || readdirSync(receipts).length === 0, true);
});

test('P92.2-PO3: a symlinked deployment root preserves receipt-bound resume and self-committed capture identity', async (t) => {
  const f = fixture('symlinked-root');
  const repoAlias = join(f.world, 'repo-alias');
  symlinkSync(f.repo, repoAlias, 'dir');
  let driver;
  t.after(async () => {
    try { await driver?.drainAndClose('phase92.2:symlinked-root'); }
    catch { try { driver?.coordination.releaseWriterLease(); } catch { /* best effort */ } }
    rmSync(f.world, { recursive: true, force: true });
  });
  driver = createDriver({
    repoRoot: repoAlias,
    repoId: 'repo-phase92-2-symlinked',
    logDir: join(f.world, 'deployment'),
    adapters: { mock: new MockAdapter({ scenario: {
      outcome: 'completed', edits: [{ path: 'captured.txt', content: 'captured through alias\n' }],
    } }) },
  });

  const handle = await driver.coordinator.spawn('mock', brief(), {
    taskId: 'symlinked-logical-task', runId: 'symlinked-run',
  });
  const outcome = await until(async () => {
    const current = await driver.coordinator.result(handle.id);
    return current.ready ? current : null;
  }, 'symlinked task completion');
  const context = driver.coordinator.list().find((row) => row.id === handle.id).sessionContext;
  const receipt = physicalWorkspaceOwnerReceipt(repoAlias, context.ownerTaskId);
  const verification = driver.log.read(handle.id).find((event) => event.kind === 'verify.reverified');

  assert.equal(outcome.status, 'completed');
  assert.notEqual(resolve(context.worktree), realpathSync(context.worktree));
  assert.equal(receipt.receiptDigest, context.ownerReceiptDigest);
  assert.equal(driver.coordinator._worktrees.worktreeAvailable('symlinked-logical-task', context), true);
  assert.deepEqual(await driver.coordinator._worktrees.validateSessionContext(context), { ok: true });
  assert.equal(readFileSync(join(context.worktree, 'captured.txt'), 'utf8'), 'captured through alias\n');
  assert.equal(verification.payload.capture.snapshotted, false);
});

test('P92.2-RC1/RC2: branch-only response loss is reaped once after exact local-deployment restart proof', (t) => {
  const f = fixture('response-loss');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const firstAuthority = authority('deployment-stable', 'controller-before-crash');
  const receipt = allocatePhysicalWorkspaceOwner(f.repo, binding(f.baseSha), firstAuthority);
  git(f.repo, ['branch', receipt.branch, f.baseSha]);
  assert.equal(existsSync(receipt.worktree), false);
  assert.ok(physicalWorkspaceOwnerReceipt(f.repo, receipt.physicalOwnerId));

  const restarted = authority('deployment-stable', 'controller-after-restart');
  const events = [];
  const report = reconcile(f.repo, [], { ownerAuthority: restarted, log: { append: (event) => events.push(event) } });
  assert.deepEqual(report.errors, []);
  assert.equal(git(f.repo, ['branch', '--list', receipt.branch]), '');
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, receipt.physicalOwnerId), null);
  assert.deepEqual(events.filter((event) => event.kind === 'worktree.branch_residue_reconciled').length, 1);

  const replay = reconcile(f.repo, [], { ownerAuthority: restarted, log: { append: (event) => events.push(event) } });
  assert.deepEqual(replay.errors, []);
  assert.deepEqual(events.filter((event) => event.kind === 'worktree.branch_residue_reconciled').length, 1);
});

test('P92.2-RC1: pre-branch intent and registered response loss are reconciled only by the restarted deployment', async (t) => {
  const f = fixture('effect-boundaries');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const beforeCrash = authority('deployment-stable', 'controller-before-crash');
  const intent = allocatePhysicalWorkspaceOwner(f.repo, binding(f.baseSha), beforeCrash);
  const registered = allocatePhysicalWorkspaceOwner(f.repo, {
    ...binding(f.baseSha), attemptId: 'attempt-registration-boundary', processGeneration: 2,
  }, beforeCrash);
  const created = await createFromBase(f.repo, registered.physicalOwnerId, f.baseSha, { ownerReceipt: registered });
  assert.equal(existsSync(intent.worktree), false);
  assert.equal(existsSync(created.dir), true);

  const restarted = authority('deployment-stable', 'controller-after-restart');
  const report = reconcile(f.repo, [], { ownerAuthority: restarted });
  assert.deepEqual(report.errors, []);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, intent.physicalOwnerId), null);
  assert.equal(physicalWorkspaceOwnerReceipt(f.repo, registered.physicalOwnerId), null);
  assert.equal(existsSync(created.dir), false);
  assert.equal(git(f.repo, ['branch', '--list', created.branch]), '');
});

test('P92.2-RC2: dead foreign registered authority and a mismatched local branch are retained diagnostically', async (t) => {
  const f = fixture('retention-edges');
  t.after(async () => {
    for (const receipt of [foreign, mismatched]) {
      try { await reap(f.repo, receipt.physicalOwnerId, { force: true, deleteBranch: true }); } catch { /* fixture removal remains */ }
      try { releasePhysicalWorkspaceOwner(f.repo, receipt.physicalOwnerId); } catch { /* fixture removal remains */ }
    }
    rmSync(f.world, { recursive: true, force: true });
  });
  const deadForeignAuthority = {
    deploymentId: digest('foreign-deployment'), controllerId: digest('foreign-dead-controller'),
    pid: 2_147_483_647, pidStart: 'definitely-not-a-live-process',
  };
  const foreign = allocatePhysicalWorkspaceOwner(f.repo, binding(f.baseSha), deadForeignAuthority);
  await createFromBase(f.repo, foreign.physicalOwnerId, f.baseSha, { ownerReceipt: foreign });

  const localBefore = authority('local-deployment', 'local-before-crash');
  const mismatched = allocatePhysicalWorkspaceOwner(f.repo, {
    ...binding(f.baseSha), attemptId: 'attempt-mismatched-branch', processGeneration: 3,
  }, localBefore);
  git(f.repo, ['commit', '--allow-empty', '-qm', 'different branch target']);
  git(f.repo, ['branch', mismatched.branch, 'HEAD']);
  const localAfter = authority('local-deployment', 'local-after-restart');

  const report = reconcile(f.repo, [], { ownerAuthority: localAfter });
  assert.deepEqual(report.errors, []);
  assert.ok(report.diagnostics.some((row) => row.code === 'workspace_owner_dead_foreign_checkout'
    && row.physicalOwnerId === foreign.physicalOwnerId && row.retained === true));
  assert.ok(report.diagnostics.some((row) => row.code === 'workspace_owner_branch_mismatch'
    && row.physicalOwnerId === mismatched.physicalOwnerId && row.retained === true));
  assert.equal(existsSync(foreign.worktree), true);
  assert.equal(git(f.repo, ['branch', '--list', mismatched.branch]), mismatched.branch);
});

test('P92.2-RC3: live and malformed foreign branch authority is retained with typed diagnostics', (t) => {
  const f = fixture('foreign');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const receipt = allocatePhysicalWorkspaceOwner(
    f.repo, binding(f.baseSha), authority('foreign-deployment', 'foreign-live-controller'),
  );
  git(f.repo, ['branch', receipt.branch, f.baseSha]);

  const local = authority('local-deployment', 'local-controller');
  const live = reconcile(f.repo, [], { ownerAuthority: local });
  assert.deepEqual(live.errors, []);
  assert.ok(live.diagnostics.some((row) => row.code === 'workspace_owner_live_foreign'
    && row.physicalOwnerId === receipt.physicalOwnerId && row.retained === true));
  assert.equal(git(f.repo, ['branch', '--list', receipt.branch]), receipt.branch);

  const receiptPath = join(commonGit(f.repo), 'baton', 'workspace-owners', `${receipt.physicalOwnerId}.json`);
  writeFileSync(receiptPath, '{"schemaVersion":1}\n', { mode: 0o600 });
  const malformed = reconcile(f.repo, [], { ownerAuthority: local });
  assert.ok(malformed.diagnostics.some((row) => row.code === 'workspace_owner_receipt_invalid'
    && row.physicalOwnerId === receipt.physicalOwnerId && row.retained === true));
  assert.equal(git(f.repo, ['branch', '--list', receipt.branch]), receipt.branch);
});

test('P92.2-PO2/RC1: restart capacity settlement gates checkout, admin-only, branch-only, and pre-branch cleanup', async (t) => {
  const f = fixture('capacity-first-reconcile');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));
  const before = authority('capacity-first-deployment', 'controller-before-crash');
  const registered = allocatePhysicalWorkspaceOwner(f.repo, {
    ...binding(f.baseSha), attemptId: 'attempt-registered-capacity-first',
  }, before);
  await createFromBase(f.repo, registered.physicalOwnerId, f.baseSha, {
    ownerReceipt: registered,
  });
  const adminOnly = allocatePhysicalWorkspaceOwner(f.repo, {
    ...binding(f.baseSha), attemptId: 'attempt-admin-capacity-first',
  }, before);
  await createFromBase(f.repo, adminOnly.physicalOwnerId, f.baseSha, {
    ownerReceipt: adminOnly,
  });
  rmSync(adminOnly.worktree, { recursive: true });
  const branchOnly = allocatePhysicalWorkspaceOwner(f.repo, {
    ...binding(f.baseSha), attemptId: 'attempt-branch-capacity-first',
  }, before);
  git(f.repo, ['branch', branchOnly.branch, f.baseSha]);
  const preBranch = allocatePhysicalWorkspaceOwner(f.repo, {
    ...binding(f.baseSha), attemptId: 'attempt-prebranch-capacity-first',
  }, before);
  const restarted = authority('capacity-first-deployment', 'controller-after-crash');
  const receipts = [registered, adminOnly, branchOnly, preBranch];
  const assertRetained = () => {
    for (const receipt of receipts) {
      assert.ok(physicalWorkspaceOwnerReceipt(f.repo, receipt.physicalOwnerId));
    }
    assert.equal(existsSync(registered.worktree), true);
    assert.equal(existsSync(adminOnly.worktree), false);
    assert.notEqual(git(f.repo, ['branch', '--list', registered.branch]), '');
    assert.notEqual(git(f.repo, ['branch', '--list', branchOnly.branch]), '');
    assert.equal(git(f.repo, ['branch', '--list', preBranch.branch]), '');
    assert.equal(listWorktrees(f.repo).some((entry) => (
      canonicalMissingLeaf(entry.dir) === canonicalMissingLeaf(adminOnly.worktree)
    )), true,
      'capacity refusal retains exact admin-only registration');
    assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('\n')
      .filter((line) => line.startsWith('worktree '))
      .some((line) => canonicalMissingLeaf(line.slice('worktree '.length))
        === canonicalMissingLeaf(registered.worktree)), true);
  };

  const refused = reconcile(f.repo, [], {
    ownerAuthority: restarted,
    beforeOwnerCleanup: () => false,
  });
  assert.equal(refused.diagnostics.filter((row) => (
    row.code === 'workspace_owner_capacity_settlement_refused' && row.retained === true
  )).length, 4);
  assertRetained();

  const settledOwners = [];
  const settled = reconcile(f.repo, [], {
    ownerAuthority: restarted,
    beforeOwnerCleanup: (physicalOwnerId) => {
      const receipt = receipts.find((row) => row.physicalOwnerId === physicalOwnerId);
      assert.ok(physicalWorkspaceOwnerReceipt(f.repo, physicalOwnerId));
      if (receipt === registered) assert.equal(existsSync(receipt.worktree), true);
      if (receipt === adminOnly) {
        assert.equal(listWorktrees(f.repo).some((entry) => (
          canonicalMissingLeaf(entry.dir) === canonicalMissingLeaf(receipt.worktree)
        )), true);
      }
      if (receipt === branchOnly) {
        assert.notEqual(git(f.repo, ['branch', '--list', receipt.branch]), '');
      }
      settledOwners.push(physicalOwnerId);
      return true;
    },
  });
  assert.deepEqual(settled.errors, []);
  assert.deepEqual(new Set(settledOwners), new Set(receipts.map((row) => row.physicalOwnerId)));
  for (const receipt of receipts) {
    assert.equal(physicalWorkspaceOwnerReceipt(f.repo, receipt.physicalOwnerId), null);
    assert.equal(git(f.repo, ['branch', '--list', receipt.branch]), '');
  }
  assert.equal(existsSync(registered.worktree), false);
  assert.equal(listWorktrees(f.repo).some((entry) => (
    canonicalMissingLeaf(entry.dir) === canonicalMissingLeaf(adminOnly.worktree)
  )), false);
  assert.equal(git(f.repo, ['worktree', 'list', '--porcelain']).split('\n')
    .some((line) => line === `worktree ${registered.worktree}`), false);
});
