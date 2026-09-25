// Issue #292 — the declared coupling tells the truth (2026-09-14 audits: swarm-a finding 7 and
// "what did not" (b); swarm-b findings 5, 7, 9; tight-coupling root §2). Eight guarantees, each
// proven end to end here:
//   1. the exclusive-writer guard is never inert: the first recruit into a checkout records it,
//      and a claim over a participant with no recorded checkout is REFUSED, not recorded inert;
//   2. re-declaring a synchronization point carries its arrivals forward and says so;
//   3. releasedBy / reviewerId are the ACTOR — the member's name, or the acting principal's label
//      for an external orchestrator (the root's acts never land as null);
//   4. arrivals carry the actor and the timestamp that made them;
//   5. a member listed in `awaiting` sees the synchronization record in its own scoped view;
//   6. a retry under a spent idempotencyKey names its remedy (a new key);
//   7. the bridge tells the truth about keys (covered in swarm-native-bridge.test.mjs);
//   8. the native guidance names commands that exist.
// Fixture style: swarm-coupling.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_COMMAND_NAMES, SWARM_EVENT_KINDS } from '../src/swarm-contract.mjs';
// #425: the guidance may name a kind the runtime records into the swarm fold (never
// caller-submittable), so the registered vocabulary includes the fold's own set.
import { SWARM_EVENT_KINDS as SWARM_FOLD_EVENT_KINDS } from '../src/swarm-state.mjs';
import { SWARM_NATIVE_GUIDANCE } from '../src/swarm-native-access.mjs';

