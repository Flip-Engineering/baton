// Issue #443 — a seat killed by `provider_quota_exhausted` must not only die visibly (#442): the
// swarm carries its work to another route. Observed 2026-09-18: six GLM seats died at once when the
// zai 5-hour window closed, each left a snapshot commit (#428) and a checkpoint (#305), and the only
// way back was the root typing `swarm recruit --resume-from` by hand and copying the diff — nothing
// proposed a route, and two more seats were recruited onto the exhausted route minutes later.
//
// The repair, pinned here:
//   (a) a re-route DECISION row, not a silent spawn — `swarm.reroute_proposed {participantId,
//       workerId, from, code, resetAt, candidates, carry}` recorded at the fault observation, with
//       candidates ranked by the SAME comparison a recruit performs (#341/#429), each saying why it
//       ranked, and the row waking the root under the new closed wake class `reroute_proposed`;
//   (b) the per-swarm policy `rerouteOnProviderFault: manual | auto` — `manual` (the default) stops
//       at the proposal, `auto` performs the resume itself onto the first candidate through the
//       SAME recruit path the root uses (#385's `workspace.carried_from`, #337's parked guidance),
//       recording `swarm.rerouted {from, to, successor, carriedFrom, proposalSeq}`; the successor's
//       brief carries `## Re-routed`;
//   (c) subscription awareness: a route whose window is closed is excluded and named with its
//       reason, and an open subscription route ranks above a per-token API route;
//   (d) no candidate at all: `candidates: []` plus the `reroute_no_candidate` attention row;
//   (e) replay parity: the new rows are durable fold state a later incarnation reads identically,
//       and none of them is caller-submittable.
//
// Hermetic: a temp dir, a real CoordinationStore, and a coordinator stub that stands in for the
// deployment's own death seam (`providerFaultDeathFor` — the #442 observation) and its checkout
// registry. No provider process, no git, no `git stash`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SWARM_EVENT_KINDS, foldSwarmEvent, swarmSnapshot } from '../src/swarm-state.mjs';
import { deriveWakeFrame, parseWakeFilter, wakeClassFor, wakeMatches } from '../src/wake-stream.mjs';

// The route the six GLM seats died on (#442's own fault), and the served routes a re-route may
// choose between: an open subscription route, a per-token API route, and a subscription route whose
// own 5-hour window is closed.
const FAULTED = Object.freeze({ harness: 'zai', model: 'glm-5.3-flash', effort: 'low' });
const OPEN_SUBSCRIPTION = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'low' });
const OPEN_API = Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'low' });
const CLOSED_SUBSCRIPTION = Object.freeze({ harness: 'muse', model: 'muse-spark-1.3-contributor', effort: 'low' });

const RESET_AT = '2026-09-18T18:07:32.000Z';
const SNAPSHOT_SHA = 'b'.repeat(40);
const WORKSPACE_ID = `ws-${'a'.repeat(32)}`;
const BASE_SHA = 'c'.repeat(40);
const SWARM = 'route-swarm';

const label = (route) => `${route.harness}/${route.model}@${route.effort}`;

/** One usage row exactly as the deployment's own derivation publishes it (#341 part 3 / #429):
 * `profile` is the route's measured row, and its `priceReason` is the ONLY place the route's
 * billing basis is published on this row ('subscription' with no price, or null with a price). */
function usageRow(route, {
  state = 'ready', code = null, resetAt = null, billing = 'subscription',
  turns = 0, ceiling = 4, inUse = 0, degraded = null, intelligence = 40,
} = {}) {
  return Object.freeze({
    route: Object.freeze({ ...route }),
    profile: Object.freeze({
      slug: route.model, intelligence, coding: intelligence, tps: 60, ttftS: 1,
      price: billing === 'api' ? Object.freeze({ input: 0.2, output: 0.8 }) : null,
      priceReason: billing === 'api' ? null : 'subscription',
      measuredAt: '2026-09-18T00:00:00.000Z', design: null, designReason: null,
    }),
    state, code, resetAt,
    usage: Object.freeze({ turns, tokens: 0, usd: 0 }),
    concurrency: Object.freeze({ ceiling, inUse }),
    lastProviderRefusal: null,
    credential: null,
    quota: Object.freeze(code === PROVIDER_FAULT_CODES.quota || degraded !== null
      ? { state: 'exhausted', resetAt }
      : { state: 'ok', resetAt: null }),
    degraded,
  });
}

