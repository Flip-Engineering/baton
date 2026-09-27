// Declared coupling and session ownership (issue #263 items 2–3, fixture pattern from
// swarm-delegated-completion.test.mjs): the four coupling choices docs/39 names — a dependency
// between units of work, a synchronization point a group arrives at and is released from, an
// exclusive writer over a shared checkout, and a group failure policy — are DECLARED records the
// swarm keeps honest and that INFORM through the view, the attention rows and the swarm.watch
// wake; nothing stops a worker. A member that leaves leaves its session to its recruiter (then
// the swarm's creator), and the attention row names that party and the reclaiming operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { foldSwarmEvent } from '../src/swarm-state.mjs';

// The view's coupling collection is an ARRAY of rows (issue #302, one collection shape).

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-coupling', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16, maxTextBytes: 8192,
    maxItems: 64, maxScopePaths: 64, maxRouteValues: 32, maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024,
    maxStatusBytes: 256 * 1024, maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code',
  timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-swarm-coupling', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-coupling-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Swarm coupling', GIT_COMMITTER_NAME: 'Swarm coupling' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'coupling@example.invalid', GIT_COMMITTER_EMAIL: 'coupling@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'ready', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(), turnCompletion: 'pausable',
    modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000,
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

// The coupled subgroup: a lead (every permission) with two builders in one group, two work items
// with an active assignment each. Returns the handles the tests drive.
async function coupling(t) {
  const fixtureHandle = await fixture(t);
  const { root, paused, asWorker, driver } = fixtureHandle;
  const swarm = await root.swarms.create('Declared coupling');
  const lead = await swarm.recruit('lead', 'Coordinate', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(lead.runId);
  const delegated = asWorker(leadWorker).swarms.open(swarm.id);
  const alpha = await delegated.recruit('alpha', 'Build A', selection);
  const beta = await delegated.recruit('beta', 'Build B', selection);
  const alphaWorker = await paused(alpha.runId);
  const betaWorker = await paused(beta.runId);
  await delegated.work({ workId: 'W-A', objective: 'Part A', status: 'open' });
  await delegated.work({ workId: 'W-B', objective: 'Part B', status: 'open' });
  await delegated.assign({ assignmentId: 'as-alpha', participantId: 'alpha', workId: 'W-A', status: 'active' });
  await delegated.assign({ assignmentId: 'as-beta', participantId: 'beta', workId: 'W-B', status: 'active' });
  return { ...fixtureHandle, swarm, delegated, alpha, beta, leadWorker, alphaWorker, betaWorker, driver };
}

test('a declared work dependency is informed, settles with evidence, and never gates', async (t) => {
  const { swarm, delegated, alphaWorker, betaWorker, asWorker } = await coupling(t);

  // W-B is declared to wait on W-A's accepted contribution, and on a named artifact.
  await delegated.work({ workId: 'W-B', objective: 'Part B', dependsOn: [{ workId: 'W-A' }, { artifact: 'artifact:iface' }] });
  let view = await swarm.view();
  assert.deepEqual(view.work['W-B'].waitsOn, [
    { workId: 'W-A', settled: false, evidence: [] },
    { artifact: 'artifact:iface', settled: false, evidence: [] },
  ], 'the declaration shows as two unsettled waits');

  // The wake feed fires on the declaration: a watcher parked before it learns of it.
  const parked = await swarm.view();
  const watching = swarm.watch({ afterSeq: parked.cursor, timeoutMs: 2000 });
  await delegated.work({ workId: 'W-C', objective: 'Also declared', dependsOn: [{ workId: 'W-A' }] });
  const declaredWake = await watching;
  assert.equal(declaredWake.watch.reason, 'event');
  assert.equal(declaredWake.watch.event.kind, 'swarm.work_updated',
    'a dependency declaration wakes the feed like any swarm event');

  // A participant whose work waits proceeds anyway — visible, allowed, never stopped.
  await asWorker(betaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-beta-1', participantId: 'beta', workId: 'W-B', body: 'Part B built ahead of its dependency',
  });
  await delegated.review({ contributionId: 'contribution-beta-1', decision: 'accept', reason: 'part B stands alone' });
  view = await swarm.view();
  assert.equal(view.work['W-B'].evidence.derivedComplete, true, 'the unsettled dependency did not gate completion');
  assert.deepEqual(view.work['W-B'].waitsOn[0], { workId: 'W-A', settled: false, evidence: [] },
    'the wait stays honestly unsettled while the work proceeds');

  // The dependency settles from evidence: an accepted contribution on W-A that also references
  // the artifact. The review that settles both waits is itself the wake.
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', workId: 'W-A', refs: ['artifact:iface'], body: 'Part A + interface',
  });
  const settled = await swarm.view();
  const settling = swarm.watch({ afterSeq: settled.cursor, timeoutMs: 2000 });
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'accept', reason: 'verified' });
  const woke = await settling;
  assert.equal(woke.watch.reason, 'event');
  assert.equal(woke.watch.event.kind, 'swarm.contribution_reviewed');
  assert.deepEqual(woke.work['W-B'].waitsOn, [
    { workId: 'W-A', settled: true, evidence: ['contribution-alpha-1'] },
    { artifact: 'artifact:iface', settled: true, evidence: ['contribution-alpha-1'] },
  ], 'each wait names the accepted contribution that settled it');
});

