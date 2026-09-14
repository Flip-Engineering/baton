// Swarm view projections (unit W1 'projections', fixture pattern from
// swarm-coupling.test.mjs): the view answers what a participant was told and which checkout
// its live worker holds, reading only records that already exist. Guidance is projected from
// the message.sent lane receipts the delivery path already writes — the view mints nothing of
// its own. A guide returns the lane receipt row it wrote, read back from the durable store.
// Workspace mirrors the custody record a capture attaches to a revision: the live worker's
// physical checkout, the live holder count, and null with no live checkout. Every projected
// row family carries its seq and ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-projections', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16, maxTextBytes: 4096,
    maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024,
    maxStatusBytes: 256 * 1024, maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
  timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
});
// One reservation per physical checkout: a deliberately shared checkout must not consume a second.
const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024,
  maxReservedInodes: 10_000,
  minFreeBytes: 1,
  minFreeInodes: 1,
  runtimeReserveBytes: 4 * 1024,
  runtimeReserveInodes: 4,
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-projections', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

// turnDelayMs keeps a resumed mock turn alive long enough that a guide issued right after a
// resume reaches the live delivery lane (the receipt-writing path) instead of another pause.
async function fixture(t, { sharedCheckout = false, turnDelayMs = 5 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-projections-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Swarm projections'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'projections@example.invalid'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', turnDelayMs, summary: 'ready', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(), turnCompletion: 'pausable',
    modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000,
    ...(sharedCheckout ? {
      worktreeCapacity: capacityPolicy,
      worktreeCapacityEstimate: () => ({ bytes: 16 * 1024, inodes: 32 }),
      worktreeCapacityObserve: () => ({ freeBytes: 1024 * 1024 * 1024, freeInodes: 1_000_000 }),
    } : {}),
  });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => { await app.shutdown(principal('cleanup')); rmSync(directory, { recursive: true, force: true }); });
  await app.ready;
  const paused = async (runId) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const worker = driver.coordinator.list().find((row) => row.runId === runId);
      if (worker && driver.coordinator.pausedTurns({ workerId: worker.id }).length) return worker;
      if (Date.now() > deadline) throw new Error(`participant of ${runId} did not pause`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const asWorker = (worker) => bindBaton(app, { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: `${worker.id}-session` });
  return { app, driver, directory, root: bindBaton(app, principal('root')), paused, asWorker };
}

