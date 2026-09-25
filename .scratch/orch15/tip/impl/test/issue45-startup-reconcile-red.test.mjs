import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import test from 'node:test';

import { MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import { allocatePhysicalWorkspaceOwner, reconcile } from '../src/worktree.mjs';

// ---------------------------------------------------------------------------
// Deterministic fixtures: dead controllers are proven by process identity (a
// pid that cannot be live plus a mismatched pidStart) and by cross-deployment
// authority, never by wall-clock expiry — nothing here reads Date.now().
// ---------------------------------------------------------------------------

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

function fixture(label) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue45-${label}-`));
  const repo = join(world, 'repo'); mkdirSync(repo);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.name', 'Issue 45 Fixture']);
  git(repo, ['config', 'user.email', 'issue45@example.invalid']);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(repo, ['add', 'base.txt']); git(repo, ['commit', '-qm', 'base']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'divergent.txt'), 'divergent\n');
  git(repo, ['add', 'divergent.txt']); git(repo, ['commit', '-qm', 'divergent']);
  const divergentSha = git(repo, ['rev-parse', 'HEAD']);
  return { world, repo, baseSha, divergentSha };
}

function commonGit(repo) {
  const raw = git(repo, ['rev-parse', '--git-common-dir']);
  return isAbsolute(raw) ? raw : resolve(repo, raw);
}

function ownerRoot(repo) { return join(commonGit(repo), 'baton', 'workspace-owners'); }
function receiptPath(repo, id) { return join(ownerRoot(repo), `${id}.json`); }

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

// Re-seal an existing on-disk receipt after mutating its core (e.g. flipping the
// closed-state field) using the same canonical-JSON sha256 the implementation uses.
function reseal(repo, id, mutate) {
  const p = receiptPath(repo, id);
  const { receiptDigest: _prior, ...core } = JSON.parse(readFileSync(p, 'utf8'));
  mutate(core);
  const next = {
    ...core, receiptDigest: createHash('sha256').update(JSON.stringify(canonical(core))).digest('hex'),
  };
  writeFileSync(p, JSON.stringify(next), { mode: 0o600 });
  chmodSync(p, 0o600);
  return next;
}

// A cross-deployment controller whose pid cannot be live → dead_foreign authority.
function deadForeignAuthority(tag) {
  return {
    deploymentId: digest('issue45-foreign-dead-deployment'),
    controllerId: digest(`issue45-dead-controller-${tag}`),
    pid: 2_147_483_647, pidStart: 'issue45-not-a-live-process',
  };
}

// A cross-deployment controller whose pid/pidStart match this live process → live_foreign.
function liveForeignAuthority(tag) {
  return {
    deploymentId: digest('issue45-foreign-live-deployment'),
    controllerId: digest(`issue45-live-controller-${tag}`),
    pid: process.pid, pidStart: processStart(),
  };
}

// A live LOCAL restart authority (same-process, distinct controller) — the reconcile actor.
function localRestartAuthority() {
  return {
    deploymentId: digest('issue45-local-restart-deployment'),
    controllerId: digest('issue45-local-restart-controller'),
    pid: process.pid, pidStart: processStart(),
  };
}

function bindingFor(baseSha, attemptId) {
  return {
    runId: 'issue45-run', attemptId, logicalTaskId: 'issue45-logical',
    processGeneration: 1, baseSha,
  };
}

// Mint a proof-complete dead-foreign receipt (worktree absent) in a closed state.
// When `branchAt` is provided the branch ref is created at that sha.
function mintDead(repo, baseSha, { attemptId, state, branchAt = null }) {
  const receipt = allocatePhysicalWorkspaceOwner(
    repo, bindingFor(baseSha, attemptId), deadForeignAuthority(attemptId),
  );
  reseal(repo, receipt.physicalOwnerId, (core) => { core.state = state; });
  if (branchAt) git(repo, ['branch', receipt.branch, branchAt]);
  return {
    id: receipt.physicalOwnerId, branch: receipt.branch, baseSha: receipt.baseSha,
    worktree: receipt.worktree, logicalTaskId: receipt.logicalTaskId,
    processGeneration: receipt.processGeneration,
  };
}

function mintLiveForeign(repo, baseSha, tag) {
  const receipt = allocatePhysicalWorkspaceOwner(
    repo, bindingFor(baseSha, `${tag}-attempt`), liveForeignAuthority(tag),
  );
  reseal(repo, receipt.physicalOwnerId, (core) => { core.state = 'ready'; });
  return { id: receipt.physicalOwnerId };
}

function reconciledEvents(events, id) {
  return events.filter((event) => (
    event.worker === id
    && (event.kind === 'worktree.branch_residue_reconciled'
      || event.kind === 'worktree.owner_residue_reconciled')
  ));
}

const REMEDY = 'delete the named records under .git/baton/workspace-owners/ after proving their '
  + 'controllers dead, or restore their worktrees';

const brief = () => createBrief({
  goal: 'reconcile proof-complete owner residue at startup',
  constraints: [], pathScope: ['**'], definitionOfDone: 'startup reconciliation self-heals',
  verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
  budget: { tokens: 1_000, usd: 1, wallMin: 1 },
});

function openDeployment(repo, world) {
  return createDriver({
    repoRoot: repo, repoId: 'issue45-repo', logDir: join(world, 'deployment'),
    adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed', edits: [] } }) },
  });
}

async function closeDeployment(driver) {
  if (!driver) return;
  try { await driver.drainAndClose('issue45:test'); }
  catch { try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ } }
}

// ---------------------------------------------------------------------------
// R45-1 — proof-complete residue self-heals; a live record beside it is untouched.
// ---------------------------------------------------------------------------

test('R45-1: proof-complete dead residue self-heals while the live record is untouched', async (t) => {
  const f = fixture('r45-1');
  let driver;
  t.after(async () => { await closeDeployment(driver); rmSync(f.world, { recursive: true, force: true }); });

  const dead = mintDead(f.repo, f.baseSha, { attemptId: 'r45-1-dead', state: 'ready', branchAt: f.baseSha });
  const live = mintLiveForeign(f.repo, f.baseSha, 'r45-1-live');
  const liveBefore = readFileSync(receiptPath(f.repo, live.id), 'utf8');

  // Direct reconcile proves the mechanics: gate-free release, capacity settlement, one event.
  const events = []; const settled = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: localRestartAuthority(),
    beforeOwnerCleanup: (id) => { settled.push(id); return true; },
    log: { append: (event) => events.push(event) },
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.removedPhysicalOwners, [dead.id]);
  assert.deepEqual(settled, [dead.id]);
  assert.equal(existsSync(receiptPath(f.repo, dead.id)), false);
  assert.equal(git(f.repo, ['branch', '--list', dead.branch]), '');
  const reconciled = reconciledEvents(events, dead.id);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].kind, 'worktree.branch_residue_reconciled');
  assert.deepEqual(reconciled[0].payload, {
    branch: dead.branch, baseSha: dead.baseSha,
    logicalTaskId: dead.logicalTaskId, processGeneration: dead.processGeneration,
  });
  assert.ok(report.diagnostics.some((row) => (
    row.code === 'workspace_owner_live_foreign' && row.physicalOwnerId === live.id
  )));
  assert.equal(readFileSync(receiptPath(f.repo, live.id), 'utf8'), liveBefore);

  // The facade must forward its log so the same self-heal fires through a real open.
  const dead2 = mintDead(f.repo, f.baseSha, { attemptId: 'r45-1-dead-open', state: 'ready', branchAt: f.baseSha });
  driver = openDeployment(f.repo, f.world);
  await driver.coordinator.startupReady();
  assert.equal(existsSync(receiptPath(f.repo, dead2.id)), false);
  assert.equal(git(f.repo, ['branch', '--list', dead2.branch]), '');
  const forwarded = reconciledEvents(driver.log.read(dead2.id), dead2.id);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].kind, 'worktree.branch_residue_reconciled');
  assert.equal(existsSync(receiptPath(f.repo, live.id)), true);
});

// ---------------------------------------------------------------------------
// R45-2 — all three closed states self-heal; the no-branch variant emits the
// sibling owner_residue_reconciled event.
// ---------------------------------------------------------------------------

test('R45-2: allocated, ready and stopped residue self-heal (branch + no-branch events)', (t) => {
  const f = fixture('r45-2');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));

  const branched = ['allocated', 'ready', 'stopped'].map((state) => mintDead(
    f.repo, f.baseSha, { attemptId: `r45-2-${state}`, state, branchAt: f.baseSha },
  ));
  const bare = mintDead(f.repo, f.baseSha, { attemptId: 'r45-2-bare', state: 'ready' });

  const events = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: localRestartAuthority(),
    log: { append: (event) => events.push(event) },
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(
    [...report.removedPhysicalOwners].sort(),
    [...branched.map((r) => r.id), bare.id].sort(),
  );

  for (const record of branched) {
    assert.equal(existsSync(receiptPath(f.repo, record.id)), false, record.id);
    assert.equal(git(f.repo, ['branch', '--list', record.branch]), '');
    const reconciled = reconciledEvents(events, record.id);
    assert.equal(reconciled.length, 1, record.id);
    assert.equal(reconciled[0].kind, 'worktree.branch_residue_reconciled', record.id);
  }

  // No branch remained → the sibling owner_residue_reconciled event carries the receipt fields.
  assert.equal(existsSync(receiptPath(f.repo, bare.id)), false);
  const bareEvents = reconciledEvents(events, bare.id);
  assert.equal(bareEvents.length, 1);
  assert.equal(bareEvents[0].kind, 'worktree.owner_residue_reconciled');
  assert.deepEqual(bareEvents[0].payload, {
    branch: bare.branch, baseSha: bare.baseSha,
    logicalTaskId: bare.logicalTaskId, processGeneration: bare.processGeneration,
  });
});

// ---------------------------------------------------------------------------
// R45-3 — a branch-sha mismatch is ambiguous residue: retained, and the open
// refuses with the named record, remedy, and the underlying report as cause.
// ---------------------------------------------------------------------------

test('R45-3: branch-mismatch residue is retained and the open refuses with a named remedy', async (t) => {
  const f = fixture('r45-3');
  let driver;
  t.after(async () => { await closeDeployment(driver); rmSync(f.world, { recursive: true, force: true }); });

  const dead = mintDead(f.repo, f.baseSha, { attemptId: 'r45-3', state: 'ready', branchAt: f.divergentSha });
  driver = openDeployment(f.repo, f.world);
  await assert.rejects(driver.coordinator.startupReady(), (error) => {
    assert.equal(error.code, 'coordinator_cleanup_incomplete');
    assert.equal(error.cause?.code, 'worktree_cleanup_failed');
    assert.ok(error.cause.report.diagnostics.some((row) => (
      row.code === 'workspace_owner_branch_mismatch' && row.physicalOwnerId === dead.id
    )));
    assert.ok(error.message.includes(dead.id), 'names the retained record');
    assert.ok(error.message.includes(REMEDY), 'includes the remedy sentence');
    return true;
  });
  assert.equal(existsSync(receiptPath(f.repo, dead.id)), true);
  assert.equal(git(f.repo, ['branch', '--list', dead.branch]), dead.branch);
});

// ---------------------------------------------------------------------------
// R45-4 — a live-foreign receipt proceeds (retained, no release attempted).
// ---------------------------------------------------------------------------

test('R45-4: a live-foreign receipt is retained with no release attempted', (t) => {
  const f = fixture('r45-4');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));

  const live = mintLiveForeign(f.repo, f.baseSha, 'r45-4');
  const events = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: localRestartAuthority(),
    log: { append: (event) => events.push(event) },
  });
  assert.ok(report.diagnostics.some((row) => (
    row.code === 'workspace_owner_live_foreign' && row.physicalOwnerId === live.id && row.retained === true
  )));
  assert.equal(report.removedPhysicalOwners.includes(live.id), false);
  assert.equal(reconciledEvents(events, live.id).length, 0);
  assert.equal(existsSync(receiptPath(f.repo, live.id)), true);
});

// ---------------------------------------------------------------------------
// R45-5 — a dead-foreign receipt whose worktree still exists is claimed by
// loop 1 and retained as workspace_owner_dead_foreign_checkout (proceed set).
// ---------------------------------------------------------------------------

test('R45-5: dead-foreign with a present worktree is retained as dead_foreign_checkout', (t) => {
  const f = fixture('r45-5');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));

  const dead = mintDead(f.repo, f.baseSha, { attemptId: 'r45-5', state: 'ready' });
  mkdirSync(dead.worktree, { recursive: true });

  const events = [];
  const report = reconcile(f.repo, [], {
    ownerAuthority: localRestartAuthority(),
    log: { append: (event) => events.push(event) },
  });
  assert.ok(report.diagnostics.some((row) => (
    row.code === 'workspace_owner_dead_foreign_checkout' && row.physicalOwnerId === dead.id
      && row.retained === true
  )));
  assert.equal(report.removedPhysicalOwners.includes(dead.id), false);
  assert.equal(reconciledEvents(events, dead.id).length, 0);
  assert.equal(existsSync(receiptPath(f.repo, dead.id)), true);
});

// ---------------------------------------------------------------------------
// R45-6 — scoped idempotence: a second reconcile after a heal removes nothing
// more and emits no further reconcile-emitted events.
// ---------------------------------------------------------------------------

test('R45-6: a second reconcile after a heal is idempotent for reconcile-emitted effects', (t) => {
  const f = fixture('r45-6');
  t.after(() => rmSync(f.world, { recursive: true, force: true }));

  const dead = mintDead(f.repo, f.baseSha, { attemptId: 'r45-6', state: 'ready', branchAt: f.baseSha });
  const events = [];
  const first = reconcile(f.repo, [], {
    ownerAuthority: localRestartAuthority(),
    log: { append: (event) => events.push(event) },
  });
  assert.deepEqual(first.removedPhysicalOwners, [dead.id]);
  assert.equal(reconciledEvents(events, dead.id).length, 1);

  const second = reconcile(f.repo, [], {
    ownerAuthority: localRestartAuthority(),
    log: { append: (event) => events.push(event) },
  });
  assert.deepEqual(second.errors, []);
  assert.deepEqual(second.removedPhysicalOwners, []);
  assert.equal(reconciledEvents(events, dead.id).length, 1);
});

// ---------------------------------------------------------------------------
// R45-7 — an unparseable receipt is retained as receipt_invalid and named in
// the refusal.
// ---------------------------------------------------------------------------

test('R45-7: an unparseable receipt is retained as receipt_invalid and named in the refusal', async (t) => {
  const f = fixture('r45-7');
  let driver;
  t.after(async () => { await closeDeployment(driver); rmSync(f.world, { recursive: true, force: true }); });

  const invalidId = 'ws-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
  mkdirSync(ownerRoot(f.repo), { recursive: true, mode: 0o700 });
  const invalidPath = receiptPath(f.repo, invalidId);
  writeFileSync(invalidPath, JSON.stringify({ schemaVersion: 1 }), { mode: 0o600 });
  chmodSync(invalidPath, 0o600);

  driver = openDeployment(f.repo, f.world);
  await assert.rejects(driver.coordinator.startupReady(), (error) => {
    assert.equal(error.code, 'coordinator_cleanup_incomplete');
    assert.equal(error.cause?.code, 'worktree_cleanup_failed');
    assert.ok(error.cause.report.diagnostics.some((row) => (
      row.code === 'workspace_owner_receipt_invalid' && row.physicalOwnerId === invalidId
    )));
    assert.ok(error.message.includes(invalidId), 'names the retained record');
    assert.ok(error.message.includes(REMEDY), 'includes the remedy sentence');
    return true;
  });
  assert.equal(existsSync(invalidPath), true);
});
