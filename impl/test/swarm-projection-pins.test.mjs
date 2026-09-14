// Swarm projection pins (work W2 pinning unit W1 'projections'; fixture pattern from
// swarm-coupling.test.mjs): the observable view shape an agent reads is pinned independently of
// the file that implements it — guidance rows read from the message lane, the guide receipt that
// wrote each one, live checkout custody, and the seq/ts every projected row family carries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-projection-pins', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
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
const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024,
  maxReservedInodes: 10_000,
  minFreeBytes: 1,
  minFreeInodes: 1,
  runtimeReserveBytes: 4 * 1024,
  runtimeReserveInodes: 4,
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-projection-pins', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

// turnDelayMs keeps a resumed mock turn alive long enough that a guide issued right after a resume
// reaches the receipted delivery lane instead of writing no lane receipt at all.
async function fixture(t, { sharedCheckout = false, turnDelayMs = 5 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-projection-pins-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Swarm projection pins'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'pins@example.invalid'], { cwd: repo });
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

async function builders(t, options = {}) {
  const fixtureHandle = await fixture(t, options);
  const { root, paused, asWorker } = fixtureHandle;
  const swarm = await root.swarms.create('Projection pins');
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
  return { ...fixtureHandle, swarm, delegated, lead, leadWorker, alpha, alphaWorker, beta, betaWorker };
}

test('the view pins what a participant was told, and the guide receipt that wrote each row', async (t) => {
  const { swarm, delegated, leadWorker } = await builders(t, { turnDelayMs: 250 });
  const leadActor = `worker:${leadWorker.id}`;
  // The first guide resumes the paused turn: no lane receipt, so the projection honestly shows none.
  await delegated.guide('alpha', 'Resume on the interface');
  let view = await swarm.view();
  assert.deepEqual(view.participants.find((row) => row.participantId === 'alpha').guidance, []);

  // Receipted guides return the row they wrote, and the projection carries exactly those rows for
  // the addressee — in log order, each naming its writer, its seq, and its ts.
  const first = await delegated.guide('alpha', 'First receipted guidance');
  const second = await delegated.guide('alpha', 'Second receipted guidance');
  assert.ok(Number.isSafeInteger(first.guide.seq) && first.guide.seq > 0);
  assert.ok(typeof first.guide.ts === 'string' && first.guide.ts.length > 0);
  assert.match(first.guide.messageId, /^message:[a-f0-9]{64}$/u);
  assert.ok(second.guide.seq > first.guide.seq, 'each receipted guide writes a later row');
  view = await swarm.view();
  const alpha = view.participants.find((row) => row.participantId === 'alpha');
  assert.deepEqual(alpha.guidance, [
    { seq: first.guide.seq, ts: first.guide.ts, from: leadActor, messageId: first.guide.messageId },
    { seq: second.guide.seq, ts: second.guide.ts, from: leadActor, messageId: second.guide.messageId },
  ], 'the guidance rows are the receipts addressed to this participant, in log order');
  assert.deepEqual(view.participants.find((row) => row.participantId === 'beta').guidance, [],
    'guidance follows the addressee, never the whole swarm');
});

test('the view pins live checkout custody against the coordinator attachment it projects', async (t) => {
  const { swarm, delegated, driver, leadWorker, paused } = await builders(t, { sharedCheckout: true, turnDelayMs: 250 });
  const sharer = await delegated.recruit('sharer', 'Share the checkout', { ...selection, shareWorkspaceWith: 'lead' });
  await paused(sharer.runId);
  const view = await swarm.view();
  const byId = new Map(view.participants.map((row) => [row.participantId, row]));

  // The custody row is the coordinator's own live attachment, projected: physical owner, live
  // holder count, and the `shared` flag derived from holding the checkout together.
  const attachment = driver.coordinator.workspaceAttachment(leadWorker.id);
  for (const participantId of ['lead', 'sharer']) {
    const row = byId.get(participantId);
    assert.deepEqual(row.workspace, {
      physicalOwnerId: attachment.workspaceId, shared: true, holderCount: attachment.holderCount,
    }, `${participantId} carries the live shared checkout`);
  }
  // A participant working alone names its own checkout with shared: false.
  const solo = byId.get('alpha').workspace;
  assert.notEqual(solo.physicalOwnerId, attachment.workspaceId);
  assert.equal(solo.shared, false);
  assert.equal(solo.holderCount, 1);
  // A gone participant carries no live checkout — null, never a stale record.
  await swarm.stop('alpha', 'runtime lost');
  const stopped = (await swarm.view()).participants.find((row) => row.participantId === 'alpha');
  assert.equal(['dead', 'exited'].includes(stopped.runtime.state), true);
  assert.equal(stopped.workspace, null);
});

test('every projected row family pins its seq and ts', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker } = await builders(t);
  await delegated.work({ workId: 'W-B', objective: 'Part B', status: 'open', dependsOn: [{ workId: 'W-A' }] });
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
  for (const participant of view.participants) stamped(participant, `participant ${participant.participantId}`);
  for (const [workId, row] of Object.entries(view.work)) stamped(row, `work ${workId}`);
  for (const [assignmentId, row] of Object.entries(view.assignments)) stamped(row, `assignment ${assignmentId}`);
  for (const [key, row] of Object.entries(view.context)) stamped(row, `context ${key}`);
  for (const [contributionId, row] of Object.entries(view.contributions)) stamped(row, `contribution ${contributionId}`);
  for (const [contributionId, reviews] of Object.entries(view.reviews)) {
    for (const [index, review] of reviews.entries()) stamped(review, `review ${contributionId}[${index}]`);
  }
  for (const [couplingId, row] of Object.entries(view.couplings)) stamped(row, `coupling ${couplingId}`);
  assert.equal(Object.keys(view.assignments).length >= 2, true);
  assert.equal(Object.keys(view.contributions).length >= 1, true);
  assert.equal(Object.keys(view.reviews).length >= 1, true);
  assert.equal(Object.keys(view.couplings).length >= 1, true);
  // The declared wait is projected with its evidence: the accepted contribution on W-A settles it.
  assert.deepEqual(view.work['W-B'].waitsOn, [{ workId: 'W-A', settled: true, evidence: ['contribution-alpha-1'] }]);
});
