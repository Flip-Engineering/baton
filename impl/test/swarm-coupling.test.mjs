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
const couplingRow = (view, couplingId) => (view?.couplings ?? []).find((row) => row.couplingId === couplingId) ?? null;

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
  schemaVersion: 1, repoId: 'repo-swarm-coupling', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t, { sharedCheckout = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-coupling-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Swarm coupling'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'coupling@example.invalid'], { cwd: repo });
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
      if (worker && driver.coordination.eventsView().some((event) => event.payload?.kind === 'swarm.turn_reported'
        && event.payload.workerId === worker.id)) return worker;
      if (Date.now() > deadline) throw new Error(`participant of ${runId} did not report a completed turn`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const asWorker = (worker) => bindBaton(app, { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: `${worker.id}-session` });
  return { app, driver, directory, root: bindBaton(app, principal('root')), paused, asWorker };
}

// The coupled subgroup: a lead (every permission) with two builders in one group, two work items
// with an active assignment each. Returns the handles the tests drive.
async function coupling(t, options = {}) {
  const fixtureHandle = await fixture(t, options);
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
  await delegated.group({ groupId: 'impl', members: ['alpha', 'beta'], purpose: 'builders' });
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

test('a synchronization point shows who has arrived, releases with who and why, and refuses dishonest arrivals', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker } = await coupling(t);

  // The lead declares the point on the builders' group.
  await delegated.couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'interface-freeze' });
  let view = await swarm.view();
  let point = couplingRow(view, 'sync-freeze');
  assert.equal(point.name, 'interface-freeze');
  assert.deepEqual(point.awaiting, ['alpha', 'beta'], 'both live members are awaited');
  assert.deepEqual(point.arrivals, []);
  assert.equal(point.arrived, false);
  assert.equal(point.released, false);

  // A member arrives as its own honest report (read authority suffices); the wake fires.
  const parked = await swarm.view();
  const watching = swarm.watch({ afterSeq: parked.cursor, timeoutMs: 2000 });
  await asWorker(alphaWorker).swarms.open(swarm.id).couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'arrive' });
  const woke = await watching;
  assert.equal(woke.watch.reason, 'event');
  assert.equal(woke.watch.event.kind, 'swarm.coupling_updated');
  point = couplingRow(woke, 'sync-freeze');
  // An arrival is a row, not a bare name: it names the seat, the actor that reported it, and WHEN
  // it arrived — "who arrived and when" is answered by the artifact itself.
  assert.deepEqual(point.arrivals.map(({ participantId }) => participantId), ['alpha'],
    'the arrival records its participant in order');
  assert.equal(typeof point.arrivals[0].ts, 'string', 'the arrival carries the timestamp it was made');
  assert.match(point.arrivals[0].actor ?? '', /^worker:/u, 'and the acting identity that made the report');
  assert.deepEqual(point.awaiting, ['beta']);
  assert.equal(point.arrived, false);

  // Nobody arrives twice; an outsider is named.
  await assert.rejects(asWorker(alphaWorker).swarms.open(swarm.id)
    .couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'arrive' }),
  { code: 'swarm_already_arrived' });
  await assert.rejects(swarm.couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'arrive', participantId: 'root-nobody' }),
    { code: 'participant_not_found' }, 'an unknown arrival names the missing participant');

  // The release names who released and why — the explicit release half of the point.
  await delegated.couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'release', reason: 'the interface is frozen' });
  view = await swarm.view();
  point = couplingRow(view, 'sync-freeze');
  assert.equal(point.released, true);
  assert.equal(point.releasedBy, 'lead');
  assert.equal(point.releaseReason, 'the interface is frozen');
  await assert.rejects(swarm.couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'arrive', participantId: 'beta' }),
    { code: 'swarm_coupling_released' }, 'a released point takes no more arrivals');
});

test('a released seat never holds a synchronization point open', async (t) => {
  const { swarm, delegated } = await coupling(t);
  await delegated.couple({ couplingId: 'sync-handoff', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'handoff' });
  // beta stops (runtime gone) and its seats are released: the point must not await that seat —
  // a barrier that counts a released seat would wait forever precisely where the release is the
  // remedy (delegated-completion audit).
  await swarm.stop('beta', 'part B delivered');
  await swarm.holderRelease('beta', 'runtime is gone; seats released');
  const view = await swarm.view();
  const point = couplingRow(view, 'sync-handoff');
  assert.deepEqual(point.awaiting, ['alpha'], 'the released seat is not awaited');
  assert.deepEqual(point.departed, ['beta'], 'the departed member is named, not counted');
});