const faultedRouteRow = () => usageRow(FAULTED, {
  state: 'degraded', code: PROVIDER_FAULT_CODES.quota, resetAt: RESET_AT, billing: 'subscription',
  degraded: Object.freeze({
    route: Object.freeze({ ...FAULTED }), faultClass: PROVIDER_FAULT_CODES.quota,
    since: '2026-09-18T17:59:00.000Z', resetAt: RESET_AT, resetAtText: RESET_AT,
    participants: Object.freeze(['w-2']), count: 1,
    next: Object.freeze({ action: 'pause_recruits_until_probe', route: Object.freeze({ ...FAULTED }) }),
  }),
});
const closedSubscriptionRow = () => usageRow(CLOSED_SUBSCRIPTION, {
  state: 'blocked', code: PROVIDER_FAULT_CODES.quota, resetAt: RESET_AT, billing: 'subscription',
});
const openSubscriptionRow = () => usageRow(OPEN_SUBSCRIPTION, { billing: 'subscription', turns: 2 });
const openApiRow = () => usageRow(OPEN_API, { billing: 'api', turns: 1, intelligence: 55 });

/** The death the coordinator's own seam recorded (#442): the typed fault, the exact route, the
 * provider's reset answer and the checkpoint the stop preserved. */
function deathRow(workerId, seq) {
  return Object.freeze({
    workerId, taskId: 't-2', runId: 'run-alpha', seq, at: '2026-09-18T17:59:30.000Z',
    code: PROVIDER_FAULT_CODES.quota, route: Object.freeze({ ...FAULTED }),
    resetAt: RESET_AT, resetAtText: RESET_AT, snapshotSha: SNAPSHOT_SHA, retainedWorktree: null,
  });
}
/** ONE swarm runtime over a real store, with a coordinator that answers the two facts the
 * deployment's own seams publish: the provider-fault death of a bound worker, and the checkout a
 * seat is attached to. */
function world(t, { rows, label: tag = 'w' }) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue443-${tag}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.baton', 'wt', WORKSPACE_ID), { recursive: true });
  const store = new CoordinationStore(join(dir, 'store'));
  const workers = [];
  const attachments = new Map();
  const deaths = new Map();
  const starts = [];
  const sessionContext = (workspaceId) => Object.freeze({
    repoRoot: repo, worktree: join(repo, '.baton', 'wt', workspaceId), baseSha: BASE_SHA, branch: 'master',
  });
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    workspaceAttachment: (workerId) => attachments.get(workerId) ?? null,
    predecessorWorkspaceContext: (workspaceId) => ({ sessionContext: sessionContext(workspaceId), holders: [] }),
    providerFaultDeathFor: (workerId) => deaths.get(workerId) ?? null,
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: rows }),
    situationGit: { repoRoot: repo, head: () => null, commitsSince: () => [] },
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      starts.push(request);
      const index = workers.length + 1;
      const id = `w-${index}`;
      workers.push({ id, taskId: `t-${index}`, runId: request.runId, status: 'working', paused: false });
      // The deployment's own checkout: the seat the fixture starts in the workspace this file
      // lays down, and any seat that shares it (#385's same-checkout carry).
      const workspaceId = request.workspace?.workspaceId ?? WORKSPACE_ID;
      attachments.set(id, { workspaceId, sessionContext: sessionContext(workspaceId), holderCount: 1 });
    },
  });
  let keys = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(command === 'view' ? {} : { idempotencyKey: `${tag}-${command}-${++keys}` }), ...args,
  }, { actor: 'owner', principalId: 'owner' });
  return { store, runtime, call, workers, attachments, deaths, starts, repo };
}

