// Issue #517 — `swarm.recruit --resume-from` a seat that died binds the predecessor's RETAINED
// checkout through the deployment's own admission.
//
// OBSERVED (2026-09-19, swarm-259-coupled-20260918): two seats killed by `provider_quota_exhausted`
// (leftReason: provider_fault) left their checkouts on disk, and the reroute command the attention
// row itself named refused every time, on every candidate route:
//   baton swarm recruit … --resume-from <dead> --options '{"exact": …}'
//   → application_workspace_attachment_invalid: … application precondition failed
// The refusal taught nothing (no field, no observed shape), and the cause was structural: the
// recruit composes the carry as an attachment with `holderCount: 0` — the predecessor is dead, so
// nobody holds the checkout — while the deployment's admission admitted only `holderCount >= 1`.
// Every `--resume-from` of a seat whose checkout is still on disk was therefore refused before any
// membership was written, whatever killed the predecessor.
//
// The seam the #385/#452/#453 rows pin was never exercised through this admission: those fixtures
// drive a hand-built SwarmRuntime with their own `startRun`, so the carry composition and the
// deployment's shape rule were free to disagree. This file drives the REAL BatonApplication over
// two incarnations of one repository, which is the path the operator's command takes.
//
// Rows:
//   (a) a resume-from successor of a dead predecessor whose checkout is still on disk is admitted,
//       bound to that same checkout, with `workspace.carried_from` recording the bind;
//   (b) a malformed attachment still refuses, and the refusal names the field and the shape it saw.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

// The #362 rule: a recruit's run objective IS its composed brief, so the text bound is the
// deployment's own objective lane, never a constant a brief with a recovery section can outgrow.
import { FRAME_LIMITS } from '../src/limits.mjs';

const repoId = 'repo-issue517-resume';

const policy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1000,
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
  schemaVersion: 1, repoId,
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

const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const orchestrator = principal('orchestrator');

function workingAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', delayMs: 30_000, summary: 'still working', files: {} },
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

function initRepo(dir) {
  execFileSync('git', ['init', '-q', dir]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 517 resume', GIT_COMMITTER_NAME: 'Issue 517 resume' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue517@example.invalid', GIT_COMMITTER_EMAIL: 'issue517@example.invalid' });
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
}

/** One incarnation of the deployment over the shared repository and coordination log: a real
 * BatonApplication, so every recruit crosses `_admitWorkspaceAttachment`. */