test('an exclusive writer over a shared checkout is one claim at a time, and a gone writer names its release', async (t) => {
  const { swarm, delegated, root, driver, leadWorker, paused } = await coupling(t, { sharedCheckout: true });
  // Two holders deliberately adopt the lead's live checkout.
  const adopted = await delegated.recruit('sharer', 'Share the checkout', { ...selection, shareWorkspaceWith: 'lead' });
  await paused(adopted.runId);
  const joiner = await delegated.recruit('joiner', 'Share the checkout too', { ...selection, shareWorkspaceWith: 'lead' });
  await paused(joiner.runId);
  const view0 = await swarm.view();
  const checkout = view0.participants.find((row) => row.participantId === 'sharer').workspaceId;
  assert.ok(checkout, 'the adopted participants are recorded in the shared checkout');
  assert.equal(view0.participants.find((row) => row.participantId === 'joiner').workspaceId, checkout,
    'both adopters name one physical checkout');
  assert.equal(checkout, driver.coordinator.workspaceAttachment(leadWorker.id).workspaceId,
    'the adopters\' recorded checkout is the lead\'s live one');

  // The lead claims the checkout for the sharer: one record names the exclusive writer.
  await delegated.couple({ couplingId: 'writer-main', coupling: 'writer', action: 'declare', participantId: 'sharer' });
  let view = await swarm.view();
  const claim = couplingRow(view, 'writer-main');
  assert.equal(claim.writer, 'sharer');
  assert.equal(claim.workspaceId, checkout, 'the claim records which checkout is held');

  // A second writer over the SAME checkout refuses, naming the current writer; a claim without
  // an identifiable writer (no caller to default to) names what is missing.
  await assert.rejects(delegated.couple({ couplingId: 'writer-second', coupling: 'writer', action: 'declare', participantId: 'joiner' }),
    (error) => error.code === 'swarm_writer_conflict' && /sharer/u.test(error.message));
  await assert.rejects(root.swarms.open(swarm.id).couple({ couplingId: 'writer-anon', coupling: 'writer', action: 'declare' }),
    (error) => error.code === 'invalid_payload' && /exactly one of participantId/u.test(error.message));

  // Release frees the checkout; a new claim then lands.
  await delegated.couple({ couplingId: 'writer-main', coupling: 'writer', action: 'release', reason: 'sharer turn done' });
  view = await swarm.view();
  assert.equal(couplingRow(view, 'writer-main').released, true);
  assert.equal(couplingRow(view, 'writer-main').releasedBy, 'lead');
  await delegated.couple({ couplingId: 'writer-turn-2', coupling: 'writer', action: 'declare', participantId: 'joiner' });
  view = await swarm.view();
  assert.equal(couplingRow(view, 'writer-turn-2').writer, 'joiner');

  // A writer whose runtime dies does not hold the checkout invisibly: attention names the
  // release that frees it.
  await swarm.stop('joiner', 'joiner runtime lost');
  view = await swarm.view();
  const gone = view.attention.find((row) => row.kind === 'coupling_writer_gone');
  assert.deepEqual(gone, { kind: 'coupling_writer_gone', couplingId: 'writer-turn-2', participantId: 'joiner',
    workspaceId: couplingRow(view, 'writer-turn-2').workspaceId,
    next: { event: 'swarm.coupling_updated', couplingId: 'writer-turn-2', action: 'release' } });
  await swarm.couple({ couplingId: 'writer-turn-2', coupling: 'writer', action: 'release', reason: 'writer is gone' });
  view = await swarm.view();
});