/** One swarm holding a faulted seat: `base` holds the checkout, `alpha` works in it (the same
 * physical workspace), and alpha's provider then kills its worker. */
async function faultedSwarm(t, { rows, policy = null, tag = 'w' } = {}) {
  const w = world(t, { rows, label: tag });
  await w.call('create', { swarmId: SWARM, purpose: 'Re-route after a provider fault' });
  // The policy is declared the ONE way a swarm-level policy is declared (#443): a policy row on
  // the swarm, before any death.
  if (policy !== null) {
    await w.call('update', { swarmId: SWARM, event: 'swarm.policy_updated', payload: { ...policy } });
  }
  await w.call('recruit', { swarmId: SWARM, participantId: 'base', objective: 'hold the checkout' });
  await w.call('recruit', {
    swarmId: SWARM, participantId: 'alpha', objective: 'work alpha', shareWorkspaceWith: 'base',
  });
  const bound = w.store.swarm(SWARM).participants.alpha;
  const workerId = bound.bindings.at(-1).workerId;
  const worker = w.workers.find((row) => row.id === workerId);
  worker.status = 'dead';
  w.deaths.set(workerId, deathRow(workerId, 41));
  return { ...w, workerId };
}

const rowsOf = (store, kind) => store.eventsView().filter((event) => event.kind === kind);
const participantRow = (view, participantId) =>
  view.participants.find((row) => row.participantId === participantId) ?? null;

// ── (a) the decision row, its candidates, and the wake it raises ────────────────────────────────

test('443-a1: a provider-fault death records ONE reroute_proposed row naming the ranked candidates, and the view projects it', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), openApiRow()], tag: 'a1',
  });
  const view = await w.call('view', { swarmId: SWARM });

  const rows = rowsOf(w.store, 'swarm.reroute_proposed');
  assert.equal(rows.length, 1, 'exactly one proposal per provider-fault death');
  const proposal = rows[0].payload;
  assert.equal(proposal.participantId, 'alpha');
  assert.equal(proposal.workerId, w.workerId);
  assert.deepEqual({ ...proposal.from }, { ...FAULTED }, 'the route it came from');
  assert.equal(proposal.code, PROVIDER_FAULT_CODES.quota);
  assert.equal(proposal.resetAt, RESET_AT);
  assert.equal(proposal.carry.snapshotSha, SNAPSHOT_SHA, 'the snapshot the death preserved rides the carry');
  assert.ok(Array.isArray(proposal.candidates), 'the decision names its candidates');

  // The candidates are the READY routes, ranked by the comparison a recruit performs — and a
  // subscription route with headroom outranks a per-token API route (#429's billing basis).
  assert.deepEqual(proposal.candidates.map((row) => label(row)), [label(OPEN_SUBSCRIPTION), label(OPEN_API)],
    'the open subscription route ranks above the API route');
  assert.deepEqual(proposal.candidates.map((row) => row.reason),
    ['subscription_headroom', 'api_fallback'], 'each candidate says why it ranked');
  assert.deepEqual(proposal.candidates.map((row) => row.billing), ['subscription', 'api']);
  assert.deepEqual(proposal.candidates.map((row) => row.profile.intelligence), [40, 55],
    'the measured profile the comparison ordered on rides the candidate row');
  for (const row of proposal.candidates) {
    assert.equal(row.state, 'ready', 'only a ready route is a candidate');
  }
  const faulted = proposal.candidates.find((row) => label(row) === label(FAULTED));
  assert.equal(faulted, undefined, 'the route the seat died on is never a candidate');

  // The participant row carries the proposal the way #442 made the fault ride it.
  const alpha = participantRow(view, 'alpha');
  assert.equal(alpha.reroute.proposedAt, rows[0].ts);
  assert.deepEqual(alpha.reroute.candidates.map((row) => label(row)),
    [label(OPEN_SUBSCRIPTION), label(OPEN_API)]);
  assert.equal(alpha.reroute.decision, null, 'a manual swarm stops at the proposal');
  assert.equal(alpha.reroute.policy, 'manual');

  // The attention projection names the act, not only the fault.
  const attention = view.attention.filter((row) => row.kind === 'reroute_proposed');
  assert.equal(attention.length, 1, 'the proposal pages the swarm once');
  assert.equal(attention[0].participantId, 'alpha');
  assert.deepEqual({ ...attention[0].next }, {
    command: 'swarm.recruit', swarmId: SWARM, resumeFrom: 'alpha',
    options: { exact: { ...OPEN_SUBSCRIPTION } },
  }, 'the row names the exact recruit that answers it');
});