// The view's coupling collection is an ARRAY of rows (issue #302, one collection shape).
const couplingRow = (view, couplingId) => (view?.couplings ?? []).find((row) => row.couplingId === couplingId) ?? null;

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-coupling-truth', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
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
const capacityPolicy = Object.freeze({
  maxReservedBytes: 64 * 1024 * 1024, maxReservedInodes: 10_000,
  minFreeBytes: 1, minFreeInodes: 1, runtimeReserveBytes: 4 * 1024, runtimeReserveInodes: 4,
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'repo-coupling-truth', definitionOfDone: ['done'], constraints: ['scope'], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-coupling-truth-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['config', 'user.name', 'Coupling truth'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'coupling-truth@example.invalid'], { cwd: repo });
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
    worktreeCapacity: capacityPolicy,
    worktreeCapacityEstimate: () => ({ bytes: 16 * 1024, inodes: 32 }),
    worktreeCapacityObserve: () => ({ freeBytes: 1024 * 1024 * 1024, freeInodes: 1_000_000 }),
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
      if (worker && driver.coordination.eventsView().some((event) => event.payload?.kind === 'swarm.turn_reported' && event.payload.workerId === worker.id)) return worker;
      if (Date.now() > deadline) throw new Error(`participant of ${runId} did not pause`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const asWorker = (worker) => bindBaton(app, { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: `${worker.id}-session` });
  return { app, driver, directory, root: bindBaton(app, principal('root')), paused, asWorker };
}

// A lead (every permission) with two builders in one group — the coupled subgroup the records
// below are declared over.
async function coupling(t) {
  const handle = await fixture(t);
  const { root, paused, asWorker } = handle;
  const swarm = await root.swarms.create('Coupling truth');
  const lead = await swarm.recruit('lead', 'Coordinate', { ...selection, permissions: SWARM_PERMISSIONS });
  const leadWorker = await paused(lead.runId);
  const delegated = asWorker(leadWorker).swarms.open(swarm.id);
  const alpha = await delegated.recruit('alpha', 'Build A', selection);
  const beta = await delegated.recruit('beta', 'Build B', selection);
  const alphaWorker = await paused(alpha.runId);
  const betaWorker = await paused(beta.runId);
  await delegated.group({ groupId: 'impl', members: ['alpha', 'beta'], purpose: 'builders' });
  return { ...handle, swarm, delegated, lead, alpha, beta, leadWorker, alphaWorker, betaWorker };
}

test('the first recruit into a checkout records it, and the writer guard fires for that holder', async (t) => {
  const { swarm, delegated, paused } = await coupling(t);
  const view = await swarm.view();
  const lead = view.participants.find((row) => row.participantId === 'lead');
  assert.match(lead.workspaceId ?? '', /^ws-[a-f0-9]{32}$/u,
    'the first recruit into a checkout is recorded in it — the claim below has an identity to enforce');
  const sharer = await delegated.recruit('sharer', 'Share the checkout', { ...selection, shareWorkspaceWith: 'lead' });
  await paused(sharer.runId);

  // The lead holds the checkout; a second claim over the SAME recorded checkout refuses by name.
  await delegated.couple({ couplingId: 'writer-lead', coupling: 'writer', action: 'declare', participantId: 'lead' });
  const claim = await swarm.view();
  assert.equal(claim.couplings.find((row) => row.couplingId === 'writer-lead').workspaceId, lead.workspaceId,
    'the claim names the checkout the holder is recorded in');
  await assert.rejects(
    delegated.couple({ couplingId: 'writer-sharer', coupling: 'writer', action: 'declare', participantId: 'sharer' }),
    (error) => error.code === 'swarm_writer_conflict' && /lead/u.test(error.message),
    'the guard is live for a freshly recruited holder, not inert behind a null workspaceId');
});

test('a ledger written before the writer-workspace rule replays at startup instead of refusing the resident its history', async (t) => {
  // Regression 2026-09-14: the main-clone resident could not start over its deployment after the
  // #292 landing — the fold refused a recorded writer declare whose holder had no checkout. The
  // rule guards ADMISSION (the prospective fold before the append); rows read back are history.
  const directory = mkdtempSync(join(tmpdir(), 'baton-coupling-history-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  const workers = [];
  const coordinator = { list: () => workers, pausedTurns: () => [], guideParticipant: async () => ({ ok: true }) };
  const startRun = async (request) => {
    if (workers.some((row) => row.runId === request.runId)) return;
    workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {}, startRun, stopRun: async () => ({ state: 'closed' }),
  });
  await runtime.command('swarm.create', { purpose: 'history', swarmId: 'sw-h', idempotencyKey: 'create' }, owner);
  await runtime.command('swarm.recruit', { swarmId: 'sw-h', participantId: 'builder', objective: 'build', idempotencyKey: 'recruit' }, owner);
  // The row as an older resident admitted it: written straight to the ledger, no admission fold.
  const declared = store._append('swarm.coupling_updated',
    { swarmId: 'sw-h', couplingId: 'writer-h', coupling: 'writer', action: 'declare', participantId: 'builder' },
    { actor: 'owner', key: 'history-declare' }, new Date().toISOString());
  assert.equal(typeof declared.seq, 'number', 'the historical row is on the ledger');
  // The live store (it holds the writer authority) still judges a NEW claim of that shape at
  // admission: the rule is intact for requests, relaxed only for recorded history.
  await assert.rejects(runtime.command('swarm.update', {
    swarmId: 'sw-h', event: 'swarm.coupling_updated', idempotencyKey: 'claim-again',
    payload: { couplingId: 'writer-h2', coupling: 'writer', action: 'declare', participantId: 'builder' },
  }, owner), (error) => error.code === 'swarm_writer_workspace_unrecorded',
  'a NEW claim of the same shape is still refused at admission');
  // A resident starting over this deployment reads the ledger back: the historical claim folds
  // as recorded — no checkout named — and the startup never refuses.
  const reopened = new CoordinationStore(directory);
  assert.equal(reopened.swarm('sw-h').couplings['writer-h'].workspaceId, null,
    'the reopened store replays the claim as recorded — no checkout named, no refusal');
});

test('a writer claim over a participant with no recorded checkout refuses instead of landing inert', async (t) => {
  // The lane-level case: a deployment whose coordinator has no checkout attachment records none,
  // and the claim names a resource that does not exist — it must refuse, named, with the remedy.
  const directory = mkdtempSync(join(tmpdir(), 'baton-coupling-nocheckout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [], guideParticipant: async () => ({ ok: true }) },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  await runtime.command('swarm.create', { purpose: 'no checkout', swarmId: 'sw-1', idempotencyKey: 'create' }, owner);
  await runtime.command('swarm.recruit', {
    swarmId: 'sw-1', participantId: 'builder', objective: 'build', idempotencyKey: 'recruit',
  }, owner);
  const view = await runtime.command('swarm.view', { swarmId: 'sw-1' }, owner);
  assert.equal(view.participants[0].workspaceId, null, 'this deployment records no checkout for the seat');
  await assert.rejects(runtime.command('swarm.update', {
    swarmId: 'sw-1', event: 'swarm.coupling_updated', idempotencyKey: 'claim',
    payload: { couplingId: 'writer-1', coupling: 'writer', action: 'declare', participantId: 'builder' },
  }, owner), (error) => error.code === 'swarm_writer_workspace_unrecorded'
    && /no recorded checkout/u.test(error.message) && /recruited into one/u.test(error.message),
  'a claim that can never enforce exclusivity refuses, naming the remedy');
});

// ── 2 and 4. re-declaring carries arrivals; an arrival carries its actor and time ───────────────

test('arrivals carry the actor and the timestamp that made them, and a re-declare carries them forward', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker } = await coupling(t);
  await delegated.couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'interface-freeze' });
  await asWorker(alphaWorker).swarms.open(swarm.id).couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'arrive' });
  let point = couplingRow((await swarm.view()), 'sync-freeze');
  assert.deepEqual(point.arrivals.map(({ participantId }) => participantId), ['alpha']);
  assert.equal(typeof point.arrivals[0].ts, 'string', 'the arrival carries WHEN it was made');
  assert.match(point.arrivals[0].actor ?? '', /^worker:/u, 'and which identity made the report');
  assert.equal(typeof point.arrivals[0].seq, 'number');

  // Re-declaring the same point (a new name — the innocent edit the audit feared) replaces the
  // parameters and CARRIES the arrival: a barrier is never wiped silently.
  await delegated.couple({ couplingId: 'sync-freeze', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'interface-freeze-2' });
  point = couplingRow(await swarm.view(), 'sync-freeze');
  assert.equal(point.name, 'interface-freeze-2');
  assert.deepEqual(point.arrivals.map(({ participantId }) => participantId), ['alpha'],
    'the arrival the member already reported survives the re-declare');
  assert.deepEqual(point.carriedArrivals, ['alpha'], 'and the record says which arrivals it carried forward');
  assert.deepEqual(point.awaiting, ['beta'], 'the seat that still owes an arrival is still awaited');
});