async function incarnation(t, { repo, logDir, label }) {
  const driver = createDriver({
    repoRoot: repo, repoId, logDir,
    adapters: { mock: workingAdapter() },
    goalPlanAuthority: { policy, authorize: async () => true },
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
  await app.ready;
  return {
    driver, application: app, label,
    command: (name, args) => app.command(name, args, orchestrator),
    // Bounded: a source incarnation is left holding a mock seat that never finishes its turn, and
    // the suite must not wait on it.
    close: async () => {
      await Promise.race([
        app.shutdown(principal('cleanup')).catch(() => {}),
        new Promise((resolve) => { setTimeout(resolve, 5_000).unref?.(); }),
      ]);
    },
  };
}

function workerFor(driver, runId) {
  return driver.coordinator.list().find((row) => row.runId === runId) ?? null;
}

async function working(driver, runId) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const worker = workerFor(driver, runId);
    if (worker && worker.status === 'working') return worker;
    if (Date.now() >= deadline) throw new Error(`seat never started working: ${runId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('517-a: a resume-from successor of a dead predecessor binds its retained checkout through the deployment admission', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue517-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const logDir = join(directory, 'log');
  mkdirSync(logDir, { recursive: true });
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  // First incarnation: alpha works in a real owned checkout and leaves work in it.
  const first = await incarnation(t, { repo, logDir, label: 'i1' });
  t.after(() => first.close());
  await first.command('swarm.create', {
    purpose: 'Resume a retained checkout', swarmId: 'resumed', idempotencyKey: 'create:resumed',
  });
  const alpha = await first.command('swarm.recruit', {
    swarmId: 'resumed', participantId: 'alpha', objective: 'Build alpha',
    options: selection, idempotencyKey: 'recruit:resumed:alpha',
  });
  const alphaWorker = await working(first.driver, alpha.runId);
  const alphaWorkspaceId = alphaWorker.sessionContext.ownerTaskId;
  const alphaWorktree = alphaWorker.worktree;
  assert.ok(existsSync(alphaWorktree), 'alpha owns a checkout on disk');
  writeFileSync(join(alphaWorktree, 'carried.txt'), 'alpha work that must survive\n');

  // The incarnation is lost with the checkout still on disk: the writer lease is released and the
  // runtime never drains, which is exactly the #428-retained state a provider-fault death and a
  // lost incarnation both leave behind.
  first.driver.coordination.releaseWriterLease();
  assert.ok(existsSync(join(alphaWorktree, 'carried.txt')), 'the checkout survives the lost incarnation');

  // Second incarnation: alpha is dead, and the recruit the attention row names is typed.
  const second = await incarnation(t, { repo, logDir, label: 'i2' });
  t.after(() => second.close());

  const bravo = await second.command('swarm.recruit', {
    swarmId: 'resumed', participantId: 'bravo', objective: 'Continue from alpha',
    options: selection, resumeFrom: 'alpha', idempotencyKey: 'recruit:resumed:bravo',
  });
  assert.equal(typeof bravo.runId, 'string', 'the successor is admitted');

  // Issue #572: the recruit performs the carry itself, so the guide below is the ordinary nudge a
  // working successor receives — the checkout is already bound when it is set.
  await second.command('swarm.guide', {
    swarmId: 'resumed', participantId: 'bravo', message: 'Continue alpha\'s lane',
    idempotencyKey: 'guide:resumed:bravo',
  });
  await working(second.driver, bravo.runId);

  const swarm = second.driver.coordination.swarm('resumed');
  assert.equal(swarm.participants.bravo.workspaceId, alphaWorkspaceId,
    'bravo is bound to the SAME checkout alpha left behind');
  assert.ok(existsSync(join(alphaWorktree, 'carried.txt')),
    'the predecessor work is still in the carried checkout');

  const carried = second.driver.coordination.eventsView()
    .filter((row) => (row.kind === 'driver.recorded' ? row.payload?.kind : row.kind) === 'workspace.carried_from')
    .filter((row) => row.payload?.participantId === 'bravo');
  assert.equal(carried.length, 1, 'one workspace.carried_from row for the successor');
  assert.equal(carried[0].payload.predecessor, 'alpha');
  assert.equal(carried[0].payload.workspaceId, alphaWorkspaceId);

});

// Issue #616: the other half of a `resume-from` across a restart. Once a startup reclaims a dead
// predecessor's checkout, the successor cannot bind a checkout that is gone — it must receive what
// the capture recorded instead. The reclamation writes the removal's backing revision under the
// `worktree.snapshotted` kind the carry derivation reads (#453), so the successor gets its own
// checkout with the predecessor's content applied. Observed 2026-09-27: the resident held 105
// registered worktrees (23 GiB) of ended seats, and the deployment's own attention rows name
// `swarm.recruit --resume-from` for a seat whose runtime was lost.
test('517-c: a resume-from successor receives the content of a predecessor checkout the startup reclaimed', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue517-c-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const logDir = join(directory, 'log');
  mkdirSync(logDir, { recursive: true });
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  // First incarnation: alpha works in a real owned checkout and leaves uncommitted work in it.
  const first = await incarnation(t, { repo, logDir, label: 'c1' });
  t.after(() => first.close());
  await first.command('swarm.create', {
    purpose: 'Carry a reclaimed checkout', swarmId: 'reclaimed', idempotencyKey: 'create:reclaimed',
  });
  const alpha = await first.command('swarm.recruit', {
    swarmId: 'reclaimed', participantId: 'alpha', objective: 'Build alpha',
    options: selection, idempotencyKey: 'recruit:reclaimed:alpha',
  });
  const alphaWorker = await working(first.driver, alpha.runId);
  const alphaWorkspaceId = alphaWorker.sessionContext.ownerTaskId;
  const alphaWorktree = alphaWorker.worktree;
  writeFileSync(join(alphaWorktree, 'carried.txt'), 'alpha work that must survive\n');
  first.driver.coordination.releaseWriterLease();

  // The first startup after the loss ends alpha (its session is not reattached) and keeps the
  // checkout: that seat is the predecessor a `resume-from` successor binds (#517-a).
  const second = await incarnation(t, { repo, logDir, label: 'c2' });
  t.after(() => second.close());
  assert.equal(existsSync(alphaWorktree), true,
    'the startup that ended alpha keeps its checkout for the successor that may bind it');
  const alphaTask = second.driver.coordination.snapshot().tasks.find((row) => row.runId === alpha.runId);
  assert.equal(alphaTask.status, 'failed', 'alpha\'s seat ended in that startup');
  second.driver.coordination.releaseWriterLease();

  // The startup that begins from alpha's own end reclaims the checkout, capturing its content into
  // the lane branch first.
  const third = await incarnation(t, { repo, logDir, label: 'c3' });
  t.after(() => third.close());
  assert.equal(existsSync(alphaWorktree), false,
    'the startup that begins from alpha\'s end reclaims its checkout');

  const bravo = await third.command('swarm.recruit', {
    swarmId: 'reclaimed', participantId: 'bravo', objective: 'Continue from alpha',
    options: selection, resumeFrom: 'alpha', idempotencyKey: 'recruit:reclaimed:bravo',
  });
  assert.equal(typeof bravo.runId, 'string', 'the successor of a reclaimed predecessor is admitted');
  const bravoWorker = await working(third.driver, bravo.runId);

  assert.notEqual(bravoWorker.sessionContext.ownerTaskId, alphaWorkspaceId,
    'the successor works in its own checkout: the predecessor\'s checkout is gone');
  assert.equal(
    readFileSync(join(bravoWorker.worktree, 'carried.txt'), 'utf8'),
    'alpha work that must survive\n',
    'the successor receives the content the reclamation captured',
  );
  const carried = third.driver.coordination.eventsView()
    .filter((row) => (row.kind === 'driver.recorded' ? row.payload?.kind : row.kind) === 'workspace.carried_from')
    .filter((row) => row.payload?.participantId === 'bravo');
  assert.equal(carried.length, 1, 'one workspace.carried_from row for the successor');
  assert.equal(carried[0].payload.predecessor, 'alpha');
  assert.equal(carried[0].payload.workspaceId, bravoWorker.sessionContext.ownerTaskId,
    'the carry names the successor\'s own checkout, because the predecessor\'s is gone');
  assert.match(carried[0].payload.snapshotSha ?? '', /^[a-f0-9]{40,64}$/u,
    'the content came from the recorded capture\'s revision');
  assert.deepEqual(carried[0].payload.paths, ['carried.txt'],
    'the row names the path the capture carried');
  assert.equal(carried[0].payload.how, 'applied',
    'the carry is the recorded snapshot applied into the successor\'s own checkout');
});

// The guard on the same rule: a checkout a successor has adopted is never the predecessor's to
// reclaim. Here the predecessor's task had already ended before the startup, and the successor
// bound to its checkout is still working — the workspace must survive the sweep that would
// otherwise reclaim it, because the live successor owns the checkout now.
test('517-d: a successor bound to the predecessor\'s checkout keeps it while its own task is open', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue517-d-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  const logDir = join(directory, 'log');
  mkdirSync(logDir, { recursive: true });
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  const first = await incarnation(t, { repo, logDir, label: 'd1' });
  t.after(() => first.close());
  await first.command('swarm.create', {
    purpose: 'Adopt a predecessor checkout', swarmId: 'adopted', idempotencyKey: 'create:adopted',
  });
  const alpha = await first.command('swarm.recruit', {
    swarmId: 'adopted', participantId: 'alpha', objective: 'Build alpha',
    options: selection, idempotencyKey: 'recruit:adopted:alpha',
  });
  const alphaWorker = await working(first.driver, alpha.runId);
  const alphaWorkspaceId = alphaWorker.sessionContext.ownerTaskId;
  const alphaWorktree = alphaWorker.worktree;
  writeFileSync(join(alphaWorktree, 'carried.txt'), 'alpha work that must survive\n');
  first.driver.coordination.releaseWriterLease();

  // Second incarnation: alpha's session is not reattached, so its seat has ended here; the
  // successor binds that dead predecessor's retained checkout and keeps working in it.
  const second = await incarnation(t, { repo, logDir, label: 'd2' });
  t.after(() => second.close());
  const bravo = await second.command('swarm.recruit', {
    swarmId: 'adopted', participantId: 'bravo', objective: 'Continue from alpha',
    options: selection, resumeFrom: 'alpha', idempotencyKey: 'recruit:adopted:bravo',
  });
  await second.command('swarm.guide', {
    swarmId: 'adopted', participantId: 'bravo', message: 'Continue alpha\'s lane',
    idempotencyKey: 'guide:adopted:bravo',
  });
  const bravoWorker = await working(second.driver, bravo.runId);
  assert.equal(bravoWorker.sessionContext.ownerTaskId, alphaWorkspaceId,
    'bravo works in the checkout alpha left behind');
  second.driver.coordination.releaseWriterLease();

  // Third incarnation: alpha's task was already terminal when this startup began, and bravo's was
  // not. The checkout belongs to bravo now, so it must survive this sweep.
  const third = await incarnation(t, { repo, logDir, label: 'd3' });
  t.after(() => third.close());
  assert.equal(existsSync(alphaWorktree), true,
    'the live successor\'s checkout survives the sweep that reclaims ended predecessors');
  assert.equal(existsSync(join(alphaWorktree, 'carried.txt')), true,
    'and it still holds the predecessor\'s work');
});

test('517-b: a malformed attachment still refuses, naming the field and the shape it observed', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue517-b-'));
  const repo = join(directory, 'repo');
  initRepo(repo);
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  const app = await incarnation(t, { repo, logDir: join(directory, 'log'), label: 'unit' });
  t.after(() => app.close());

  const workspaceId = `ws-${'a'.repeat(32)}`;
  const sessionContext = { ownerTaskId: workspaceId, worktree: join(repo, '.baton', 'wt', workspaceId), baseSha: 'x' };
  const malformed = [
    { workspace: { workspaceId, holderCount: -1, sessionContext }, observed: 'holderCount' },
    { workspace: { workspaceId, holderCount: 1.5, sessionContext }, observed: 'holderCount' },
    { workspace: { workspaceId, holderCount: 1, sessionContext: { ...sessionContext, ownerTaskId: 'ws-other' } }, observed: 'sessionContext' },
    { workspace: { workspaceId: 'ws-short', holderCount: 1, sessionContext }, observed: 'workspaceId' },
  ];
  for (const { workspace, observed } of malformed) {
    assert.throws(
      () => app.application._admitWorkspaceAttachment('run-517', workspace),
      (error) => {
        assert.equal(error.code, 'application_workspace_attachment_invalid');
        assert.equal(error.detail?.field, observed, 'the refusal names the field that failed');
        assert.equal(typeof error.detail?.rule, 'string', 'the refusal names the rule it enforced');
        return true;
      },
      `attachment ${JSON.stringify(workspace)} refuses naming ${observed}`,
    );
  }

});