test('443-a2: the proposal wakes the new closed wake class, and carries no roll-forward without a policy', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), openApiRow()], tag: 'a2',
  });
  const startedBefore = w.starts.length;
  await w.call('view', { swarmId: SWARM });

  const row = rowsOf(w.store, 'swarm.reroute_proposed')[0];
  assert.equal(wakeClassFor(row)?.wakeClass, 'reroute_proposed', 'the proposal derives its own wake class');
  const frame = deriveWakeFrame(row, new Map(), null);
  assert.equal(frame.wakeClass, 'reroute_proposed');
  assert.equal(frame.swarmId, SWARM);
  assert.equal(frame.participantId, 'alpha', 'the frame names the seat whose work must move');
  assert.equal(wakeMatches(frame, parseWakeFilter({ kinds: ['reroute_proposed'] })), true,
    'a bounded watch filtered to the class admits it');
  assert.equal(wakeMatches(frame, parseWakeFilter({ kinds: ['dead'] })), false,
    'and the class is its own, never a second name for dead');

  // `manual` is the default: the policy says nothing, so NO successor is spawned by the runtime.
  const view = await w.call('view', { swarmId: SWARM });
  assert.equal(w.starts.length, startedBefore, 'a manual swarm never spawns on its own');
  assert.deepEqual(view.policy,
    { rerouteOnProviderFault: 'manual', reroutePreferApi: false, resumeContinuation: 'auto' },
    'the view renders the policy with its defaults resolved');

  // The policy is a closed vocabulary, enforced in the lane that knows best: the contract refuses
  // an unknown payload FIELD before any effect (naming the fields the kind has), and the fold
  // refuses a value outside the closed set. Neither lands in the durable record.
  await assert.rejects(
    w.call('update', {
      swarmId: SWARM, event: 'swarm.policy_updated', payload: { rerouteOnFault: 'auto' },
    }),
    (error) => {
      assert.equal(error.code, 'swarm_command_invalid');
      assert.ok(String(error.message).includes('rerouteOnFault'), 'the refusal names the field');
      assert.ok(String(error.message).includes('rerouteOnProviderFault'), 'and the fields it has');
      return true;
    },
    'an unknown policy field never reaches the fold',
  );
  for (const payload of [{ rerouteOnProviderFault: 'sometimes' }, { reroutePreferApi: 'yes' }, {}]) {
    await assert.rejects(
      w.call('update', { swarmId: SWARM, event: 'swarm.policy_updated', payload }),
      (error) => error.code === 'invalid_payload',
      `a policy row refuses: ${JSON.stringify(payload)}`,
    );
  }
  assert.equal(rowsOf(w.store, 'swarm.policy_updated').length, 0,
    'and a refused policy leaves the swarm exactly as it was');
});

// ── (b) the policy, and the auto resume through the same recruit path ───────────────────────────