// A lead with every permission and two builders with work, an assignment, and a group —
// the smallest swarm that exercises every projected row family.
async function builders(t, options = {}) {
  const fixtureHandle = await fixture(t, options);
  const { root, paused, asWorker } = fixtureHandle;
  const swarm = await root.swarms.create('Projections');
  const lead = await swarm.recruit('lead', 'Coordinate', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(lead.runId);
  const delegated = asWorker(leadWorker).swarms.open(swarm.id);
  const alpha = await delegated.recruit('alpha', 'Build A', selection);
  const alphaWorker = await paused(alpha.runId);
  const beta = await delegated.recruit('beta', 'Build B', selection);
  const betaWorker = await paused(beta.runId);
  await delegated.work({ workId: 'W-A', objective: 'Part A', status: 'open' });
  await delegated.assign({ assignmentId: 'as-alpha', participantId: 'alpha', workId: 'W-A', status: 'active' });
  await delegated.group({ groupId: 'impl', members: ['alpha', 'beta'], purpose: 'builders' });
  return { ...fixtureHandle, swarm, delegated, alpha, beta, leadWorker, alphaWorker, betaWorker,
    leadActor: `worker:${leadWorker.id}` };
}

test('guidance rows appear and grow after receipted guides, and a guide returns the row it wrote', async (t) => {
  const { swarm, delegated, leadActor } = await builders(t, { turnDelayMs: 250 });

  // A guide to a paused participant rides the resume lane, which records no message.sent
  // receipt — so the projection honestly shows no guidance yet.
  const resumed = await delegated.guide('alpha', 'Resume on the interface');
  assert.equal(resumed.result.result, 'nudged');
  let view = await swarm.view();
  assert.deepEqual(view.participants.find((row) => row.participantId === 'alpha').guidance, []);

  // Guides that reach the live delivery lane mint message.sent receipts. Each returns the
  // row it wrote — the durable receipt, not an in-process ok — and the projection grows.
  const first = await delegated.guide('alpha', 'First receipted guidance');
  assert.equal(first.result.result, 'ok');
  assert.ok(Number.isSafeInteger(first.guide.seq) && first.guide.seq > 0, 'the guide returns its receipt seq');
  assert.ok(typeof first.guide.ts === 'string' && first.guide.ts.length > 0, 'the guide returns its receipt ts');
  assert.match(first.guide.messageId, /^message:[a-f0-9]{64}$/u, 'the guide returns its receipt messageId');
  const second = await delegated.guide('alpha', 'Second receipted guidance');
  assert.equal(second.result.result, 'ok');
  assert.ok(second.guide.seq > first.guide.seq, 'each guide writes a later row');

  view = await swarm.view();
  const alpha = view.participants.find((row) => row.participantId === 'alpha');
  assert.deepEqual(alpha.guidance, [
    { seq: first.guide.seq, ts: first.guide.ts, from: leadActor, messageId: first.guide.messageId },
    { seq: second.guide.seq, ts: second.guide.ts, from: leadActor, messageId: second.guide.messageId },
  ], 'guidance is the receipted nudges addressed to the participant, in log order');
  assert.deepEqual(view.participants.find((row) => row.participantId === 'beta').guidance, [],
    'guidance follows the addressee, not the whole swarm');
});

test('workspace projects live checkout custody: shared adopters, solo holders, and null without a live checkout', async (t) => {
  const { swarm, delegated, driver, leadWorker, paused } = await builders(t, { sharedCheckout: true, turnDelayMs: 250 });
  // Two holders deliberately adopt the lead's live checkout.
  const sharer = await delegated.recruit('sharer', 'Share the checkout', { ...selection, shareWorkspaceWith: 'lead' });
  await paused(sharer.runId);
  const joiner = await delegated.recruit('joiner', 'Share the checkout too', { ...selection, shareWorkspaceWith: 'lead' });
  await paused(joiner.runId);
  const leadOwner = driver.coordinator.workspaceAttachment(leadWorker.id).workspaceId;

  let view = await swarm.view();
  const byId = new Map(view.participants.map((row) => [row.participantId, row]));
  // The lead and both adopters hold ONE physical checkout together.
  assert.deepEqual(byId.get('lead').workspace, { physicalOwnerId: leadOwner, shared: true, holderCount: 3 });
  assert.deepEqual(byId.get('sharer').workspace, { physicalOwnerId: leadOwner, shared: true, holderCount: 3 });
  assert.deepEqual(byId.get('joiner').workspace, { physicalOwnerId: leadOwner, shared: true, holderCount: 3 });
  // The builders work in checkouts of their own: held, not shared.
  assert.deepEqual(byId.get('alpha').workspace.shared, false);
  assert.deepEqual(byId.get('alpha').workspace.holderCount, 1);
  assert.notEqual(byId.get('alpha').workspace.physicalOwnerId, leadOwner);

  // A participant whose runtime is gone carries no live checkout: null, not a stale record.
  await swarm.stop('beta', 'runtime lost');
  view = await swarm.view();
  const beta = view.participants.find((row) => row.participantId === 'beta');
  assert.equal(['dead', 'exited'].includes(beta.runtime.state), true, 'the stopped participant is gone');
  assert.equal(beta.workspace, null);
  assert.equal(view.participants.find((row) => row.participantId === 'lead').workspace.holderCount, 3,
    'the departed holder held its own checkout; the shared custody count is unchanged');
});

test('every projected row family carries its seq and ts; a solo live checkout shows shared: false', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker } = await builders(t);
  await delegated.work({ workId: 'W-B', objective: 'Part B', status: 'open' });
  await delegated.assign({ assignmentId: 'as-beta', participantId: 'beta', workId: 'W-B', status: 'active' });
  await delegated.context({ key: 'interface', body: 'the interface is frozen' });
  await delegated.couple({ couplingId: 'sync-rows', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'rows' });
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', workId: 'W-A', body: 'Part A built',
  });
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'accept', reason: 'verified' });

  const view = await swarm.view();
  const stamped = (row, family) => {
    assert.ok(Number.isSafeInteger(row.seq) && row.seq > 0, `${family} carries its seq`);
    assert.ok(typeof row.ts === 'string' && row.ts.length > 0, `${family} carries its ts`);
  };
  for (const [workId, row] of Object.entries(view.work)) stamped(row, `work ${workId}`);
  for (const [assignmentId, row] of Object.entries(view.assignments)) stamped(row, `assignment ${assignmentId}`);
  for (const [contextKey, row] of Object.entries(view.context)) stamped(row, `context ${contextKey}`);
  for (const [contributionId, row] of Object.entries(view.contributions)) stamped(row, `contribution ${contributionId}`);
  for (const [contributionId, reviews] of Object.entries(view.reviews)) {
    for (const [index, review] of reviews.entries()) stamped(review, `review ${contributionId}[${index}]`);
  }
  for (const [couplingId, row] of Object.entries(view.couplings)) stamped(row, `coupling ${couplingId}`);
  assert.equal(Object.keys(view.work).length >= 2, true);
  assert.equal(Object.keys(view.assignments).length >= 2, true);
  assert.equal(Object.keys(view.context).length >= 1, true);
  assert.equal(Object.keys(view.contributions).length >= 1, true);
  assert.equal(Object.keys(view.reviews).length >= 1, true);
  assert.equal(Object.keys(view.couplings).length >= 1, true);

  // Without a deliberate share, every live participant holds its own checkout: custody is
  // projected the same way, with shared: false and exactly one holder.
  for (const row of view.participants) {
    assert.match(row.workspace.physicalOwnerId, /^ws-[a-f0-9]{32}$/u, `${row.participantId} names its physical checkout`);
    assert.equal(row.workspace.shared, false);
    assert.equal(row.workspace.holderCount, 1);
  }
});
