// Deliberate shared physical workspaces: one checkout, one branch, one capacity reservation, and
// several live participants each with its OWN fresh native session.
//
// Real Git through the real deployment (createDriver + MockAdapter + BatonApplication + the real
// swarm recruitment lane). Nothing here mocks Git, the coordinator, or the swarm runtime: the
// assertions read the checkout, the owner receipt, the capacity reservations, the durable task
// rows, the swarm view, and the real worker log.
//
// The claims under test:
//   T1 one shared checkout, one reservation, two live holders, two independent fresh sessions;
//   T2 a stop detaches (releases the holder) instead of destroying the resource it shares;
//   T3 the LAST holder closes a dirty checkout only by retaining it, content and receipt intact,
//      and never by committing on the shared branch from a peer's staging area;
//   T4 the last holder closes a clean checkout exactly once, settling capacity and receipt;
//   T5 the captured revision describes the checkout and its observed HEAD, not exclusive
//      authorship, in both the contribution receipt and the swarm's durable record;
//   T6 an absent, departed, self, foreign-swarm, or process-less source refuses the attachment
//      without recording a holder and without inventing a session.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

// The #362 rule: a recruit's run objective IS its composed brief, so the fixture draws the text
// bound from the deployment's own objective lane rather than a constant the brief can outgrow.
import { FRAME_LIMITS } from '../src/limits.mjs';

const repoId = 'repo-shared-custody';

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
    maxTextBytes: FRAME_LIMITS['run.objective'].value, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
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

// One reservation per physical checkout: the second participant must not consume another.
const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024,
  maxReservedInodes: 10_000,
  minFreeBytes: 1,
  minFreeInodes: 1,
  runtimeReserveBytes: 4 * 1024,
  runtimeReserveInodes: 4,
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