test('443-b1: `auto` performs the resume onto the first candidate, carrying the workspace and the why', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), openApiRow()],
    policy: { rerouteOnProviderFault: 'auto', resumeContinuation: 'auto' }, tag: 'b1',
  });
  const policies = rowsOf(w.store, 'swarm.policy_updated');
  assert.equal(policies.length, 1, 'the swarm-level policy is one recorded row');
  assert.equal(policies[0].payload.rerouteOnProviderFault, 'auto');

  const view = await w.call('view', { swarmId: SWARM });

  const rerouted = rowsOf(w.store, 'swarm.rerouted');
  assert.equal(rerouted.length, 1, 'ONE re-route row per performed resume');
  const successorId = rerouted[0].payload.successor;
  assert.equal(rerouted[0].payload.carriedFrom, 'alpha');
  assert.equal(rerouted[0].payload.proposalSeq, rowsOf(w.store, 'swarm.reroute_proposed')[0].seq,
    'the row names the proposal it answers');
  assert.deepEqual({ ...rerouted[0].payload.from }, { ...FAULTED });
  assert.deepEqual({ ...rerouted[0].payload.to }, { ...OPEN_SUBSCRIPTION },
    'the successor went onto the first candidate');

  const successor = participantRow(view, successorId);
  assert.ok(successor, 'the successor is a member of the swarm');
  assert.deepEqual({ ...successor.route }, { ...OPEN_SUBSCRIPTION },
    'and it was admitted on the candidate route, exactly');
  assert.equal(successor.resumeFrom, 'alpha');
  assert.equal(w.store.swarm(SWARM).participants.alpha.reroute.decision.policy, 'auto');
  assert.equal(w.store.swarm(SWARM).participants.alpha.reroute.decision.successor, successorId);
  assert.equal(rowsOf(w.store, 'swarm.reroute_proposed').length, 1,
    'the performed resume records no second proposal');

  // #385: the successor inherited the predecessor's checkout, recorded as the ONE carry row.
  const carried = rowsOf(w.store, 'workspace.carried_from');
  assert.equal(carried.length, 1, 'the workspace carry is recorded for the successor');
  assert.equal(carried[0].payload.participantId, successorId);
  assert.equal(carried[0].payload.predecessor, 'alpha');
  assert.equal(carried[0].payload.workspaceId, WORKSPACE_ID);
  const successorStart = w.starts.at(-1);
  assert.equal(successorStart.workspace.workspaceId, WORKSPACE_ID,
    'and the run really started in the predecessor’s checkout');

  // The successor's brief says WHY it exists — one derivation with #385's inheritance section.
  const brief = w.store.swarm(SWARM).participants[successorId].brief;
  assert.ok(brief.includes('## Re-routed'), 'the brief carries the re-route section');
  const section = brief.slice(brief.indexOf('## Re-routed')).split('\n\n## ')[0];
  assert.ok(section.includes('alpha'), 'the section names the seat it continues');
  assert.ok(section.includes(PROVIDER_FAULT_CODES.quota), 'the fault that ended it');
  assert.ok(section.includes(label(FAULTED)), 'the route it came from');
  assert.ok(section.includes(label(OPEN_SUBSCRIPTION)), 'and the route it moved to');
  assert.ok(brief.includes('## Inheritance from alpha'), '#385’s section is still the one derivation');
});

test('443-b2: a hand-typed resume of a faulted seat still says why the successor exists', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), openApiRow()], tag: 'b2',
  });
  await w.call('view', { swarmId: SWARM });
  assert.deepEqual(rowsOf(w.store, 'swarm.rerouted'), [],
    'a manual swarm performs nothing, so the root answers the proposal itself');

  // The root answers it by hand, on the SECOND candidate — the brief must name THAT route, not the
  // candidate the decision ranked first.
  await w.call('recruit', {
    swarmId: SWARM, participantId: 'beta', objective: 'continue alpha', resumeFrom: 'alpha',
    options: { exact: { ...OPEN_API } },
  });
  // #525: the hand-typed resume lands the continuation question; the answer starts the seat and
  // its brief is composed then.
  const brief = w.store.swarm(SWARM).participants.beta.brief;
  const section = brief.slice(brief.indexOf('## Re-routed')).split('\n\n## ')[0];
  assert.ok(section.includes(PROVIDER_FAULT_CODES.quota), 'the fault that ended the predecessor');
  assert.ok(section.includes(label(FAULTED)), 'the route it came from');
  assert.ok(section.includes(label(OPEN_API)), 'the route this recruit named for it');
  assert.equal(section.includes('Re-routed onto'), false,
    'and it never claims the runtime performed a resume a human made');
  assert.ok(section.includes('Carried workspace'), 'what was carried');
  assert.ok(section.includes('Last checkpoint'), "and the predecessor's checkpoint line");
  assert.ok(brief.includes('## Inheritance from alpha'));
});