// ── 3. attribution is the ACTOR ─────────────────────────────────────────────────────────────────

test('a release is attributed to the ACTOR: the member that released, or the acting principal', async (t) => {
  const { swarm, delegated, root } = await coupling(t);
  await delegated.couple({ couplingId: 'sync-x', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'x' });

  // A member releases naming ANOTHER seat (the request is about that seat): the row still names
  // the member that released — an organizer's act never lands as the seat it touched.
  await delegated.couple({ couplingId: 'sync-x', coupling: 'synchronization', action: 'release', participantId: 'beta', reason: 'released on beta\'s behalf' });
  let view = await swarm.view();
  assert.equal(couplingRow(view, 'sync-x').releasedBy, 'lead');
  assert.equal(couplingRow(view, 'sync-x').releaseReason, 'released on beta\'s behalf');

  // An external orchestrator (the root, which has no participant row) releases: the row names the
  // principal, and never lands as null.
  await delegated.couple({ couplingId: 'sync-y', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'y' });
  await root.swarms.open(swarm.id).couple({ couplingId: 'sync-y', coupling: 'synchronization', action: 'release', reason: 'the orchestrator released it' });
  view = await swarm.view();
  assert.equal(couplingRow(view, 'sync-y').releasedBy, 'direct:root',
    'the root\'s act is attributed to the root principal, not null');

  // A caller-named releasedBy that is not the actor is a misattribution and refuses.
  await delegated.couple({ couplingId: 'sync-z', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'z' });
  await assert.rejects(
    delegated.couple({ couplingId: 'sync-z', coupling: 'synchronization', action: 'release', releasedBy: 'beta', reason: 'no' }),
    (error) => error.code === 'swarm_author_mismatch' && error.detail.releasedBy === 'lead',
    'a release cannot be recorded under another identity');
});

test('a review is attributed to the ACTOR: the reviewing member, or the acting principal', async (t) => {
  const { swarm, delegated, root, alphaWorker, asWorker } = await coupling(t);
  await asWorker(alphaWorker).swarms.open(swarm.id).contribute({
    contributionId: 'contribution-alpha-1', participantId: 'alpha', body: 'Part A ready',
  });

  // The root (no participant row) reviews: the row names the root's principal, never null.
  await root.swarms.open(swarm.id).review({ contributionId: 'contribution-alpha-1', decision: 'accept', reason: 'verified' });
  let view = await swarm.view();
  assert.equal(view.reviews['contribution-alpha-1'][0].reviewerId, 'direct:root');
  await delegated.review({ contributionId: 'contribution-alpha-1', decision: 'comment', reason: 'second look' });
  view = await swarm.view();
  assert.equal(view.reviews['contribution-alpha-1'][1].reviewerId, 'lead');
  // Neither may review under another identity.
  await assert.rejects(delegated.review({ contributionId: 'contribution-alpha-1', decision: 'comment', reviewerId: 'beta' }),
    { code: 'swarm_author_mismatch' });
  await assert.rejects(root.swarms.open(swarm.id).review({ contributionId: 'contribution-alpha-1', decision: 'comment', reviewerId: 'lead' }),
    { code: 'swarm_author_mismatch' }, 'an orchestrator cannot review under a member\'s name');
  assert.equal((await swarm.view()).reviews['contribution-alpha-1'].length, 2, 'the refused reviews recorded nothing');
});

