import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import test from 'node:test';

import { MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import {
  allocatePhysicalWorkspaceOwner, createFromBase, physicalWorkspaceOwnerReceipt, reap,
  reconcile, releasePhysicalWorkspaceOwner,
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