test('443-b3: an auto-rerouted successor starts under the default continuation policy', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), openApiRow()],
    policy: { rerouteOnProviderFault: 'auto' }, tag: 'b3',
  });
  await w.call('view', { swarmId: SWARM });
  const successorId = rowsOf(w.store, 'swarm.rerouted')[0]?.payload.successor;
  const successor = w.store.swarm(SWARM).participants[successorId];
  assert.equal(successor.status, 'active');
  assert.equal(successor.bindings.length, 1);
  assert.equal(w.starts.length, 3);
  assert.equal(rowsOf(w.store, 'swarm.resume_decision_requested').length, 0);
  assert.deepEqual({ ...successor.route }, { ...OPEN_SUBSCRIPTION });
});

// ── (c) subscription awareness: a closed window is named, never silently dropped ────────────────

test('443-c1: a subscription route whose window is closed is excluded, with its reason and reset', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), closedSubscriptionRow()], tag: 'c1',
  });
  const view = await w.call('view', { swarmId: SWARM });
  const proposal = rowsOf(w.store, 'swarm.reroute_proposed')[0].payload;

  assert.deepEqual(proposal.candidates.map((row) => label(row)), [label(OPEN_SUBSCRIPTION)],
    'a route whose window is closed is no candidate');
  const excluded = proposal.excluded.find((row) => label(row) === label(CLOSED_SUBSCRIPTION));
  assert.ok(excluded, 'the closed route is named in the excluded rows');
  assert.equal(excluded.reason, 'excluded_window_closed');
  assert.equal(excluded.billing, 'subscription');
  assert.equal(excluded.resetAt, RESET_AT, 'with the instant its provider said it comes back');
  assert.equal(participantRow(view, 'alpha').reroute.excluded.length, 1,
    'and the view projects the same rows');

  // A subscription route with headroom still outranks the API route even with a closed sibling.
  assert.equal(proposal.candidates[0].reason, 'subscription_headroom');
});

test('443-c2: preferApi flips the billing preference, and never re-orders the closed route in', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), openApiRow(), closedSubscriptionRow()],
    policy: { rerouteOnProviderFault: 'manual', reroutePreferApi: true }, tag: 'c2',
  });
  await w.call('view', { swarmId: SWARM });
  const proposal = rowsOf(w.store, 'swarm.reroute_proposed')[0].payload;
  assert.deepEqual(proposal.candidates.map((row) => label(row)), [label(OPEN_API), label(OPEN_SUBSCRIPTION)],
    'the policy that names preferApi ranks the per-token route first');
  assert.deepEqual(proposal.candidates.map((row) => row.reason), ['api_fallback', 'subscription_headroom'],
    'and each row still says what it is');
  assert.equal(proposal.excluded.length, 1, 'the closed window is still excluded');
});

// ── (d) no candidate: the empty decision, and the attention row that says what to do ────────────

test('443-d1: with no candidate the proposal is empty and the attention row names the wait', async (t) => {
  const w = await faultedSwarm(t, { rows: [faultedRouteRow(), closedSubscriptionRow()], tag: 'd1' });
  const view = await w.call('view', { swarmId: SWARM });
  const proposal = rowsOf(w.store, 'swarm.reroute_proposed')[0].payload;
  assert.deepEqual(proposal.candidates, [], 'nothing to bind is an empty decision, never a guess');
  assert.equal(proposal.excluded.length, 1);

  const attention = view.attention.filter((row) => row.kind === 'reroute_no_candidate');
  assert.equal(attention.length, 1, 'the wait pages once');
  assert.equal(attention[0].participantId, 'alpha');
  assert.equal(attention[0].resetAt, RESET_AT);
  assert.equal(attention[0].next, `wait until ${RESET_AT} or add a route`);
  assert.deepEqual(view.attention.filter((row) => row.kind === 'reroute_proposed'), [],
    'a proposal with no candidate is not also reported as one');
});