function configuredAdapter() {
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'Contribution ready', files: {} } });
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
  execFileSync('git', ['config', 'user.name', 'Shared custody test'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'custody@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
}

async function fixture(t, { retained = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-shared-custody-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: join(directory, 'log'),
    adapters: { mock: configuredAdapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
    worktreeCapacity: capacityPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 16 * 1024, inodes: 32 }),
    worktreeCapacityObserve: () => ({ freeBytes: 1024 * 1024 * 1024, freeInodes: 1_000_000 }),
    stopDeadlineMs: 2_000,
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
    const closing = app.shutdown(principal('cleanup'));
    if (retained) {
      // A retained checkout keeps its capacity reservation by design: the deployment cannot close
      // until the existing reconciliation authority settles it. Assert exactly that, rather than
      // pretending a close that must not happen. Either code means the retained reservation
      // outlived the fleet drain.
      await assert.rejects(() => closing, (error) => (
        error.code === 'coordinator_drain_incomplete' || error.code === 'driver_capacity_active'
      ));
    } else {
      await closing;
    }
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  return { app, driver, repo };
}

const orchestrator = principal('orchestrator');

const command = (app, name, args) => app.command(name, args, orchestrator);

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function workerFor(driver, runId) {
  return driver.coordinator.list().find((row) => row.runId === runId) ?? null;
}

async function paused(driver, runId) {
  const deadline = Date.now() + 8_000;
  for (;;) {
    const worker = workerFor(driver, runId);
    if (worker && driver.coordinator.pausedTurns({ workerId: worker.id }).length > 0) return worker;
    if (Date.now() >= deadline) {
      throw new Error(`Participant did not remain paused: ${JSON.stringify(driver.coordinator.list().map((row) => ({
        id: row.id, status: row.status, runId: row.runId,
      })))}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const createSwarm = (app, swarmId) => command(app, 'swarm.create', {
  purpose: 'Make deliberate shared workspaces work', swarmId, idempotencyKey: `create:${swarmId}`,
});

/** Recruit through the real application bus. `shareWorkspaceWith` is the deliberate shared
 * workspace option: an existing participant whose LIVE checkout the new participant works in. */
const recruit = (app, { swarmId, participantId, objective, shareWorkspaceWith = null, key = null }) => command(app, 'swarm.recruit', {
  swarmId, participantId, objective, options: selection,
  ...(shareWorkspaceWith ? { shareWorkspaceWith } : {}),
  idempotencyKey: key ?? `recruit:${swarmId}:${participantId}`,
});

const stopParticipant = (app, { swarmId, participantId, reason, key = null }) => command(app, 'swarm.stop', {
  swarmId, participantId, reason, idempotencyKey: key ?? `stop:${swarmId}:${participantId}`,
});

const inspect = (app, swarmId) => command(app, 'swarm.view', { swarmId });

// Owner receipts live in the repository's COMMON Git administration directory (shared by every
// worktree), not under the repository's working directory.
const ownerReceiptRoot = (repo) => join(repo, '.git', 'baton', 'workspace-owners');
const ownerReceiptPath = (repo, ownerId) => join(ownerReceiptRoot(repo), `${ownerId}.json`);

const ownerReceipt = (repo, ownerId) => JSON.parse(readFileSync(ownerReceiptPath(repo, ownerId), 'utf8'));

function workspaceDirs(repo) {
  const root = join(repo, '.baton', 'wt');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => /^ws-[a-f0-9]{32}$/u.test(name)).sort();
}

function ownerReceipts(repo) {
  const root = ownerReceiptRoot(repo);
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((name) => /^ws-[a-f0-9]{32}\.json$/u.test(name)).sort();
}

const reservations = (driver) => driver.worktreeCapacity.snapshot().reservations;

const reaped = (driver, workerId) => driver.log.read(workerId).some((event) => event.kind === 'worktree.reaped');

const deferredEvents = (driver, workerId) => driver.log.read(workerId)
  .filter((event) => event.kind === 'worktree.custody_deferred');

async function attachBuilder(t, { objective = 'Work in the same checkout', participantId = 'builder', retained = false } = {}) {
  const { app, driver, repo } = await fixture(t, { retained });
  await createSwarm(app, 'shared');
  const lead = await recruit(app, { swarmId: 'shared', participantId: 'lead', objective: 'Own the first checkout' });
  const leadWorker = await paused(driver, lead.runId);
  const ownerId = leadWorker.sessionContext.ownerTaskId;
  const builder = await recruit(app, { swarmId: 'shared', participantId, objective, shareWorkspaceWith: 'lead' });
  const builderWorker = await paused(driver, builder.runId);
  return { app, driver, repo, ownerId, lead, leadWorker, builder, builderWorker };
}

test('T1 a recruited participant deliberately shares one live checkout as its own fresh session', async (t) => {
  const { app, driver, repo, ownerId, leadWorker, builderWorker } = await attachBuilder(t);
  assert.equal(workspaceDirs(repo).length, 1, 'exactly one physical checkout exists');
  assert.equal(workspaceDirs(repo)[0], ownerId);
  assert.equal(reservations(driver).length, 1, 'one checkout consumes one reservation');
  assert.equal(reservations(driver)[0].id, `worker:${ownerId}`);

  // Same physical resource: one path, one branch, one base, one owner receipt.
  assert.equal(realpathSync(builderWorker.worktree), realpathSync(leadWorker.worktree));
  assert.equal(builderWorker.sessionContext.ownerTaskId, ownerId);
  assert.equal(builderWorker.sessionContext.branch, leadWorker.sessionContext.branch);
  assert.equal(builderWorker.sessionContext.baseSha, leadWorker.sessionContext.baseSha);
  assert.equal(builderWorker.sessionContext.ownerReceiptDigest, ownerReceipt(repo, ownerId).receiptDigest);
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, 2);

  // Independent identities: two workers, two fresh native sessions, no invented session id.
  assert.notEqual(builderWorker.id, leadWorker.id);
  assert.equal(builderWorker.sessionRequest.mode, 'new', 'adoption is a fresh session, never a resume');
  assert.deepEqual(builderWorker.sessionRequest, { mode: 'new' });
  assert.equal(builderWorker.sessionRef, null);
  assert.equal(driver.coordinator.pausedTurns({ workerId: builderWorker.id }).length, 1,
    'the adopted participant runs its own live turn');

  // The live attachment the swarm resolves for a third party is this same checkout.
  const attachment = driver.coordinator.workspaceAttachment(leadWorker.id);
  assert.equal(attachment.workspaceId, ownerId);
  assert.equal(attachment.holderCount, 2);

  // The swarm records the deliberate membership honestly, and the participant that OWNS the
  // checkout is recorded in it too: a row naming no checkout left the exclusive-writer guard with
  // nothing to compare (issue #292) — binding records the checkout its seat works in.
  const view = await inspect(app, 'shared');
  const row = (participantId) => view.participants.find((candidate) => candidate.participantId === participantId);
  assert.equal(row('builder').workspaceId, ownerId);
  assert.equal(row('lead').workspaceId, ownerId, 'the checkout its own recruit created is recorded at binding');
});

test('T2 a stop detaches from a shared checkout and leaves the resource to the live holder', async (t) => {
  const { app, driver, repo, ownerId, leadWorker, builderWorker } = await attachBuilder(t);
  const cwd = builderWorker.worktree;
  const branch = leadWorker.sessionContext.branch;
  writeFileSync(join(cwd, 'peer-note.txt'), 'the surviving holder wrote this\n');
  const before = {
    head: git(cwd, ['rev-parse', 'HEAD']),
    branch: git(repo, ['rev-parse', `refs/heads/${branch}`]),
    receiptDigest: ownerReceipt(repo, ownerId).receiptDigest,
    receiptBytes: readFileSync(ownerReceiptPath(repo, ownerId), 'utf8'),
  };

  // The handle is released exactly as a completed cleanup releases it, and the stop command itself
  // completes (a detach is never a resource the drain has to wait for)...
  await stopParticipant(app, { swarmId: 'shared', participantId: 'lead', reason: 'The allocator finished its part' });
  const leadAfter = workerFor(driver, leadWorker.runId);
  assert.equal(leadAfter.worktree, null);
  assert.equal(leadAfter.workspaceCleanupDeferred, 'holders_remain');
  // ...and the resource is untouched: no reap, no branch deletion, no receipt/reservation change.
  assert.equal(reaped(driver, leadWorker.id), false, 'a detach is not a reap');
  assert.equal(git(repo, ['rev-parse', `refs/heads/${branch}`]), before.branch);
  assert.equal(readFileSync(ownerReceiptPath(repo, ownerId), 'utf8'), before.receiptBytes);
  assert.deepEqual(workspaceDirs(repo), [ownerId]);
  assert.equal(reservations(driver).length, 1);
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, 1, 'the peer still holds it');
  const [deferred] = deferredEvents(driver, leadWorker.id);
  assert.equal(deferred.payload.reason, 'holders_remain');
  assert.deepEqual([...deferred.payload.holders], [builderWorker.id]);

  // The surviving holder keeps the checkout: uncommitted peer content is still readable there and
  // a live capture still pins a revision from that same path.
  assert.equal(readFileSync(join(cwd, 'peer-note.txt'), 'utf8'), 'the surviving holder wrote this\n');
  writeFileSync(join(cwd, 'after-detach.txt'), 'the peer continued after the allocator left\n');
  const capture = await command(app, 'swarm.capture', {
    swarmId: 'shared', participantId: 'builder', contributionId: 'after-detach',
  });
  assert.equal(git(cwd, ['show', `${capture.sha}:after-detach.txt`]), 'the peer continued after the allocator left');
  assert.equal(git(cwd, ['show', `${capture.sha}:peer-note.txt`]), 'the surviving holder wrote this');
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, 1);

  // Both revisions are retained, so the shared checkout may now close: the last holder reaps it
  // exactly once and releases the receipt and reservation the allocator's stop left standing.
  rmSync(join(cwd, 'peer-note.txt'));
  rmSync(join(cwd, 'after-detach.txt'));
  await stopParticipant(app, { swarmId: 'shared', participantId: 'builder', reason: 'The surviving holder closes it' });
  assert.deepEqual(workspaceDirs(repo), []);
  assert.deepEqual(ownerReceipts(repo), []);
  assert.equal(reservations(driver).length, 0);
});

test('T3 the last holder closes a dirty shared checkout only by retaining it, with no commit on the shared branch', async (t) => {
  const { app, driver, repo, ownerId, leadWorker, builderWorker } = await attachBuilder(t, { retained: true });
  const cwd = builderWorker.worktree;
  const branch = leadWorker.sessionContext.branch;
  await stopParticipant(app, { swarmId: 'shared', participantId: 'lead', reason: 'Allocator left first' });
  const headBefore = git(cwd, ['rev-parse', 'HEAD']);
  writeFileSync(join(cwd, 'peer-uncommitted.txt'), 'uncommitted peer work\n');

  // The last holder must not destroy content no capture recorded: its stop completes as a RETAINED
  // cleanup (the holder is released; the resource is not), nothing at all is removed, and the
  // retention is recorded with its refusal code.
  await stopParticipant(app, {
    swarmId: 'shared', participantId: 'builder', reason: 'Last holder stops with uncommitted work', key: 'dirty-stop',
  });
  const builderAfter = workerFor(driver, builderWorker.runId);
  assert.equal(builderAfter.worktree, null);
  assert.equal(builderAfter.workspaceCleanupDeferred, 'content_retained');
  const retained = driver.log.read(builderWorker.id)
    .findLast((event) => event.kind === 'worktree.custody_content_retained')?.payload ?? null;
  assert.equal(retained.code, 'workspace_uncommitted_content_retained');
  assert.deepEqual([...retained.dirtyPaths], ['peer-uncommitted.txt']);

  // Retention, exactly as before sharing existed: checkout, receipt and reservation all survive.
  assert.deepEqual(workspaceDirs(repo), [ownerId]);
  assert.equal(existsSync(ownerReceiptPath(repo, ownerId)), true);
  assert.equal(reservations(driver).length, 1);
  assert.equal(readFileSync(join(cwd, 'peer-uncommitted.txt'), 'utf8'), 'uncommitted peer work\n');
  assert.equal(git(repo, ['rev-parse', `refs/heads/${branch}`]), headBefore);

  // The uncommitted content was preserved through the ISOLATED live snapshot: a retained
  // checkpoint names the observed HEAD as its parent and carries the dirty file, while the shared
  // branch and index were never written (no `baton snapshot` commit on the branch).
  const checkpoint = driver.log.read(builderWorker.id)
    .findLast((event) => event.kind === 'worktree.progress_checkpointed')?.payload?.checkpoint ?? null;
  assert.ok(checkpoint, 'the last holder preserved its checkout through a live snapshot');
  assert.equal(git(repo, ['show', `${checkpoint.sha}:peer-uncommitted.txt`]), 'uncommitted peer work');
  assert.equal(git(cwd, ['rev-parse', `refs/heads/${branch}`]), headBefore);
  assert.equal(git(cwd, ['rev-parse', 'HEAD']), headBefore);
  const body = git(repo, ['cat-file', '-p', checkpoint.sha]);
  assert.match(body, new RegExp(`Baton-Head: ${headBefore}`, 'u'));
  assert.equal(reaped(driver, builderWorker.id), false, 'retention is not a reap');

  // Retention is settled by the EXISTING reconciliation authority, never by deleting content: the
  // retained checkout keeps its receipt and reservation until content preservation can observe it
  // as clean, which is what the fixture's teardown asserts (a retained resource blocks a clean
  // close). The checkpoint above is what makes the retained content recoverable meanwhile.
  assert.equal(readFileSync(ownerReceiptPath(repo, ownerId), 'utf8').length > 0, true);
  assert.equal(reservations(driver).length, 1);
});

test('T4 the last holder closes a clean shared checkout exactly once', async (t) => {
  const { app, driver, repo, ownerId, leadWorker, builderWorker } = await attachBuilder(t);
  const branch = leadWorker.sessionContext.branch;
  await stopParticipant(app, { swarmId: 'shared', participantId: 'lead', reason: 'Allocator left first' });
  assert.deepEqual(workspaceDirs(repo), [ownerId]);

  await stopParticipant(app, { swarmId: 'shared', participantId: 'builder', reason: 'Last holder closes the checkout' });

  assert.deepEqual(workspaceDirs(repo), [], 'the clean checkout is removed exactly once');
  assert.equal(reservations(driver).length, 0, `capacity is settled exactly once: ${JSON.stringify(reservations(driver).map((row) => row.id))}`);
  assert.equal(existsSync(ownerReceiptPath(repo, ownerId)), false, 'the owner receipt is released');
  assert.deepEqual(ownerReceipts(repo), []);
  assert.equal(reservations(driver).length, 0, 'capacity is settled exactly once');
  let branchGone = false;
  try { git(repo, ['show-ref', '--verify', `refs/heads/${branch}`]); } catch { branchGone = true; }
  assert.equal(branchGone, true);

  // Idempotent on retry: a repeated stop of an already-closed holder re-reports without effects.
  await stopParticipant(app, { swarmId: 'shared', participantId: 'builder', reason: 'Retry the same stop', key: 'stop-retry' });
  assert.deepEqual(workspaceDirs(repo), []);
  assert.equal(reservations(driver).length, 0);
  assert.equal(workspaceDirs(repo).length, 0);
});

test('T5 a shared revision describes the checkout and its observed HEAD, never authorship', async (t) => {
  const { app, driver, repo, ownerId, leadWorker, builderWorker } = await attachBuilder(t);
  const cwd = builderWorker.worktree;
  const observedHead = git(cwd, ['rev-parse', 'HEAD']);
  // The allocator modifies a file while the peer is the one who captures: the checkout differs,
  // and the record must say so without claiming the capturer wrote the allocator's line.
  writeFileSync(join(cwd, 'shared-file.txt'), 'the allocator wrote this line\n');

  const capture = await command(app, 'swarm.capture', {
    swarmId: 'shared', participantId: 'builder', contributionId: 'shared-revision',
  });
  assert.equal(capture.workspace.physicalOwnerId, ownerId);
  assert.equal(capture.workspace.shared, true);
  assert.equal(capture.workspace.holderCount, 2);
  assert.equal(capture.observedHead, observedHead);
  assert.ok(capture.changedPaths.includes('shared-file.txt'), 'the difference is the checkout\'s, not the capturer\'s');
  assert.equal(capture.workerId, builderWorker.id);

  const view = await inspect(app, 'shared');
  const sharedRow = view.contributions.find((row) => row.contributionId === 'shared-revision');
  const revision = sharedRow.revision;
  assert.equal(revision.sha, capture.sha);
  assert.equal(revision.workspaceId, ownerId);
  assert.equal(revision.observedHead, observedHead);
  assert.equal(sharedRow.participantId, 'builder');
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, 2);
  assert.equal(leadWorker.id === builderWorker.id, false);

  // The revision is retained; the test's own simulated difference is resolved so the deployment's
  // teardown drain is not blocked by content this test created.
  rmSync(join(cwd, 'shared-file.txt'));
});

test('T6 an absent, self, departed, foreign-swarm, or process-less source refuses without a holder', async (t) => {
  const { app, driver, repo, ownerId, lead, leadWorker } = await attachBuilder(t);
  const holders = driver.coordinator.liveWorkspaceHolders(ownerId).length;
  const refuse = async (participantId, shareWorkspaceWith, reason, swarmId = 'shared') => {
    const view = await inspect(app, swarmId === 'other' ? 'other' : 'shared');
    const names = Object.keys(view.participants);
    await assert.rejects(
      () => recruit(app, { swarmId, participantId, objective: 'Never attached', shareWorkspaceWith, key: `refuse:${participantId}` }),
      (error) => {
        assert.equal(error.code, 'swarm_workspace_unavailable');
        assert.equal(error.detail.reason, reason);
        return true;
      },
    );
    const after = await inspect(app, swarmId === 'other' ? 'other' : 'shared');
    // A refused attachment records no member and leaks no holder: nothing to clean up later.
    assert.deepEqual(Object.keys(after.participants).filter((id) => !names.includes(id)), []);
    assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, holders);
  };

  await refuse('ghost-child', 'ghost', 'source_absent');
  await refuse('self-sharer', 'self-sharer', 'self');
  // A source is resolved under THIS swarm's authority: a participant of another swarm is simply
  // not found here, even though it is a real live holder of a real checkout over there.
  await createSwarm(app, 'other');
  await command(app, 'swarm.recruit', {
    swarmId: 'other', participantId: 'outsider', objective: 'A participant of another swarm',
    options: selection, idempotencyKey: 'recruit:other:outsider',
  });
  await refuse('foreign-child', 'outsider', 'source_absent');

  // Leaving the swarm is NOT stopping the process: the source's checkout and live handle remain,
  // and the swarm still refuses to hand its checkout out.
  await command(app, 'swarm.update', {
    swarmId: 'shared', event: 'swarm.participant_left', payload: { participantId: 'lead' },
    idempotencyKey: 'leave:lead',
  });
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, holders);
  await refuse('departed-child', 'lead', 'source_left');
  const leftView = await inspect(app, 'shared');
  assert.equal(leftView.participants.find((row) => row.participantId === 'lead').status, 'left');

  // A third participant may adopt the same checkout, and a holder that has RELEASED its hold (its
  // stop detached, its peers remaining) is no longer a checkout source even though it is still a
  // swarm member: organizational membership is not process custody.
  const third = await recruit(app, {
    swarmId: 'shared', participantId: 'third', objective: 'Join the same checkout', shareWorkspaceWith: 'builder',
  });
  const thirdWorker = await paused(driver, third.runId);
  assert.equal(thirdWorker.sessionContext.ownerTaskId, ownerId);
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, holders + 1);
  await stopParticipant(app, { swarmId: 'shared', participantId: 'builder', reason: 'Builder detaches' });
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, holders);
  // Issue #350: a stop settles the seat's membership, so a stopped source reads as departed
  // (source_left) before its process liveness is ever consulted; the refusal stands either way.
  await refuse('no-process-child', 'builder', 'source_left');

  // The refused attempts left the checkout exactly where its remaining holders keep it.
  assert.equal(workspaceDirs(repo).includes(ownerId), true, 'the shared checkout is untouched');
  assert.equal(readFileSync(ownerReceiptPath(repo, ownerId), 'utf8').length > 0, true);
  assert.equal(driver.coordinator.liveWorkspaceHolders(ownerId).length, holders);
  assert.equal(leadWorker.sessionContext.ownerTaskId, ownerId);
});

test('T7 a source that is still a live member but has no attachable checkout refuses', async (t) => {
  const { app, driver, repo } = await fixture(t);
  await createSwarm(app, 'solo');
  const solo = await recruit(app, { swarmId: 'solo', participantId: 'solo', objective: 'Work alone' });
  const soloWorker = await paused(driver, solo.runId);
  // A live participant with no recorded workspace is not proof of a shared checkout: the resolved
  // attachment must come from its live handle, and a self-reference can never widen it.
  assert.match(soloWorker.sessionContext.ownerTaskId, /^ws-[a-f0-9]{32}$/u);
  const attachment = driver.coordinator.workspaceAttachment(soloWorker.id);
  assert.equal(attachment.workspaceId, soloWorker.sessionContext.ownerTaskId);
  assert.equal(attachment.holderCount, 1);
  assert.equal(attachment.sessionContext.ownerReceiptDigest, ownerReceipt(repo, attachment.workspaceId).receiptDigest);
  await assert.rejects(
    () => recruit(app, { swarmId: 'solo', participantId: 'solo', objective: 'Self attach', shareWorkspaceWith: 'solo', key: 'solo-self' }),
    (error) => error.code === 'swarm_workspace_unavailable' && error.detail.reason === 'self',
  );
  assert.deepEqual((await inspect(app, 'solo')).participants.map((row) => row.participantId), ['solo']);
});

// Issue #277 deliverable 0: a participant that owns its checkout must converge its stop. T8 is
// the clean path (the checkout is removed); T9 is the live defect (#265 evidence): content the
// capture cannot record no longer holds the stop open — the handle releases, the stop converges,
// and the checkout is retained with its refusal event for the reconciliation authority.

test('T8 stopping a participant that owns its clean checkout converges and removes the checkout', async (t) => {
  const { app, driver, repo } = await fixture(t);
  await createSwarm(app, 'solo');
  const solo = await recruit(app, { swarmId: 'solo', participantId: 'owner', objective: 'Own the only checkout' });
  const soloWorker = await paused(driver, solo.runId);
  const checkout = soloWorker.worktree;
  assert.match(soloWorker.sessionContext.ownerTaskId, /^ws-[a-f0-9]{32}$/u);
  assert.equal(workspaceDirs(repo).length, 1);

  const startedAt = Date.now();
  await stopParticipant(app, { swarmId: 'solo', participantId: 'owner', reason: 'Work complete' });
  assert.deepEqual(workspaceDirs(repo), [], 'the checkout is removed from disk');
  assert.equal(existsSync(checkout), false);
  assert.equal(workerFor(driver, solo.runId).worktree, null);
  const log = driver.log.read(soloWorker.id);
  assert.equal(log.some((event) => event.kind === 'kill.confirmed'), true);
  assert.equal(log.some((event) => event.kind === 'control.stop_waiting_on'), false, 'a converged stop never names a wait');
});

test('T9 residue no capture can record is retained with its refusal event while the stop still converges', async (t) => {
  const { app, driver, repo } = await fixture(t, { retained: true });
  await createSwarm(app, 'solo');
  const solo = await recruit(app, { swarmId: 'solo', participantId: 'owner', objective: 'Own the only checkout' });
  const soloWorker = await paused(driver, solo.runId);
  const cwd = soloWorker.worktree;
  // Tracked progress the preservation can pin, plus ignored residue the mutating capture can
  // never record: exactly the live condition behind the never-converging stop (#277).
  writeFileSync(join(cwd, '.gitignore'), '*.local.txt\n');
  writeFileSync(join(cwd, 'progress.txt'), 'tracked worker progress\n');
  git(cwd, ['add', '.gitignore', 'progress.txt']);
  git(cwd, ['commit', '-qm', 'worker progress']);
  writeFileSync(join(cwd, 'residue.local.txt'), 'ignored runtime residue\n');

  const startedAt = Date.now();
  await stopParticipant(app, { swarmId: 'solo', participantId: 'owner', reason: 'Work complete' });
  assert.ok(Date.now() - startedAt < 5_000, `the stop converges promptly (took ${Date.now() - startedAt}ms)`);

  const log = driver.log.read(soloWorker.id);
  assert.equal(log.some((event) => event.kind === 'kill.confirmed'), true);
  assert.equal(log.some((event) => event.kind === 'worktree.progress_checkpointed'), true, 'the tracked progress was pinned');
  const retained = log.findLast((event) => event.kind === 'worktree.custody_content_retained')?.payload ?? null;
  assert.ok(retained, 'the retention is recorded, never silent');
  assert.equal(retained.code, 'workspace_uncommitted_content_retained');
  assert.deepEqual([...retained.dirtyPaths], ['residue.local.txt']);
  assert.equal(log.some((event) => event.kind === 'control.stop_waiting_on'), false, 'a converged stop never names a wait');
  const after = workerFor(driver, solo.runId);
  assert.equal(after.worktree, null, 'the handle released the checkout');
  assert.equal(after.workspaceCleanupDeferred, 'content_retained');
  assert.equal(existsSync(join(cwd, 'residue.local.txt')), true, 'the unrecordable content survives');
  assert.equal(existsSync(join(repo, '.baton', 'wt', soloWorker.sessionContext.ownerTaskId)), true,
    'the checkout stays on disk for the reconciliation authority');
  assert.equal(reservations(driver).length, 1, 'the retained resource keeps its capacity reservation');
});