// ── 5. a member listed in awaiting sees the record ───────────────────────────────────────────────

test('a member listed in awaiting sees the synchronization record in its own scoped view', async (t) => {
  const { swarm, delegated, alphaWorker, asWorker, paused } = await coupling(t);
  await delegated.couple({ couplingId: 'sync-seen', coupling: 'synchronization', action: 'declare', groupId: 'impl', name: 'seen' });
  // alpha is a member of the group and is listed in `awaiting`: it must be able to read the point
  // it is asked to arrive at, in its OWN scoped view (docs/39 §Declared coupling).
  await asWorker(alphaWorker).swarms.open(swarm.id).couple({ couplingId: 'sync-seen', coupling: 'synchronization', action: 'arrive' });
  const betaScope = await swarm.view({ participantId: 'beta' });
  const awaited = couplingRow(betaScope, 'sync-seen');
  assert.ok(awaited, 'the member still awaited sees the record');
  assert.deepEqual(awaited.awaiting, ['beta']);
  assert.deepEqual(awaited.arrivals.map(({ participantId }) => participantId), ['alpha']);
  // A participant whose roster does not intersect the point sees nothing of it.
  const scout = await delegated.recruit('scout', 'Outside the group', selection);
  await paused(scout.runId);
  assert.deepEqual(Object.keys((await swarm.view({ participantId: 'scout' })).couplings), []);
});

// ── 6. a spent key names its remedy ─────────────────────────────────────────────────────────────

test('a retry under the same idempotencyKey names the remedy: a NEW attempt needs a NEW key', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-coupling-retry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  let failures = 1;
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers, pausedTurns: () => [],
      guideParticipant: async () => {
        if (failures > 0) { failures -= 1; throw Object.assign(new Error('the lane was unavailable'), { code: 'lane_unavailable' }); }
        return { ok: true };
      },
    },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  await runtime.command('swarm.create', { purpose: 'retry', swarmId: 'sw-1', idempotencyKey: 'create' }, owner);
  await runtime.command('swarm.recruit', { swarmId: 'sw-1', participantId: 'builder', objective: 'build', idempotencyKey: 'recruit' }, owner);
  const guide = { swarmId: 'sw-1', participantId: 'builder', message: 'continue', idempotencyKey: 'guide-1' };
  await assert.rejects(runtime.command('swarm.guide', guide, owner), { code: 'lane_unavailable' });
  // The guide lane is not replay-safe: the SAME key refuses, and the refusal names the remedy.
  await assert.rejects(runtime.command('swarm.guide', guide, owner),
    (error) => error.code === 'swarm_operation_unconfirmed'
      && /NEW idempotencyKey/u.test(error.message)
      && /swarm\.recruit and swarm\.holder_released/u.test(error.message),
    'the refusal says what replays and that a new attempt needs a new key');
  // A NEW key is the remedy the refusal named.
  const delivered = await runtime.command('swarm.guide', { ...guide, idempotencyKey: 'guide-2' }, owner);
  assert.equal(delivered.result.ok, true);
});

// ── 8. the guidance names commands that exist ───────────────────────────────────────────────────

test('the native guidance names only commands that exist', () => {
  // Every `swarm.…` token the guidance teaches is a registered command or a registered update
  // event: the guidance shipped to every native participant must not name a verb that is not.
  const known = new Set([...SWARM_COMMAND_NAMES, ...SWARM_EVENT_KINDS, ...SWARM_FOLD_EVENT_KINDS]);
  for (const name of SWARM_NATIVE_GUIDANCE.match(/\bswarm\.[a-z_]+/gu) ?? []) {
    assert.ok(known.has(name), `${name} is a registered command or event kind`);
  }
  assert.doesNotMatch(SWARM_NATIVE_GUIDANCE, /\binspect\b/u,
    'the guidance never points at a verb the command registry does not carry');
  assert.match(SWARM_NATIVE_GUIDANCE, /shown by swarm\.view/u);
  assert.match(SWARM_NATIVE_GUIDANCE, /a NEW attempt needs a NEW key/u,
    'the guidance tells the same retry truth the bridge help does');
});