test('dependency declarations refuse what no evidence could ever settle', async (t) => {
  const { delegated } = await coupling(t);
  await assert.rejects(delegated.work({ workId: 'W-C', objective: 'Dangling', dependsOn: [{ workId: 'W-nope' }] }),
    (error) => error.code === 'work_not_found' && /W-nope/u.test(error.message),
    'an unknown target work is named');
  await assert.rejects(delegated.work({ workId: 'W-C', objective: 'Self', dependsOn: [{ workId: 'W-C' }] }),
    { code: 'work_dependency_self' });
  await delegated.work({ workId: 'W-C', objective: 'Ring tail', dependsOn: [{ workId: 'W-B' }] });
  await assert.rejects(delegated.work({ workId: 'W-B', objective: 'Part B', dependsOn: [{ workId: 'W-C' }] }),
    (error) => error.code === 'work_dependency_cycle' && /W-B -> W-C -> W-B/u.test(error.message),
    'a ring of waits refuses and names the ring');
  await assert.rejects(delegated.work({ workId: 'W-D', objective: 'Both', dependsOn: [{ workId: 'W-A', artifact: 'x' }] }),
    (error) => error.code === 'invalid_payload' && /exactly one/u.test(error.message));
});


test('a member that leaves hands its live session to its recruiter, then to the creator, and the row names the reclaim', async (t) => {
  const { swarm, delegated } = await coupling(t);
  // beta leaves organizationally while its session keeps running.
  await delegated.leave({ participantId: 'beta', reason: 'turn complete' });
  let view = await swarm.view();
  let row = view.attention.find((row) => row.kind === 'member_left_session_live' && row.participantId === 'beta');
  assert.equal(row.responsibleParticipant, 'lead', 'the recruiter is the responsible party');
  assert.equal(row.responsibleActor, null);
  assert.deepEqual(row.next, { command: 'swarm.stop', swarmId: swarm.id, participantId: 'beta' },
    'the row names the operation that reclaims the session');

  // The lead leaves too: responsibility walks up to the swarm's creator.
  await delegated.leave({ reason: 'delegation complete' });
  view = await swarm.view();
  row = view.attention.find((row) => row.kind === 'member_left_session_live' && row.participantId === 'beta');
  assert.equal(row.responsibleParticipant, null, 'no living participant ancestor remains');
  assert.equal(row.responsibleActor, 'direct:root', 'the creator is named as the responsible party');
  row = view.attention.find((row) => row.kind === 'member_left_session_live' && row.participantId === 'lead');
  assert.equal(row.responsibleActor, 'direct:root', 'the lead\'s own row names the creator too');

  // Reclaiming is the explicit stop the row named: after it, the row is gone.
  await swarm.stop('beta', 'reclaimed by the responsible party');
  view = await swarm.view();
  assert.equal(view.attention.some((row) => row.kind === 'member_left_session_live' && row.participantId === 'beta'), false,
    'the reclaim cleared the row');
});