test('a declared failure policy tells the dependents when a member is gone; independence is the undeclared default', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker } = await coupling(t);

  // Without a declared policy, a member's death is the existing organization truth only: no
  // coupling row appears — independent activities inherit nothing by sharing a swarm.
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', workId: 'W-A', body: 'Part A implemented',
  });
  let view = await swarm.view();
  assert.equal(view.attention.some((row) => row.kind === 'group_member_gone'), false);

  // The lead declares the policy on the builders' group and W-B declares its dependency on W-A.
  await swarm.work({ workId: 'W-B', objective: 'Part B', dependsOn: [{ workId: 'W-A' }] });
  await delegated.couple({ couplingId: 'policy-impl', coupling: 'failure', action: 'declare', groupId: 'impl', policy: 'independent' });
  view = await swarm.view();
  assert.equal(couplingRow(view, 'policy-impl').policy, 'independent');
  await assert.rejects(delegated.couple({ couplingId: 'policy-impl-2', coupling: 'failure', action: 'declare', groupId: 'impl', policy: 'independent' }),
    { code: 'swarm_coupling_conflict' }, 'one declared policy per group until released');
  await assert.rejects(delegated.couple({ couplingId: 'policy-gone', coupling: 'failure', action: 'declare', groupId: 'impl', policy: 'quorum' }),
    (error) => error.code === 'invalid_payload' && /independent/u.test(error.message), 'an unknown policy is named');

  // alpha's runtime dies: the policy row tells the group — the member is named, and the
  // dependent work (W-B, declared on alpha's W-A) is told. Independent peers continue.
  await swarm.stop('alpha', 'runtime lost');
  view = await swarm.view();
  const row = view.attention.find((row) => row.kind === 'group_member_gone');
  assert.deepEqual(row, { kind: 'group_member_gone', couplingId: 'policy-impl', groupId: 'impl',
    participantId: 'alpha', policy: 'independent', dependentWork: ['W-B'] });
  assert.equal(view.participants.find((row) => row.participantId === 'beta').status, 'active',
    'the independent peer continues');

  // Releasing the policy ends the coupling truth: the row belongs to the coupling, so it goes.
  await delegated.couple({ couplingId: 'policy-impl', coupling: 'failure', action: 'release', reason: 'integration window over' });
  view = await swarm.view();
  assert.equal(couplingRow(view, 'policy-impl').released, true);
  assert.equal(view.attention.some((row) => row.kind === 'group_member_gone'), false);
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

test('a member whose roster intersects a synchronization point sees it; an unrelated participant does not', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker, paused } = await coupling(t);
  await delegated.couple({ couplingId: 'sync-view', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'view-check' });
  await delegated.couple({ couplingId: 'policy-view', coupling: 'failure', action: 'declare', groupId: 'impl', policy: 'independent' });

  // The lead's subtree fully owns the group: both records are in scope.
  const leadScope = await swarm.view({ participantId: 'lead' });
  assert.deepEqual(leadScope.couplings.map((row) => row.couplingId).sort(), ['policy-view', 'sync-view']);
  // alpha IS the roster the point names — a seat listed in `awaiting` must be able to read the
  // barrier it is asked to arrive at, even though its own subtree does not own the whole group.
  const alphaScope = await swarm.view({ participantId: 'alpha' });
  assert.deepEqual(alphaScope.couplings.map((row) => row.couplingId).sort(), ['policy-view', 'sync-view'],
    'a member whose roster intersects the point sees it');
  // A participant outside the roster sees nothing of it: the record is scoped by intersection,
  // never broadcast.
  const scout = await delegated.recruit('scout', 'Outside the coupled group', selection);
  await paused(scout.runId);
  const scoutScope = await swarm.view({ participantId: 'scout' });
  assert.deepEqual(scoutScope.couplings.map((row) => row.couplingId), []);

  // An arrival wakes a watcher; the wake carries the coupling truth.
  const parked = await swarm.view();
  const watching = swarm.watch({ afterSeq: parked.cursor, timeoutMs: 2000 });
  await asWorker(alphaWorker).swarms.open(swarm.id).couple({ couplingId: 'sync-view', coupling: 'synchronization', action: 'arrive' });
  const woke = await watching;
  assert.equal(woke.watch.reason, 'event');
  assert.equal(couplingRow(woke, 'sync-view').arrivals.length, 1);
});

test('the coordination log replays to the byte-identical swarm with couplings and dependencies', async (t) => {
  const { swarm, driver, delegated, alphaWorker, betaWorker, asWorker } = await coupling(t);
  await delegated.work({ workId: 'W-B', objective: 'Part B', dependsOn: [{ workId: 'W-A' }, { artifact: 'artifact:iface' }] });
  await delegated.couple({ couplingId: 'sync-replay', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'replay-check' });
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', workId: 'W-A', refs: ['artifact:iface'], body: 'Part A',
  });
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'accept' });
  await asWorker(betaWorker).swarms.open(swarm.id).couple({ couplingId: 'sync-replay', coupling: 'synchronization', action: 'arrive' });
  await delegated.couple({ couplingId: 'writer-replay', coupling: 'writer', action: 'declare', participantId: 'lead' });
  await delegated.couple({ couplingId: 'policy-replay', coupling: 'failure', action: 'declare', groupId: 'impl', policy: 'independent' });

  const replayed = new Map();
  for (const event of driver.coordination.eventsView().filter((event) => event.kind.startsWith('swarm.'))) {
    foldSwarmEvent(replayed, event);
  }
  const live = driver.coordination.swarm(swarm.id);
  assert.equal(JSON.stringify(replayed.get(swarm.id)), JSON.stringify(live),
    'the replayed fold is byte-identical to the live fold, couplings and dependencies included');
});
