// Delegated completion truth (issue #263, fixture pattern from swarm-organization-truth.test.mjs):
// work completion derives from accepted contributions (or an explicitly cited basis), every
// participant's delegation is visible as a unit, a gone holder's seats are released in one durable
// batch whose replay equals the hand-written sequence, and swarm.view scopes to a delegation with
// the optional participantId argument.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { foldSwarmEvent } from '../src/swarm-state.mjs';

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-delegated-completion', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
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
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-delegated-completion', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-delegated-completion-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Delegated completion'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'delegation@example.invalid'], { cwd: repo });
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
  const driver = createDriver({ repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000 });
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

// The shared delegation: a lead (every permission) with two builders, two work items, active
// assignments, and one group. Returns the handles the tests drive.
async function delegation(t) {
  const fixtureHandle = await fixture(t);
  const { root, paused, asWorker } = fixtureHandle;
  const swarm = await root.swarms.create('Delegated completion');
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
  await delegated.group({ groupId: 'impl', members: ['alpha', 'beta'], purpose: 'builders' });
  return { ...fixtureHandle, swarm, delegated, alphaWorker, betaWorker };
}

test('completion derives from an accepted contribution, refuses by hand, and accepts a cited basis', async (t) => {
  const { swarm, delegated, alphaWorker, betaWorker, asWorker } = await delegation(t);

  // alpha publishes a finding on W-A; before any review the accept set is empty.
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', workId: 'W-A', body: 'Part A implemented',
  });
  let view = await swarm.view();
  assert.deepEqual(view.work['W-A'].evidence,
    { contributions: ['contribution-alpha-1'], accepted: [], derivedComplete: false });

  // The lead's accept makes W-A completion derivable from evidence.
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'accept', reason: 'verified against the build' });
  view = await swarm.view();
  assert.deepEqual(view.work['W-A'].evidence,
    { contributions: ['contribution-alpha-1'], accepted: ['contribution-alpha-1'], derivedComplete: true });
  assert.deepEqual(view.work['W-B'].evidence, { contributions: [], accepted: [], derivedComplete: false });

  // A hand-set completed status without evidence refuses, naming what is missing...
  await assert.rejects(swarm.work({ workId: 'W-B', status: 'completed' }), (error) => {
    assert.equal(error.code, 'swarm_completion_unproven');
    assert.match(error.message, /no accepted contribution references this work/u);
    return true;
  });
  // ...and so does a basis citing an accepted contribution that evidences ANOTHER work item.
  await assert.rejects(swarm.work({ workId: 'W-B', status: 'completed', basis: { contributionIds: ['contribution-alpha-1'] } }),
    (error) => error.code === 'swarm_completion_unproven'
      && /does not evidence this work/u.test(error.message)
      && error.detail.problems[0].problem === 'does not reference this work');

  // The derived completion is accepted without a basis.
  await swarm.work({ workId: 'W-A', status: 'completed' });
  view = await swarm.view();
  assert.equal(view.work['W-A'].status, 'completed');

  // A refs-only contribution is evidence through the cited basis, never through the derivation.
  await asWorker(betaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-beta-1', participantId: 'beta', refs: ['W-B'], body: 'Part B verified',
  });
  await delegated.review({ contributionId: 'contribution-beta-1', decision: 'accept' });
  view = await swarm.view();
  assert.equal(view.work['W-B'].evidence.derivedComplete, false, 'a refs link alone does not derive completion');
  await swarm.work({ workId: 'W-B', status: 'completed', basis: { contributionIds: ['contribution-beta-1'] } });
  view = await swarm.view();
  assert.equal(view.work['W-B'].status, 'completed');

  // Delegation truth: the lead sees its whole subtree; a finished leaf with no children completes.
  assert.deepEqual(view.participants.find((row) => row.participantId === 'lead').delegation,
    { children: ['alpha', 'beta'], work: ['W-A', 'W-B'], complete: false },
    'a child still holding an active assignment keeps the delegation open');
  assert.deepEqual(view.participants.find((row) => row.participantId === 'alpha').delegation,
    { children: [], work: ['W-A'], complete: true });
  assert.deepEqual(view.participants.find((row) => row.participantId === 'beta').delegation,
    { children: [], work: ['W-B'], complete: true },
    'a finished leaf completes even while its assignment stays active — the release is bookkeeping');
});

// 2026-09-14 audit S-E3 (swarm-b/lead.md finding 9): `complete` was `[].every(...)` — vacuously
// true — so a participant holding no assignment at all read as a completed delegation. Completion
// is derived only where work exists; an empty delegation is underived.
test('an unassigned participant\'s delegation is underived, never vacuously complete', async (t) => {
  const { swarm, delegated, paused } = await delegation(t);
  const quiet = await delegated.recruit('quiet', 'Nothing assigned yet', selection);
  await paused(quiet.runId);

  const view = await swarm.view();
  assert.deepEqual(view.participants.find((row) => row.participantId === 'quiet').delegation,
    { children: [], work: [], complete: null },
    'no active assignment in the subtree: completeness is underived, never vacuously true');
  assert.deepEqual(view.participants.find((row) => row.participantId === 'lead').delegation,
    { children: ['alpha', 'beta', 'quiet'], work: ['W-A', 'W-B'], complete: false },
    'an idle child neither completes nor opens the lead\'s delegation — its own work decides');
});

