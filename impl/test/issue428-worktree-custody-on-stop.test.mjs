// Issue #428 — worktree custody on stop, drain, and crash reconciliation.
//
// OBSERVED (2026-09-18, three separate incidents):
//   (1) after a resident crash, the restart's owned-resource reconciliation removed the
//       worktrees of seats the crash orphaned; only a seat carrying a `baton snapshot:`
//       commit on its lane branch survived;
//   (2) after `swarm stop`, one seat's worktree was removed and its lane branch deleted
//       although the seat had committed work and recorded the sha in its contribution —
//       the commit survived only as a dangling object;
//   (3) a clean drain removed every seat worktree AND every lane branch, including a
//       branch whose commit the root had already fetched and one holding four uncommitted
//       carried paths — with no snapshot, no ledger row, no owner record.
//
// The contract this file pins (docs/39 workspace custody, principle P7):
//   C1 a stop of a seat with uncommitted edits snapshots (commit on the lane branch) and
//      records `worktree.snapshotted` before the worktree is removed, and the removal is
//      recorded as `worktree.removed {reason: stop|drain}` (5a);
//   C2 a stop of a seat whose HEAD is not contained by its lane branch puts the branch at
//      HEAD first (5b);
//   C3 a crash-orphaned worktree (seat runtime dead, no stop) survives the startup
//      reconciliation while its branch does not already contain every change, and the
//      reconciliation row says so (5c);
//   C5 the swarm.view workspace projection carries, per seat,
//      {workspaceId, branch, headSha, snapshotSha, dirty, removed} derived from those rows
//      (5e).
//
// Every test drives the real deployment (createDriver + MockAdapter + BatonApplication +
// the real swarm lane) or the real reconciliation primitive the startup path calls; every
// assertion reads Git state and the durable ledger, never memory.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';
import {
  allocatePhysicalWorkspaceOwner, createFromBase, reconcile,
} from '../src/worktree.mjs';