// ── (e) replay parity, and the runtime-recorded kinds stay unsubmittable ────────────────────────

test('443-e1: the new rows replay identically and no caller can submit one', async (t) => {
  const w = await faultedSwarm(t, {
    rows: [faultedRouteRow(), openSubscriptionRow(), openApiRow()],
    policy: { rerouteOnProviderFault: 'auto' }, tag: 'e1',
  });
  await w.call('view', { swarmId: SWARM });
  const proposal = rowsOf(w.store, 'swarm.reroute_proposed')[0].payload;
  const rerouted = rowsOf(w.store, 'swarm.rerouted')[0].payload;

  // A replay of the ledger from an empty projection through the same fold the store replays with
  // carries both readings: they are durable state, not this runtime's memory.
  const swarms = new Map();
  for (const event of w.store.eventsView()) {
    if (SWARM_EVENT_KINDS.has(event.kind)) foldSwarmEvent(swarms, event);
  }
  const replayed = swarmSnapshot(swarms).swarms[0];
  const proposalRow = rowsOf(w.store, 'swarm.reroute_proposed')[0];
  assert.equal(replayed.participants.alpha.reroute.proposedAt, proposalRow.ts);
  assert.equal(replayed.participants.alpha.reroute.candidates.length, 2);
  assert.deepEqual({ ...replayed.participants.alpha.reroute.from }, { ...FAULTED });
  assert.equal(replayed.participants.alpha.reroute.code, PROVIDER_FAULT_CODES.quota);
  assert.equal(replayed.participants.alpha.reroute.decision.successor, rerouted.successor);
  assert.equal(replayed.participants.alpha.reroute.decision.proposalSeq, proposalRow.seq);
  // The fold is deterministic: the same ledger, folded again, reads the same rows.
  const again = new Map();
  for (const event of w.store.eventsView()) {
    if (SWARM_EVENT_KINDS.has(event.kind)) foldSwarmEvent(again, event);
  }
  assert.deepEqual(swarmSnapshot(again).swarms[0].participants.alpha.reroute,
    replayed.participants.alpha.reroute);

  // A SECOND incarnation over the same store mints nothing twice (#443's own replay parity).
  const second = new SwarmRuntime({
    store: w.store, coordinator: w.runtime.coordinator, authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: [] }),
    situationGit: { repoRoot: w.repo, head: () => null, commitsSince: () => [] },
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async () => {},
  });
  await second.command('swarm.view', { swarmId: SWARM }, { actor: 'owner', principalId: 'owner' });
  assert.equal(rowsOf(w.store, 'swarm.reroute_proposed').length, 1, 'a later incarnation mints no second proposal');
  assert.equal(rowsOf(w.store, 'swarm.rerouted').length, 1, 'and performs no second resume');

  // Both rows are the runtime's own record, never caller-submittable (the #425/#364/#442 pattern).
  for (const event of ['swarm.reroute_proposed', 'swarm.rerouted']) {
    await assert.rejects(w.call('update', {
      swarmId: SWARM, event,
      payload: { swarmId: SWARM, participantId: 'alpha', workerId: w.workerId, code: PROVIDER_FAULT_CODES.quota,
        from: { ...FAULTED }, candidates: [], excluded: [], carry: { snapshotSha: null, checkpoint: null },
        successor: 'x', carriedFrom: 'alpha', to: { ...OPEN_API }, proposalSeq: 1 },
    }), (error) => {
      assert.equal(error.detail?.field, 'event');
      assert.equal(String(error.detail?.admitted ?? '').includes(event), false,
        'and the admitted set does not contain the runtime-recorded kind');
      return true;
    });
  }
});