test('the subtree view: the root and the lead see the same delegation, scoped to it', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker } = await delegation(t);
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', workId: 'W-A', body: 'Part A implemented',
  });
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'accept' });

  const asRoot = await swarm.view({ participantId: 'lead' });
  const asLead = await delegated.view({ participantId: 'lead' });
  for (const field of ['participants', 'work', 'assignments', 'contributions', 'reviews', 'groups', 'attention']) {
    assert.deepEqual(asLead[field], asRoot[field], `${field} is the same subtree for the root and the lead`);
  }
  assert.equal(asRoot.caller.participantId, null);
  assert.equal(asLead.caller.participantId, 'lead');
  assert.deepEqual(asRoot.participants.find((row) => row.participantId === 'lead').delegation,
    { children: ['alpha', 'beta'], work: ['W-A', 'W-B'], complete: false });

  // A leaf scope excludes everyone else: alpha's delegation is alpha, its work, its evidence.
  const alphaScope = await swarm.view({ participantId: 'alpha' });
  assert.deepEqual(alphaScope.participants.map((row) => row.participantId), ['alpha']);
  assert.deepEqual(Object.keys(alphaScope.work), ['W-A']);
  assert.deepEqual(Object.keys(alphaScope.assignments), ['as-alpha']);
  assert.deepEqual(Object.keys(alphaScope.contributions), ['contribution-alpha-1']);
  assert.deepEqual(Object.keys(alphaScope.reviews), ['contribution-alpha-1']);
  // A group is a roster, scoped by the SAME intersection rule the couplings use (issue #283): the
  // group alpha sits on is alpha's business and is shown — with the roster it really has — while a
  // group no member of the subtree sits on is not. An EMPTY roster intersects nobody, so a group
  // emptied by a released holder is carried by no scoped view at all.
  await delegated.group({ groupId: 'beta-only', members: ['beta'], purpose: 'no alpha here' });
  assert.deepEqual(alphaScope.groups.impl.members, ['alpha', 'beta'], 'a group the seat is on is in scope');
  assert.equal(alphaScope.groups['beta-only'], undefined, 'a group the seat is not on is out of scope');
  assert.deepEqual(alphaScope.participants[0].delegation, { children: [], work: ['W-A'], complete: false });
  assert.equal(asRoot.participants.some((row) => row.participantId === 'beta'), true);
  assert.equal(alphaScope.participants.some((row) => row.participantId === 'beta'), false, 'unrelated participants are excluded');

  await assert.rejects(swarm.view({ participantId: 'nobody' }), { code: 'swarm_participant_not_found' });
});

test('a gone holder is released in one durable batch; a live one refuses', async (t) => {
  const { swarm, driver, delegated } = await delegation(t);

  // A live active participant refuses.
  await assert.rejects(swarm.holderRelease('beta', 'still working'), (error) => {
    assert.equal(error.code, 'swarm_holder_live');
    assert.equal(error.detail.participantId, 'beta');
    return true;
  });

  // Stopping alpha names the release operation as the next step...
  await swarm.stop('alpha', 'part A delivered');
  let view = await swarm.view();
  assert.deepEqual(view.attention.find((row) => row.kind === 'assignment_holder_gone'),
    { kind: 'assignment_holder_gone', assignmentId: 'as-alpha', participantId: 'alpha', workId: 'W-A',
      next: { event: 'swarm.holder_released', participantId: 'alpha' } });

  // ...and the release lands as ONE batch of exactly the individual events a hand-written
  // sequence would record — no extra kind in the durable log, so replay is byte-identical.
  const before = driver.coordination.ledgerHeadSeq();
  view = await swarm.holderRelease('alpha', 'runtime is gone; seats released');
  assert.equal(view.assignments['as-alpha'].status, 'released');
  assert.deepEqual(view.groups['impl'].members, ['beta']);
  const batch = driver.coordination.eventsView().slice(before);
  assert.deepEqual(batch.filter((event) => event.kind.startsWith('swarm.')).map((event) => event.kind),
    ['swarm.assignment_updated', 'swarm.group_updated']);
  assert.equal(driver.coordination.eventsView().some((event) => event.kind === 'swarm.holder_released'), false,
    'the release event expands; it never lands as its own durable kind');
  const requested = batch.find((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.operation_requested');
  assert.equal(requested.payload.request.event, 'swarm.holder_released', 'the batch request, reason included, is durable');
  assert.equal(requested.payload.request.payload.reason, 'runtime is gone; seats released');

  // The lead leaves organizationally: its orphaned children name the same next step, and the
  // departed lead itself (status left) is releasable — an honest no-op when it holds no seats.
  await delegated.leave({ reason: 'delegation complete' });
  view = await swarm.view();
  const orphan = view.attention.find((row) => row.kind === 'delegation_orphaned' && row.participantId === 'beta');
  assert.deepEqual(orphan.next, { event: 'swarm.holder_released', participantId: 'lead' });
  view = await swarm.holderRelease('lead', 'departed; seats released');
  assert.equal(view.participants.find((row) => row.participantId === 'lead').status, 'left');
});

test('replay of the coordination log reproduces the same swarm, release batch included', async (t) => {
  const { swarm, driver, delegated, alphaWorker, asWorker } = await delegation(t);
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', workId: 'W-A', body: 'Part A implemented',
  });
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'accept' });
  await swarm.work({ workId: 'W-A', status: 'completed', basis: { contributionIds: ['contribution-alpha-1'] } });
  await swarm.stop('alpha', 'part A delivered');
  await swarm.holderRelease('alpha', 'runtime is gone; seats released');

  // The swarm lane's replay law (the store's own fold step for swarm event kinds) applied to the
  // durable log alone must reproduce the live projection byte-identically — the holder release
  // batch replays exactly like the hand-written sequence of its individual events.
  const replayed = new Map();
  for (const event of driver.coordination.eventsView().filter((event) => event.kind.startsWith('swarm.'))) {
    foldSwarmEvent(replayed, event);
  }
  const live = driver.coordination.swarm(swarm.id);
  assert.equal(JSON.stringify(replayed.get(swarm.id)), JSON.stringify(live),
    'the replayed fold is byte-identical to the live fold, release batch included');
});