const repoId = 'repo-issue428-custody';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId,
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const selection = Object.freeze({
  exact: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

const orchestrator = principal('orchestrator');
const command = (app, name, args) => app.command(name, args, orchestrator);

// A long turn keeps the seat's task non-terminal, so a stop reaches the preservation
// boundary (`_preserveProgressBeforeReap`) instead of the completed-task release. The
// exact-route admission reads the card's modelSelection: one configured model, one effort.
function workingAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', delayMs: 120_000, summary: 'still working', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function initRepo(repo) {
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Issue 428 custody'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue428@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function fixture(t, { adapters } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue428-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(directory, 'log'),
    adapters: adapters ?? { mock: workingAdapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 4_000,
  });
  const app = new BatonApplication({
    driver, repoId,
    profiles: { standard: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    await app.shutdown(principal('cleanup')).catch(() => {});
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  return { app, driver, repo };
}

const createSwarm = (app, swarmId) => command(app, 'swarm.create', {
  purpose: 'Hold worktree custody through stop, drain and crash reconciliation',
  swarmId, idempotencyKey: `create:${swarmId}`,
});

const recruit = (app, { swarmId, participantId, objective, key = null }) => command(app, 'swarm.recruit', {
  swarmId, participantId, objective, options: selection,
  idempotencyKey: key ?? `recruit:${swarmId}:${participantId}`,
});

const stopParticipant = (app, { swarmId, participantId, reason, key = null }) => command(app, 'swarm.stop', {
  swarmId, participantId, reason, idempotencyKey: key ?? `stop:${swarmId}:${participantId}`,
});

const inspect = (app, swarmId) => command(app, 'swarm.view', { swarmId });

function workerFor(driver, runId) {
  return driver.coordinator.list().find((row) => row.runId === runId) ?? null;
}

async function working(driver, runId) {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const worker = workerFor(driver, runId);
    if (worker && worker.status === 'working') return worker;
    if (Date.now() >= deadline) throw new Error(`seat never started working: ${runId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const branchExists = (repo, branch) => {
  try { git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]); return true; }
  catch { return false; }
};

// The custody rows ride the coordination ledger in the driver.recorded container.
const custodyRows = (driver, workspaceId) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'driver.recorded'
    && ['worktree.snapshotted', 'worktree.removed'].includes(event.payload?.kind)
    && event.payload?.workspaceId === workspaceId);

const branchTip = (repo, branch) => git(repo, ['rev-parse', `refs/heads/${branch}^{commit}`]);

test('428-A: a stop of a seat with uncommitted edits snapshots before the worktree goes, and records both rows', async (t) => {
  const { app, driver, repo } = await fixture(t);
  await createSwarm(app, 'stop-snapshot');
  const seat = await recruit(app, { swarmId: 'stop-snapshot', participantId: 'builder', objective: 'Hold uncommitted edits through a stop' });
  const worker = await working(driver, seat.runId);
  const ownerId = worker.sessionContext.ownerTaskId;
  const branch = worker.sessionContext.branch;
  assert.equal(branch, `baton/${ownerId}`);
  const cwd = worker.worktree;
  writeFileSync(join(cwd, 'carried.txt'), 'uncommitted seat work that must survive the stop\n');
  writeFileSync(join(cwd, 'base.txt'), 'base\nedited by the seat\n');

  await stopParticipant(app, { swarmId: 'stop-snapshot', participantId: 'builder', reason: 'Stop a seat holding uncommitted edits' });

  // The snapshot commit is on the lane branch, and the branch itself SURVIVES the stop.
  assert.equal(existsSync(cwd), false, 'the stopped seat checkout is removed after its snapshot');
  assert.equal(branchExists(repo, branch), true, 'the lane branch survives the stop');
  const tip = branchTip(repo, branch);
  assert.notEqual(tip, worker.sessionContext.baseSha, 'the branch carries the snapshot commit');
  assert.match(git(repo, ['log', '-1', '--format=%s', branch]), /^baton snapshot:/u);
  assert.equal(git(repo, ['show', `${tip}:carried.txt`]), 'uncommitted seat work that must survive the stop');

  // Both custody rows are in the durable ledger, in order, with the exact snapshot sha.
  const rows = custodyRows(driver, ownerId);
  const snapshotted = rows.filter((event) => event.payload.kind === 'worktree.snapshotted');
  const removed = rows.filter((event) => event.payload.kind === 'worktree.removed');
  assert.equal(snapshotted.length >= 1, true, 'a worktree.snapshotted row is recorded');
  const snapshot = snapshotted[snapshotted.length - 1];
  assert.equal(snapshot.payload.workspaceId, ownerId);
  assert.equal(snapshot.payload.branch, branch);
  assert.equal(snapshot.payload.sha, tip);
  assert.equal(removed.length, 1, 'exactly one worktree.removed row is recorded');
  assert.equal(removed[0].payload.workspaceId, ownerId);
  assert.equal(removed[0].payload.reason, 'stop');
  assert.equal(removed[0].payload.snapshot, tip);
  assert.ok(removed[0].seq > snapshot.seq, 'the removal is recorded after the snapshot');
});

test('428-B: a stop of a seat whose HEAD is not on its branch puts the branch at HEAD first', async (t) => {
  const { app, driver, repo } = await fixture(t);
  await createSwarm(app, 'detached-stop');
  const seat = await recruit(app, { swarmId: 'detached-stop', participantId: 'detached', objective: 'Hold detached-HEAD work through a stop' });
  const worker = await working(driver, seat.runId);
  const ownerId = worker.sessionContext.ownerTaskId;
  const branch = worker.sessionContext.branch;
  const cwd = worker.worktree;

  // The seat's harness detached and committed: HEAD carries work the lane branch does not name.
  git(cwd, ['checkout', '-q', '--detach']);
  writeFileSync(join(cwd, 'detached.txt'), 'work committed on a detached HEAD\n');
  git(cwd, ['add', 'detached.txt']);
  git(cwd, ['commit', '-qm', 'detached seat work']);
  const detachedHead = git(cwd, ['rev-parse', 'HEAD']);
  assert.equal(branchTip(repo, branch), worker.sessionContext.baseSha);

  await stopParticipant(app, { swarmId: 'detached-stop', participantId: 'detached', reason: 'Stop a seat whose HEAD left its branch' });

  assert.equal(existsSync(cwd), false, 'the stopped seat checkout is removed');
  assert.equal(branchExists(repo, branch), true, 'the lane branch survives the stop');
  assert.equal(branchTip(repo, branch), detachedHead, 'the lane branch was put at HEAD before the removal');
  assert.equal(git(repo, ['show', `${detachedHead}:detached.txt`]), 'work committed on a detached HEAD');
  const rows = custodyRows(driver, ownerId);
  const snapshot = rows.find((event) => event.payload.kind === 'worktree.snapshotted');
  const removed = rows.find((event) => event.payload.kind === 'worktree.removed');
  assert.ok(snapshot, 'a worktree.snapshotted row is recorded');
  assert.equal(snapshot.payload.sha, detachedHead);
  assert.equal(snapshot.payload.branch, branch);
  assert.ok(removed, 'the worktree.removed row is recorded');
  assert.equal(removed.payload.snapshot, detachedHead);
});

test('428-C: a crash-orphaned worktree survives the restart reconciliation and the row says so', async (t) => {
  // The startup reconciliation is the unit under test: the restarted controller runs
  // worktree reconcile with an empty expected set and ITS OWN owner authority, so a
  // receipt of the crashed incarnation reads `local_dead` — exactly the state a crash
  // leaves behind. Driven at the same seam coordinator startup drives (coordinator.mjs
  // reconcileStartupResources → facade reconcile → worktree reconcile).
  const world = mkdtempSync(join(tmpdir(), 'baton-issue428-crash-'));
  t.after(() => rmSync(world, { recursive: true, force: true }));
  const repo = join(world, 'repo');
  initRepo(repo);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  const deploymentId = createHash('sha256').update('issue428-crashed-deployment').digest('hex');
  const crashed = {
    deploymentId, controllerId: createHash('sha256').update('controller-of-the-crashed-resident').digest('hex'),
    pid: process.pid, pidStart: 'crashed-instance-start',
  };
  const receipt = allocatePhysicalWorkspaceOwner(repo, {
    runId: 'run-428', attemptId: 'attempt-428', logicalTaskId: 'orphaned-seat',
    processGeneration: 1, baseSha,
  }, crashed);
  const handle = await createFromBase(repo, receipt.physicalOwnerId, baseSha, { ownerReceipt: receipt });
  const ownerId = receipt.physicalOwnerId;
  const branch = `baton/${ownerId}`;

  // The orphaned seat's checkout holds committed work its lane branch does not name:
  // the harness detached and committed before the crash, so the branch alone does not
  // contain every change.
  git(handle.dir, ['checkout', '-q', '--detach']);
  writeFileSync(join(handle.dir, 'orphan.txt'), 'work the crash orphaned\n');
  git(handle.dir, ['add', 'orphan.txt']);
  git(handle.dir, ['commit', '-qm', 'orphaned seat work']);
  const orphanHead = git(handle.dir, ['rev-parse', 'HEAD']);

  // The restarted controller: same deployment identity, new controller incarnation.
  const events = [];
  const report = reconcile(repo, [], {
    ownerAuthority: { ...crashed, controllerId: 'controller-of-the-restarted-resident' },
    log: { append: (event) => events.push(event) },
  });

  // The orphan is LEFT IN PLACE: checkout, committed work and lane branch all survive.
  assert.deepEqual(report.errors, [], `reconciliation errors: ${JSON.stringify(report.errors)}`);
  assert.equal(existsSync(handle.dir), true, 'the crash-orphaned worktree is left in place');
  assert.equal(branchExists(repo, branch), true, 'the lane branch survives the reconciliation');
  assert.equal(git(repo, ['show', `${orphanHead}:orphan.txt`]), 'work the crash orphaned');
  const diagnostic = report.diagnostics.find((row) => row.physicalOwnerId === ownerId && row.retained === true);
  assert.ok(diagnostic, 'the reconciliation retains the orphan with a typed diagnostic');
  assert.equal(diagnostic.code, 'workspace_owner_head_uncontained_retained');
  // ...and the durable row says so.
  const row = events.find((event) => event.kind === 'worktree.custody_retained');
  assert.ok(row, 'a worktree.custody_retained row is recorded');
  assert.equal(row.payload.workspaceId, ownerId);
  assert.equal(row.payload.reason, 'crash_reconciliation');
  assert.equal(row.payload.headSha, orphanHead);
  assert.equal(row.payload.branch, branch);
  // No removal of any kind was recorded for the orphan.
  assert.equal(events.some((event) => event.kind === 'worktree.removed' && event.payload?.workspaceId === ownerId), false);
});

test('428-D: a lane branch survives stop and drain', async (t) => {
  const { app, driver, repo } = await fixture(t);
  await createSwarm(app, 'drain-branches');
  const first = await recruit(app, { swarmId: 'drain-branches', participantId: 'alpha', objective: 'Hold committed work through the drain' });
  const second = await recruit(app, { swarmId: 'drain-branches', participantId: 'beta', objective: 'Hold more committed work through the drain' });
  const alpha = await working(driver, first.runId);
  const beta = await working(driver, second.runId);
  const owners = [alpha, beta].map((worker) => ({
    worker, ownerId: worker.sessionContext.ownerTaskId, branch: worker.sessionContext.branch,
  }));
  for (const { worker, branch } of owners) {
    writeFileSync(join(worker.worktree, 'landed.txt'), `committed work in ${branch}\n`);
    git(worker.worktree, ['add', 'landed.txt']);
    git(worker.worktree, ['commit', '-qm', `seat work on ${branch}`]);
  }
  const tips = Object.fromEntries(owners.map(({ branch }) => [branch, branchTip(repo, branch)]));

  // The DRAIN: the whole fleet converges with clean, fully-committed checkouts.
  await app.shutdown(principal('drain'));

  const wtRoot = join(repo, '.baton', 'wt');
  const remaining = existsSync(wtRoot)
    ? readdirSync(wtRoot).filter((name) => /^ws-[a-f0-9]{32}$/u.test(name)) : [];
  assert.deepEqual(remaining, [], 'the drain removes the converged checkouts');
  for (const { branch } of owners) {
    assert.equal(branchExists(repo, branch), true, `the lane branch ${branch} survives the drain`);
    assert.equal(branchTip(repo, branch), tips[branch], `the committed work on ${branch} is intact`);
    assert.match(git(repo, ['log', '-1', '--format=%s', branch]), /^seat work on /u);
  }
  for (const { worker } of owners) {
    const removed = custodyRows(driver, owners.find((row) => row.worker === worker).ownerId)
      .filter((event) => event.payload.kind === 'worktree.removed');
    assert.equal(removed.length, 1, `exactly one removal row for ${worker.id}`);
    assert.equal(['stop', 'drain'].includes(removed[0].payload.reason), true);
    assert.equal(removed[0].payload.snapshot, tips[owners.find((row) => row.worker === worker).branch]);
  }
});

test('428-E: the workspace projection carries the custody rows per seat', async (t) => {
  const { app, driver } = await fixture(t);
  await createSwarm(app, 'projection');
  const first = await recruit(app, { swarmId: 'projection', participantId: 'stopped-seat', objective: 'Be stopped with uncommitted edits' });
  const second = await recruit(app, { swarmId: 'projection', participantId: 'live-seat', objective: 'Stay live and clean' });
  const stopped = await working(driver, first.runId);
  const live = await working(driver, second.runId);
  const stoppedOwner = stopped.sessionContext.ownerTaskId;
  const stoppedBranch = stopped.sessionContext.branch;
  const liveOwner = live.sessionContext.ownerTaskId;
  const liveBranch = live.sessionContext.branch;
  writeFileSync(join(stopped.worktree, 'projection.txt'), 'uncommitted\n');
  await stopParticipant(app, { swarmId: 'projection', participantId: 'stopped-seat', reason: 'Stop for the projection' });

  const view = await inspect(app, 'projection');
  const row = (participantId) => view.participants.find((candidate) => candidate.participantId === participantId);
  const stoppedWorkspace = row('stopped-seat')?.workspace;
  const liveWorkspace = row('live-seat')?.workspace;

  // The stopped seat's row carries the whole custody story, derived from the rows.
  assert.ok(stoppedWorkspace, 'the stopped seat still projects its workspace');
  assert.equal(stoppedWorkspace.workspaceId, stoppedOwner);
  assert.equal(stoppedWorkspace.branch, stoppedBranch);
  assert.equal(stoppedWorkspace.dirty, false);
  assert.equal(typeof stoppedWorkspace.snapshotSha, 'string', 'the snapshot sha is projected');
  assert.deepEqual(
    [stoppedWorkspace.removed.reason, stoppedWorkspace.removed.at],
    ['stop', stoppedWorkspace.removed.at],
  );
  assert.ok(stoppedWorkspace.removed.at, 'the removal carries its time');

  // The live seat projects its live checkout beside the same fields.
  assert.ok(liveWorkspace, 'the live seat projects its workspace');
  assert.equal(liveWorkspace.workspaceId, liveOwner);
  assert.equal(liveWorkspace.branch, liveBranch);
  assert.equal(liveWorkspace.dirty, false);
  assert.equal(liveWorkspace.snapshotSha, null);
  assert.equal(liveWorkspace.removed, null);
  assert.equal(liveWorkspace.headSha, git(live.worktree, ['rev-parse', 'HEAD']));
});
