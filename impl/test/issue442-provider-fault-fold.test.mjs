// Issue #442 — a provider-quota kill of a seat left NO swarm row and NO wake. Observed
// 2026-09-18 07:20–07:30Z on both residents: the zai GLM 5-hour window closed, six seats ended a
// turn with `lifecycle.turn_completed status=failed failure.code=provider_quota_exhausted`
// ("429 Usage limit reached for 5 hour ... reset at 2026-09-18 18:07:32", detail.resetAt), each
// drew `kill.requested {rule: provider_fault}`, the worker half settled correctly — and the swarm
// half learned nothing: `swarm.view --projection participants` still read `status: active` twenty
// minutes later, no wake row followed any kill, two more seats were recruited onto the exhausted
// route 4–10 minutes later and died in 20 s, and the recorded reset instant was hours off (the
// provider's zone-less wall-clock was read as UTC).
//
// The repair, pinned here:
//   (a) ONE fold — `swarm.participant_faulted {participantId, workerId, code, route, resetAt,
//       resetAtText, snapshotSha}` recorded from the coordinator's own death seam, the #350
//       membership settle beside it (status left, leftReason provider_fault), the typed fault on
//       the participant row, and a `provider_fault` attention row naming the next act;
//   (b) the wake: the fault row derives the `dead` wake class, so the bounded watch returns on it
//       instead of timing out across the death;
//   (c) route truth: the fault's episode takes the route down with its reason and the provider's
//       own reset instant, a recruit on it refuses pre-effect naming that instant, and a passed
//       instant retires the episode by derivation;
//   (d) reset honesty: a zone-qualified answer parses, a zone-less one keeps its text and derives
//       no instant — never a UTC reading nobody stated;
//   (e) replay parity: the row is durable fold state a later incarnation reads identically, and it
//       is never caller-submittable.
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, real git checkouts, no provider
// process. `git stash` is never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAdapter, createBrief, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { PROVIDER_FAULT_CODES, classifyProviderFault, parseProviderResetAt } from '../src/provider-faults.mjs';
// The #442 export is reached through the namespace on purpose: this file must LOAD against the
// commit it pins, so every row fails on its own assertion instead of the module failing to link.
import * as providerFaults from '../src/provider-faults.mjs';
import { renderRouteUsageLines } from '../src/adapter.mjs';
import { Log } from '../src/log.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SWARM_EVENT_KINDS, foldSwarmEvent, swarmSnapshot } from '../src/swarm-state.mjs';
import { deriveWakeFrame, parseWakeFilter, wakeClassFor, wakeMatches } from '../src/wake-stream.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
/** The instant the zai answer names, ZONE-QUALIFIED — the one spelling this deployment parses. */
const RESET_AT = '2026-09-18T18:07:32.000Z';
/** The same instant as the provider actually spelled it: no zone, so no instant may be derived. */
const ZONE_LESS_RESET = '2026-09-18 18:07:32';
const quotaText = (reset) => `429 Usage limit reached for 5 hour. Your limit will reset at ${reset} (type=1308)`;

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function tmpDir(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue442-${label}-`));
  dirs.push(root);
  return root;
}

function world(label) {
  const root = tmpDir(label);
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue442@example.invalid', GIT_COMMITTER_EMAIL: 'issue442@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'issue442', GIT_COMMITTER_NAME: 'issue442' });
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  const logDir = join(root, 'deployment');
  mkdirSync(logDir, { recursive: true });
  return { root, repo, logDir };
}

const owner = Object.freeze({ actor: 'owner', principalId: 'owner' });
const seatBrief = (label) => createBrief({
  goal: label, constraints: [], pathScope: ['**'], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0, timeoutMs: 2_000 },
  budget: { tokens: 1_000, usd: 1, wallMin: 1 },
});

/** The provider boundary's own typing, verbatim: a typed fault whose detail is exactly what
 * `classifyProviderFault` mints — the class, the exact route, and the reset pair (#295 + #442). */
function faultFor(text, route = ROUTE) {
  const fault = classifyProviderFault({ code: '429', errorMessage: text }, { route });
  assert.equal(fault.code, PROVIDER_FAULT_CODES.quota, 'the boundary types the answer as quota');
  return { code: fault.code, message: text, detail: fault.detail };
}

/** A MockAdapter that can answer its worker's turn with a provider fault — the failed turn the
 * adapter's own boundary emits before the coordinator's policy kill (#295). */
class FaultableAdapter extends MockAdapter {
  answerFault(worker, failure) {
    const session = this._sessions.get(worker);
    assert.ok(session, `worker ${worker} holds a live session`);
    this._emit(session, 'lifecycle.turn_completed', {
      status: 'failed', progress: 1, summary: 'the provider refused the turn',
      artifacts: { commits: [], files: [] },
      verification: { command: 'true', claimedExit: 1 },
      openQuestions: [], budgetUsed: { tokens: 1, usd: 0 }, failure,
    });
  }
}

/** ONE swarm runtime over a REAL driver (the `_swarmRuntime` wiring in application.mjs), whose
 * seats are spawned through the coordinator itself — so the death this file observes is the one
 * the coordinator really recorded and settled, never a hand-built projection. */
function swarmWorld(f, { label = 'w' } = {}) {
  const adapter = new FaultableAdapter({
    harness: 'mock',
    // The seat's turn stays open (the scenario's own pacing seam), so the provider's answer is what
    // ends it — exactly as a real harness holds a turn open until its provider refuses.
    scenario: { outcome: 'completed', turnDelayMs: 60_000, edits: [] },
  });
  const driver = createDriver({
    repoRoot: f.repo, repoId: 'issue442-repo', logDir: f.logDir, adapters: { mock: adapter },
  });
  const runtime = new SwarmRuntime({
    store: driver.coordination,
    coordinator: driver.coordinator,
    authorize: async () => {},
    prepareRun: async () => ({}),
    lastCrash: () => null,
    startRun: async (request) => {
      const handle = await driver.coordinator.spawn('mock', seatBrief(request.participantId), {
        taskId: request.runId, runId: request.runId,
      });
      return { runId: request.runId, workerId: handle.id };
    },
  });
  let keys = 0;
  // Only a mutation takes an idempotency key: the read verbs (view, watch) admit none.
  const MUTATIONS = new Set(['create', 'update', 'recruit', 'stop', 'guide', 'capture', 'check']);
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, {
    ...(MUTATIONS.has(command) ? { idempotencyKey: `${label}-${command}-${++keys}` } : {}),
    ...args,
  }, owner);
  return { driver, adapter, runtime, call };
}

const close = async (row) => {
  try { await row.driver.drainAndClose('issue442:test'); }
  catch { try { row.driver.coordination.releaseWriterLease(); } catch { /* best effort */ } }
};

const faultRows = (driver) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'swarm.participant_faulted');
const leftRows = (driver) => driver.coordination.eventsView()
  .filter((event) => event.kind === 'swarm.participant_left');
const participantRow = (view, participantId) =>
  view.participants.find((row) => row.participantId === participantId) ?? null;

/** The death is settled when the coordinator's own handle says so: the typed provider failure is
 * on its terminal cause and it is no longer live. Read from the pre-existing worker row — never
 * from the seam this file pins — so a run at HEAD reaches its own row assertions. */
async function untilSettled(driver, workerId) {
  const live = ['pending', 'working', 'blocked', 'idle', 'stopping'];
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const worker = driver.coordinator.list().find((row) => row.id === workerId);
    if (worker && worker.terminalCause?.kind === 'provider_failure' && !live.includes(worker.status)) {
      return worker;
    }
    await driver.coordinator.wait(10);
  }
  throw new Error(`worker ${workerId} never settled under its provider fault`);
}

/** One seat, one provider answer, one policy kill — the observed 2026-09-18 sequence. */
async function faultedSeat(f, { label, text = quotaText(RESET_AT) } = {}) {
  const row = swarmWorld(f, { label });
  await row.call('create', { swarmId: 'sw', purpose: 'Provider fault truth' });
  await row.call('recruit', { swarmId: 'sw', participantId: 'alpha', objective: 'work alpha' });
  const bound = row.driver.coordination.swarm('sw').participants.alpha;
  const workerId = bound.bindings.at(-1).workerId;
  row.adapter.answerFault(workerId, faultFor(text));
  await untilSettled(row.driver, workerId);
  return { ...row, workerId };
}

test('442-a1: a provider-fault kill folds ONE fault row, settles the seat, and pages the fault', async (t) => {
  const f = world('a1');
  const seat = await faultedSeat(f, { label: 'a1' });
  t.after(() => close(seat));
  // The coordinator's own death seam knows the whole fault, and it is where this runtime reads it
  // from — never a ledger scan of the turn/kill pair (#442 item 1).
  const death = seat.driver.coordinator.providerFaultDeathFor(seat.workerId);
  assert.ok(death, 'the coordinator records the provider-fault death at its own seam');
  assert.equal(death.code, PROVIDER_FAULT_CODES.quota);
  assert.deepEqual({ ...death.route }, { ...ROUTE });
  assert.equal(death.resetAt, RESET_AT);

  // The first runtime entry after the death folds it; the answer carries the result.
  const view = await seat.call('view', { swarmId: 'sw' });

  // (a) ONE row, carrying the typed fault, the exact route and the provider's own reset answer.
  const rows = faultRows(seat.driver);
  assert.equal(rows.length, 1, 'exactly one fault row per provider-fault death');
  assert.equal(rows[0].payload.participantId, 'alpha');
  assert.equal(rows[0].payload.workerId, seat.workerId);
  assert.equal(rows[0].payload.code, PROVIDER_FAULT_CODES.quota);
  assert.deepEqual({ ...rows[0].payload.route }, { ...ROUTE });
  assert.equal(rows[0].payload.resetAt, RESET_AT, 'the zone-qualified instant the provider named');
  assert.equal(rows[0].payload.resetAtText, RESET_AT);
  assert.equal(rows[0].payload.snapshotSha, null, 'this seat preserved no checkpoint, so none is claimed');

  // The #350 settle: the seat stops reading `active` the moment its provider kills it, in the ONE
  // representation a settled membership has (status left + leftReason), never a second status field.
  const leaves = leftRows(seat.driver).filter((event) => event.payload.participantId === 'alpha');
  assert.equal(leaves.length, 1, 'ONE membership settle for the faulted seat');
  assert.equal(leaves[0].payload.reason, 'provider_fault');

  const alpha = participantRow(view, 'alpha');
  assert.equal(alpha.status, 'left', 'the seat is settled, not still active');
  assert.equal(alpha.leftReason, 'provider_fault');
  assert.equal(alpha.runtime.live, false);
  assert.equal(alpha.runtime.state, 'dead', 'a seat whose worker its provider killed reads dead');
  assert.equal(alpha.fault.code, PROVIDER_FAULT_CODES.quota, 'the typed fault rides the participant row');
  assert.deepEqual({ ...alpha.fault.route }, { ...ROUTE });
  assert.equal(alpha.fault.resetAt, RESET_AT);
  assert.equal(alpha.fault.workerId, seat.workerId);
  assert.deepEqual(view.attention.filter((row) => row.kind === 'participant_runtime_dead'), [],
    'the specific fault row replaces the generic dead-runtime row, never both');

  // The attention row the root acts on: the fault, its route and reset, and the next act.
  const attention = view.attention.filter((row) => row.kind === 'provider_fault');
  assert.equal(attention.length, 1, 'the faulted seat pages once');
  assert.equal(attention[0].participantId, 'alpha');
  assert.equal(attention[0].workerId, seat.workerId);
  assert.equal(attention[0].code, PROVIDER_FAULT_CODES.quota);
  assert.deepEqual({ ...attention[0].route }, { ...ROUTE });
  assert.equal(attention[0].resetAt, RESET_AT);
  assert.deepEqual({ ...attention[0].next }, { resume: 'swarm.recruit --resume-from', stop: 'swarm.stop' },
    'the row names both commands that settle the seat');
});

test('442-a2: the fault-settled seat is still resumable — the one recruit continues it', async (t) => {
  const f = world('a2');
  const seat = await faultedSeat(f, { label: 'a2' });
  t.after(() => close(seat));
  // The predecessor IS settled (this is the state the resume must survive), and the settle is what
  // the attention row's `resume` next act has to work from.
  const before = participantRow(await seat.call('view', { swarmId: 'sw' }), 'alpha');
  assert.equal(before.status, 'left', 'the faulted predecessor is settled before the resume');
  assert.equal(before.leftReason, 'provider_fault');
  const recruited = await seat.call('recruit', {
    swarmId: 'sw', participantId: 'beta', objective: "continue alpha's lane", resumeFrom: 'alpha',
  });
  // Issue #572: the resume performs the continuation itself. No question is recorded for an
  // orchestrator to answer, so the recovered seat starts without an external act.
  assert.equal(recruited.resumeDecision ?? null, null,
    'the resume leaves no decision pending');
  const brief = seat.driver.coordination.swarm('sw').participants.beta.brief;
  const situation = brief.split('## Swarm situation')[1] ?? '';
  assert.equal(situation.includes('- alpha'), false,
    'the faulted seat rides into no later recruit brief as a live peer (#350\'s rule)');
  const beta = participantRow(await seat.call('view', { swarmId: 'sw' }), 'beta');
  assert.equal(typeof beta.runtime.workerId === 'string', true, 'the successor bound a worker of its own');
  assert.match(brief, /## Recovery from alpha/, 'and its first brief names the recovery (docs/52 D6)');
});


test('442-b1: the bounded watch returns ON the fault row, and that row derives the dead wake class', async (t) => {
  const f = world('b1');
  const seat = await faultedSeat(f, { label: 'b1' });
  t.after(() => close(seat));

  // Nothing has entered the runtime since the death: the cursor below is taken BEFORE the fault row
  // exists, so the watch that follows is exactly the root's "wait across the kill" leg.
  const cursor = seat.driver.coordination.ledgerHeadSeq();
  assert.equal(faultRows(seat.driver).length, 0, 'no fault row has been folded yet');

  const answer = await seat.call('watch', { swarmId: 'sw', afterSeq: cursor, timeoutMs: 5_000 });
  assert.equal(answer.watch.reason, 'event', 'the watch returns on the fault, never on its deadline');
  const faultSeq = faultRows(seat.driver)[0].seq;
  // Issue #433 (docs/46 §3.1/§3.3): the frame carries EVERY admitted row past afterSeq — the fault
  // row is in it — and `matchedSeq` names the frame's LAST row, the seq a re-arm resumes from.
  assert.ok(answer.watch.events.some((row) => row.seq === faultSeq),
    'and the row it returned on IS in the frame it answered with');
  assert.equal(answer.watch.matchedSeq, answer.watch.events.at(-1).seq,
    'matchedSeq names the last row the frame carried');
  assert.ok(answer.watch.matchedSeq >= faultSeq);
  assert.equal(participantRow(answer, 'alpha').status, 'left',
    'the answer the root reads carries the settled seat');

  // The wake CLASS: the fault row is what a `--wake-class dead` attachment wakes on. It is a
  // failed turn followed by a policy kill, never a crash cert — which is why that class stayed
  // silent through all six GLM kills.
  const row = faultRows(seat.driver)[0];
  assert.equal(wakeClassFor(row)?.wakeClass, 'dead', 'the fault row derives the dead wake class');
  const frame = deriveWakeFrame(row, new Map(), null);
  assert.equal(frame.wakeClass, 'dead');
  assert.equal(frame.swarmId, 'sw');
  assert.equal(frame.participantId, 'alpha');
  assert.equal(frame.subject?.id, seat.workerId, 'the frame names the worker the wake is about');
  assert.equal(wakeMatches(frame, parseWakeFilter({ kinds: ['dead'] })), true,
    'a bounded watch filtered to the dead class admits it');
});

// ── (c)+(d) the deployment half: the route's truth, and the reset answer's honesty ───────────────

const DEGRADED_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const READY_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });

function gitRepo(label) {
  const root = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'master'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue442@example.invalid', GIT_COMMITTER_EMAIL: 'issue442@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 442', GIT_COMMITTER_NAME: 'Issue 442' });
  writeFileSync(join(root, 'README.md'), '# issue 442\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function codexAdapter(routes) {
  const adapter = new MockAdapter({
    harness: 'codex',
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: 4,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: routes[0].model,
      available: [...new Set(routes.map((route) => route.model))], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      serviceTier: null, provenance: 'issue442-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: [] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  return adapter;
}

async function openDeployment(t, label, routes) {
  const repo = gitRepo(`${label}-repo`);
  const root = join(tmpDir(`${label}-owner`), 'deployment');
  let driverOptions = null;
  const adapter = codexAdapter(routes);
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters: { codex: adapter },
      routes,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => { driverOptions = options; return createDriver(options); });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the test */ } });
  return { deployment, log: new Log(driverOptions.logDir), repo };
}

/** The episode the coordinator's death fold lands for a route (#316), as the deployment reads it
 * off the ledger — now carrying the provider's own reset answer (#442 item 2). */
function degradedRow(route, { failure = PROVIDER_FAULT_CODES.quota, at, resetAt = null, resetAtText = null } = {}) {
  const stamp = new Date(at).toISOString();
  return {
    worker: 'w-1', harness: `${route.harness}@1.0.0`, turnEpoch: 1,
    kind: 'provider.degraded', actor: 'policy',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: {
      route: Object.freeze({ ...route }), faultClass: failure,
      participants: Object.freeze(['w-1', 'w-2', 'w-3']),
      window: Object.freeze({ from: stamp, to: stamp }), count: 3,
      next: Object.freeze({ action: 'pause_recruits_until_probe', route: Object.freeze({ ...route }) }),
      resetAt, resetAtText,
    },
  };
}

const usageRowFor = (rows, route) => rows.find((row) => (
  row.route.harness === route.harness && row.route.model === route.model && row.route.effort === route.effort));

/** The runtime half of the route truth: the deployment's OWN rows are what a recruit compares. */
function routeFixture(rows) {
  const store = new CoordinationStore(tmpDir('route-swarm'));
  const workers = [];
  const runs = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [] },
    authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: rows }),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      runs.push(request.runId);
      if (!workers.some((row) => row.runId === request.runId)) {
        workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
          runId: request.runId, status: 'working', paused: false });
      }
    },
    stopRun: async (runId) => {
      const row = workers.find((candidate) => candidate.runId === runId);
      if (row) row.status = 'dead';
      return { state: 'closed' };
    },
  });
  let key = 0;
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'route-swarm', ...(command === 'view' ? {} : { idempotencyKey: `442-${++key}` }), ...args }, owner);
  return { call, runs };
}

test('442-c1: a faulted route reads degraded with its reason and reset, and refuses a recruit', async (t) => {
  const { deployment, log } = await openDeployment(t, 'route', [DEGRADED_ROUTE, READY_ROUTE]);

  // The provider said when the route comes back, and it has not come back yet.
  const future = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
  log.append(degradedRow(DEGRADED_ROUTE, { at: Date.now() - 60_000, resetAt: future }));

  const doctor = await deployment.doctor();
  const degraded = usageRowFor(doctor.routeUsage, DEGRADED_ROUTE);
  assert.equal(degraded.state, 'degraded', 'the route its provider faulted is not ready');
  assert.equal(degraded.reason, PROVIDER_FAULT_CODES.quota, 'it names the fault class that took it down');
  assert.equal(degraded.resetAt, future, 'and the instant the provider said it comes back');
  assert.equal(degraded.quota.state, 'exhausted', 'the quota axis reads the same fault');
  assert.equal(degraded.quota.resetAt, future);
  // #523: the quota scope is (provider ?? model segment ?? harness), never effort — DEGRADED_ROUTE
  // and READY_ROUTE are the same harness and model at two efforts, so they share ONE scope and a
  // fault on either degrades both. A genuinely unrelated scope is untouched (covered by 523-b/523-c).
  assert.equal(usageRowFor(doctor.routeUsage, READY_ROUTE).state, 'degraded', 'a sibling effort of the same scope shares the fault');
  // The #341 route table a seat's brief renders marks the same fact: state degraded, the quota axis
  // exhausted, and the instant the provider said the route comes back.
  const line = renderRouteUsageLines(doctor.routeUsage)
    .find((row) => row.startsWith('- codex/gpt-5.6-sol@high:'));
  assert.ok(line?.includes('degraded'), `the route table marks the degraded route (got: ${line})`);
  assert.ok(line?.includes(`quota=exhausted resetAt=${future}`), `and names its reset (got: ${line})`);

  // A recruit onto it refuses PRE-EFFECT, typed, naming the reset the provider gave — never a seat
  // admitted onto a route its provider is refusing. The refusal reads the deployment's OWN rows.
  const fixture = routeFixture(doctor.routeUsage);
  await fixture.call('create', { purpose: 'route truth' });
  await assert.rejects(
    fixture.call('recruit', { participantId: 'lane-1', objective: 'work', options: { exact: DEGRADED_ROUTE } }),
    (error) => {
      assert.equal(error.code, 'route_degraded');
      assert.equal(error.detail?.route?.effort, DEGRADED_ROUTE.effort);
      assert.equal(error.detail?.faultClass, PROVIDER_FAULT_CODES.quota);
      assert.equal(error.detail?.resetAt, future, 'the refusal names the instant the provider gave');
      return true;
    },
    'a recruit on the faulted route refuses typed, naming the reset',
  );
  assert.deepEqual(fixture.runs, [], 'the refusal precedes every effect — no run was started');
});

test('442-c2: the provider\'s own reset instant retires the episode, and the route admits again', async (t) => {
  const { deployment, log } = await openDeployment(t, 'route-clear', [DEGRADED_ROUTE, READY_ROUTE]);

  // The episode is past the instant its provider named: it is HISTORY by derivation, never a timer.
  const past = new Date(Date.now() - 60_000).toISOString();
  log.append(degradedRow(DEGRADED_ROUTE, { at: Date.now() - 120_000, resetAt: past }));

  const doctor = await deployment.doctor();
  const row = usageRowFor(doctor.routeUsage, DEGRADED_ROUTE);
  assert.equal(row.degraded, null, 'an episode past its own reset instant holds the route no longer');
  assert.equal(row.state, 'ready');
  assert.equal(row.quota.state, 'ok');

  // An episode nothing timed (a stall names no instant) still holds the route: only the provider's
  // own answer retires one this way.
  log.append(degradedRow(DEGRADED_ROUTE, {
    at: Date.now() - 60_000, failure: 'provider_turn_failed', resetAt: null,
  }));
  const stalled = usageRowFor((await deployment.doctor()).routeUsage, DEGRADED_ROUTE);
  assert.equal(stalled.state, 'degraded', 'a stall episode keeps the route off until its probe succeeds');

  const healed = routeFixture((await deployment.doctor()).routeUsage);
  await healed.call('create', { purpose: 'reset passed' });
  const cleared = routeFixture([
    { ...usageRowFor((await deployment.doctor()).routeUsage, DEGRADED_ROUTE), degraded: null, state: 'ready' },
    usageRowFor((await deployment.doctor()).routeUsage, READY_ROUTE),
  ]);
  await cleared.call('create', { purpose: 'route came back' });
  const admitted = await cleared.call('recruit', {
    participantId: 'lane-2', objective: 'work', options: { exact: DEGRADED_ROUTE },
  });
  assert.equal(admitted.admission?.state, 'admitted', 'the route admits a seat again at its own reset');
});

test('442-d1: a zone-less reset answer keeps its text and derives no instant', async (t) => {
  const f = world('d1');
  const seat = await faultedSeat(f, { label: 'd1', text: quotaText(ZONE_LESS_RESET) });
  t.after(() => close(seat));

  // The boundary: the provider's wall-clock is the provider's LOCAL time and nothing in the answer
  // says which zone that is, so the honest pair is the text plus a null instant.
  const typed = faultFor(quotaText(ZONE_LESS_RESET));
  assert.equal(typed.detail.resetAt, null, 'no zone, no instant — never a UTC reading nobody stated');
  assert.equal(typed.detail.resetAtText, ZONE_LESS_RESET, "the provider's own words are kept verbatim");
  assert.equal(providerFaults.providerResetText(quotaText(ZONE_LESS_RESET)), ZONE_LESS_RESET);
  assert.equal(parseProviderResetAt(quotaText(RESET_AT)), RESET_AT, 'a zone-qualified answer still parses');
  assert.equal(parseProviderResetAt(`${ZONE_LESS_RESET}Z`), RESET_AT, 'and an explicit zone is honored');

  // … and the honest pair survives the whole fold: the seat's row, and the row a reader sees. A
  // runtime entry is what folds it (a view is one), so the view is read first.
  const view = await seat.call('view', { swarmId: 'sw' });
  const row = faultRows(seat.driver)[0];
  assert.ok(row, 'the fault row lands on the first runtime entry after the death');
  assert.equal(row.payload.resetAt, null);
  assert.equal(row.payload.resetAtText, ZONE_LESS_RESET);
  const alpha = participantRow(view, 'alpha');
  assert.equal(alpha.fault.resetAt, null);
  assert.equal(alpha.fault.resetAtText, ZONE_LESS_RESET);
});

test('442-e1: the fault row replays identically, and no caller can submit one', async (t) => {
  const f = world('e1');
  const seat = await faultedSeat(f, { label: 'e1' });
  const first = await seat.call('view', { swarmId: 'sw' });
  const reading = { ...participantRow(first, 'alpha').fault };
  const rows = faultRows(seat.driver);

  // A replay of the ledger from an empty projection through the same fold the store replays
  // carries the reading — the row is durable state, not this runtime's memory.
  const swarms = new Map();
  for (const event of seat.driver.coordination.eventsView()) {
    if (SWARM_EVENT_KINDS.has(event.kind)) foldSwarmEvent(swarms, event);
  }
  const replayed = swarmSnapshot(swarms).swarms[0].participants.alpha;
  assert.equal(replayed.fault.code, reading.code);
  assert.equal(replayed.fault.resetAt, reading.resetAt);
  assert.equal(replayed.status, 'left');
  assert.equal(replayed.leftReason, 'provider_fault');
  await close(seat);

  // A SECOND incarnation over the same repository and deployment root reads the same facts, and
  // mints nothing twice: the observation is keyed by the death it observed.
  const second = swarmWorld(f, { label: 'e1b' });
  t.after(() => close(second));
  const later = await second.call('view', { swarmId: 'sw' });
  assert.deepEqual({ ...participantRow(later, 'alpha').fault }, reading,
    'every later incarnation reads the same fault');
  assert.equal(participantRow(later, 'alpha').status, 'left');
  assert.equal(faultRows(second.driver).length, rows.length, 'a later incarnation mints no second row');

  // The row is runtime-recorded, never caller-submittable (the #425/#364 pattern).
  await assert.rejects(second.call('update', {
    swarmId: 'sw', event: 'swarm.participant_faulted',
    payload: { swarmId: 'sw', participantId: 'alpha', workerId: 'w-1', code: PROVIDER_FAULT_CODES.quota,
      route: { ...ROUTE }, resetAt: null, resetAtText: null, snapshotSha: null },
  }), (error) => {
    assert.equal(error.detail?.field, 'event');
    assert.equal(String(error.detail?.admitted ?? '').includes('swarm.participant_faulted'), false,
      'and the admitted set does not contain the runtime-recorded kind');
    return true;
  });
});
