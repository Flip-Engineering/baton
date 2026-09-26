// Issue #475 — a route probe's successful turn did not clear the degrade.
//
// Observed 2026-09-18 on the primary resident (21f85ac1), the zai window having reset at 15:07:32Z:
//
//   1. 15:10:20Z `route.probe_admitted {reason: 'probe_due', clearsAt: '14:50:08Z'}` — the first
//      recruit after the reset was admitted as the probe #456 designed.
//   2. The probe seat ran a real GLM turn: `route.observed` rows 15:11:00–15:12:56 naming
//      `zai/glm-5.3-flash`, a `swarm.contribution_recorded` at 15:12:40, and
//      `swarm.participant_left {reason: 'completed'}` at 15:14:47 — the probe ANSWERED.
//   3. 15:15:08Z the next recruit on the same route was refused:
//
//      route_degraded (409): route omp/zai/glm-5.3-flash@high is degraded and a probe (admitted at
//      an unrecorded instant) already holds its next step; retry after 2026-09-18T14:50:08.750Z or
//      admit another probe with --route-probe
//
// Three defects in one refusal, pinned here:
//   (a) the successful turn never closed the episode: #456 settled a probe by asking a LATER route
//       read whether the deployment still reported the degrade, but a probe turn's rows are not
//       attributed to the route's model/effort coordinates, so the episode outlived its own answer;
//   (b) "admitted at an unrecorded instant": the probe row carries `at: 15:10:20.441Z`, and the
//       refusal's reader could not find it once the 120 s probe deadline had passed;
//   (c) "retry after 14:50:08Z" is in the past, and `--route-probe` was a flag the verb's own
//       admitted vocabulary did not hold.
//
// The repair, per the issue: the probe's own `route.observed` on the route it was admitted on
// (the EARLIER durable fact a successful turn leaves — it precedes the seat's contribution by a
// whole turn of work) closes the episode at the runtime entry and mints `route.recovered` THEN; the
// runtime reads that closed episode back into every route row it compares, so the next recruit is
// admitted normally; a probe still out is refused by SEAT and by the instant its own row carries,
// with "wait for it or stop it" as the only remedy; and a probe whose turn the provider faulted
// leaves the degrade standing, with the new reset named beside the death.
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, real git checkouts, no provider process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { Log } from '../src/log.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { ompProviderKeyFile, openBatonDeployment } from '../src/application-deployment.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';
import { batonCliHelp, parseBatonCli } from '../src/application-cli.mjs';

/** The route the incident's own probe ran on: an omp route whose model names the provider (zai), so
 * the zone-less reset its answer spelled parses to the instant the provider MEANT (#456 item 1). */
const DEGRADED_ROUTE = Object.freeze({ harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' });
const READY_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const ZAI_OFFSET_MINUTES = 8 * 60;
/** The registry's own bound on ONE probe turn (limits.mjs `route.probe_deadline_ms`). */
const PROBE_DEADLINE_MS = 120_000;
const SWARM_ID = 'route-swarm';

/** The provider's own 429, as the answer spells it — the fleet's quota text verbatim. */
const quotaText = (reset, window = '5 hour') =>
  `429 Usage limit reached for ${window}. Your limit will reset at ${reset} (type=1308)`;

/** One instant spelled the way a provider in a zone spells it: wall clock, no zone in the text. */
function wallClock(instantMs, offsetMinutes) {
  const shifted = new Date(instantMs + offsetMinutes * 60_000);
  return shifted.toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/u, '');
}

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function tmpDir(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue475-${label}-`));
  dirs.push(root);
  return root;
}

const owner = Object.freeze({ actor: 'owner', principalId: 'owner' });

function gitRepo(label) {
  const root = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'master'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue475@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 475'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# issue 475\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

/** A fixture adapter that advertises the routes it is handed — the same card shape the #456 rows
 * build, so a failed turn's own 429 text is evidence about the route exactly as on a live card. */
function adapterFor(harness, routes) {
  const adapter = new MockAdapter({
    harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'fixture', files: {} },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    authPosture: 'subscription',
    concurrencyCeiling: 4,
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      ...baseCard().modelSelection,
      configuredDefault: routes[0].model,
      available: [...new Set(routes.map((route) => route.model))],
      reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      provenance: 'issue475-fixture',
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
  // An omp route's readiness gate wants its provider's repository key file (#230/#342): a fixture
  // route is provisioned the way a live one is, so what a scenario observes is the PROVIDER's
  // verdict on the route and never the fixture's own missing credential file.
  for (const route of routes) {
    const keyFile = ompProviderKeyFile(route.model);
    if (keyFile !== null) writeFileSync(join(repo, keyFile), '{}\n');
  }
  const root = join(tmpDir(`${label}-owner`), 'deployment');
  let driverOptions = null;
  const adapters = {};
  for (const harness of new Set(routes.map((route) => route.harness))) {
    adapters[harness] = adapterFor(harness, routes.filter((route) => route.harness === harness));
  }
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters,
      routes,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => { driverOptions = options; return createDriver(options); });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the test */ } });
  return { deployment, log: new Log(driverOptions.logDir), repo };
}

/** The episode the coordinator's death fold lands for a route (#316), in the #456 shape: the
 * provider's reset answer may be an instant, its own text, or neither. */
function degradedRow(route, { failure = PROVIDER_FAULT_CODES.quota, at, resetAt = null, resetAtText = null, participants = ['w-1', 'w-2', 'w-3'] } = {}) {
  const stamp = new Date(at).toISOString();
  return {
    worker: 'w-1', harness: `${route.harness}@1.0.0`, turnEpoch: 1,
    kind: 'provider.degraded', actor: 'policy',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: {
      route: Object.freeze({ ...route }), faultClass: failure,
      participants: Object.freeze([...participants]),
      window: Object.freeze({ from: stamp, to: stamp }), count: participants.length,
      next: Object.freeze({ action: 'pause_recruits_until_probe', route: Object.freeze({ ...route }) }),
      resetAt, resetAtText,
    },
  };
}

/** The failed turn the provider refused — the row the route's own refusal reading (#341 part 2)
 * takes its evidence from, including the fault's own text and the window it names. */
function failedTurnRow(route, { text, resetAt = null, resetAtText = null }) {
  return {
    worker: 'w-9', harness: `${route.harness}@1.0.0`, turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: {
      status: 'failed', progress: 1, summary: 'the provider refused the turn',
      artifacts: { commits: [], files: [] }, openQuestions: [],
      budgetUsed: { tokens: 1, usd: 0 },
      failure: {
        code: PROVIDER_FAULT_CODES.quota, message: text,
        detail: { route: Object.freeze({ ...route }), resetAt, resetAtText },
      },
    },
  };
}

const usageRowFor = (rows, route) => rows.find((row) => (
  row.route.harness === route.harness && row.route.model === route.model
    && row.route.effort === route.effort));

/** The runtime half of the route truth: the deployment's OWN rows are what a recruit compares —
 * read LIVE through `readRows`, so the whole chain (ledger → deployment derivation → recruit) is
 * the subject of every assertion. The coordinator answers for the two facts this lane reads from
 * it: the fleet it holds, and the provider-fault death a seat's worker ended under (#442). */
function routeFixture(readRows) {
  const store = new CoordinationStore(tmpDir('route-swarm'));
  const workers = [];
  const runs = [];
  const deaths = new Map();
  const prepared = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      providerFaultDeathFor: (workerId) => deaths.get(workerId) ?? null,
    },
    authorize: async () => {},
    deploymentSummary: () => ({ workspace: null, hostCapacity: null, served: null, routeUsage: readRows() }),
    prepareRun: async (request) => {
      prepared.push(request.options ?? null);
      return { ...request, route: request.options?.exact ?? null };
    },
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
    { swarmId: SWARM_ID, ...(command === 'view' ? {} : { idempotencyKey: `475-${++key}` }), ...args }, owner);
  const rowsOfKind = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, actor: event.actor, seq: event.seq,
      idempotencyKey: event.idempotencyKey }));
  const seatRow = (participantId) => store.swarm(SWARM_ID)?.participants?.[participantId] ?? null;
  return { call, runs, store, rowsOfKind, prepared, deaths, seatRow, workers };
}

const refusalOf = async (promise) => {
  try { await promise; return null; } catch (error) { return error; }
};

const liveRows = (deployment) => () => deployment.doctorReadiness().routeUsage;

/** The row the coordinator records the moment a turn's observation named the model the provider
 * really served (`lifecycle.spawned` / `resource.tokens` → `.../src/coordinator.mjs`
 * `_coordRecord('route.observed', ...)`): the row #475 reads as the probe's answering turn. */
function observedRow(route, runId, workerId) {
  return {
    taskId: runId, workerId, runId,
    harnessRequested: route.harness, harnessResolved: route.harness,
    modelRequested: route.model, modelResolved: route.model, modelObserved: route.model,
    effortRequested: route.effort, effortResolved: route.effort, effortObserved: route.effort,
    evidence: { seq: 1 },
  };
}

const recordObservation = (fixture, route, participantId, workerId = 'w-probe', overrides = {}) => {
  const seat = fixture.seatRow(participantId);
  assert.ok(seat?.runId, `the probe seat ${participantId} holds a Run`);
  return fixture.store.recordDriver('route.observed',
    { ...observedRow(route, seat.runId, workerId), ...overrides },
    { actor: 'policy', key: `driver.route_observed:${seat.runId}:1` })?.event ?? null;
};

/** Stage the incident's own route state: a quota degrade whose provider named no instant (the #456
 * deadlock shape), while the reset instant the provider's answer spelled — a wall clock, read against
 * zai's declared zone — has already passed. That is the row the incident reported: the refusal block
 * has lapsed, so only the degrade stands (`state: 'degraded'`) and the route has no next step of its
 * own. `window` is the fault's own words: a LONGER one keeps `clearsAt` ahead of now (nothing is due
 * yet), a SHORTER one puts it in the past (a probe is due). */
async function degradedRoute(t, label, { route = DEGRADED_ROUTE, window = '5 hour', faultAgo = MINUTE_MS } = {}) {
  const opened = await openDeployment(t, label, [route, READY_ROUTE]);
  const faultAt = Date.now() - faultAgo;
  const wall = wallClock(faultAt - 2 * HOUR_MS, ZAI_OFFSET_MINUTES);
  opened.log.append(failedTurnRow(route, { text: quotaText(wall, window) }));
  opened.log.append(degradedRow(route, { at: faultAt, resetAt: null, resetAtText: wall }));
  const row = usageRowFor((await opened.deployment.doctor()).routeUsage, route);
  assert.ok(row?.degraded, `${label}: the route its provider faulted reads degraded`);
  assert.equal(row.state, 'degraded',
    `${label}: the provider's own reset has passed, so the degrade is what stands — the incident's row`);
  return { ...opened, row };
}

// ── (a) the probe's own answering turn closes the episode, THEN ──────────────────────────────────

test('475-a: the probed route\'s own observed turn mints route.recovered at that instant, before any route read', async (t) => {
  const { deployment, row } = await degradedRoute(t, 'answered', { faultAgo: 3 * HOUR_MS, window: '1 hour' });
  assert.ok(Date.parse(row.degraded.clearsAt) < Date.now(), 'the episode\'s clear is in the past — a probe is due');

  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe answered' });
  const probe = await fixture.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: DEGRADED_ROUTE } });
  assert.equal(probe.admission?.kind, 'probe', 'the due probe is what is admitted');
  const admission = fixture.rowsOfKind('route.probe_admitted')[0];
  assert.ok(admission, 'the admission is durable');
  assert.equal(fixture.runs.length, 1, 'the probe is the only run so far');

  // The probe's turn reached its provider: the coordinator records the observation on the route the
  // seat's run was admitted on (modelObserved names what really served). This is the EARLIER of the
  // two durable facts a successful turn leaves — it lands while the turn runs, the seat's
  // contribution only at the end of it — and it is the fact about the ROUTE the probe is asking
  // about, so it is the one that closes the episode.
  const observed = recordObservation(fixture, DEGRADED_ROUTE, 'lane-probe');
  assert.ok(observed, 'the observation is durable');

  // NO recruit follows — only a read reaches the runtime, and the runtime's own entry is what reads
  // the probe's answer. The route table the deployment publishes is deliberately NOT consulted:
  // its derivation is exactly what missed the probe's turn in the incident.
  await fixture.call('view', {});

  const recovered = fixture.rowsOfKind('route.recovered');
  assert.equal(recovered.length, 1, 'the episode is closed — ONE route.recovered row');
  assert.equal(recovered[0].at, observed.ts,
    'minted at the instant the answering turn was observed, never at the instant it was read back');
  assert.equal(recovered[0].probeKey, admission.idempotencyKey,
    'keyed by the admission it answers');
  assert.equal(recovered[0].probeAdmissionSeq, admission.seq, 'naming that admission\'s row');
  assert.equal(recovered[0].probeAt, admission.at, 'and the instant the probe was admitted');
  assert.equal(recovered[0].clearsAt, admission.clearsAt, 'beside the clear it was testing');
  assert.equal(recovered[0].route.effort, DEGRADED_ROUTE.effort);
  assert.equal(fixture.runs.length, 1, 'and no recruit was needed to settle it — the turn did');
});
// ── (a2) the answering observation spells its adapter harness@version, and the episode still closes ──

test('475-a2: the answering observation\'s version-suffixed harness label still closes the episode', async (t) => {
  // Observed on the 2026-09-25/26 codex/gpt-6-astra incident: the coordinator's route.observed row
  // names the adapter's own `harness@version` composition in harnessResolved (`codex@codex-cli
  // 0.156.1`), while the probe admission spells the served route (`codex`). The answer-matching
  // guard compared the two spellings exactly, threw every real answer away, and a route its probe
  // answered sat degraded for hours (#575's residual half).
  const { deployment, row } = await degradedRoute(t, 'answered-versioned', { faultAgo: 3 * HOUR_MS, window: '1 hour' });
  assert.ok(Date.parse(row.degraded.clearsAt) < Date.now(), 'a probe is due');

  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe answered under a versioned label' });
  const probe = await fixture.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: DEGRADED_ROUTE } });
  assert.equal(probe.admission?.kind, 'probe', 'the due probe is what is admitted');
  const admission = fixture.rowsOfKind('route.probe_admitted')[0];

  const observed = recordObservation(fixture, DEGRADED_ROUTE, 'lane-probe', 'w-probe', {
    harnessResolved: `${DEGRADED_ROUTE.harness}@omp/17.4.0`,
  });
  assert.ok(observed, 'the observation is durable');

  await fixture.call('view', {});
  const recovered = fixture.rowsOfKind('route.recovered');
  assert.equal(recovered.length, 1,
    'the version-suffixed resolved label is the same turn on the same route — the episode closes');
  assert.equal(recovered[0].probeKey, admission.idempotencyKey, 'keyed by the admission it answers');
});


// ── (b) the next recruit is admitted normally, and the comparison reads the route ready ──────────

test('475-b: the next recruit on the answered route admits normally, and the comparison reads it ready', async (t) => {
  const { deployment } = await degradedRoute(t, 'admitted', { faultAgo: 3 * HOUR_MS, window: '1 hour' });
  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'after the probe answered' });
  const probe = await fixture.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: DEGRADED_ROUTE } });
  assert.equal(probe.admission?.kind, 'probe', 'the probe is what is admitted first');
  recordObservation(fixture, DEGRADED_ROUTE, 'lane-probe');
  await fixture.call('view', {});

  // The deployment's OWN derivation still reports the episode (a probe turn is not attributed to
  // the route's coordinates — the incident's root cause). The runtime's durable recovery is what the
  // next recruit reads, and that is the point: the seat is admitted on the probe's answer, not on a
  // later read that has to find the route already cleared.
  const deploymentStillDegraded = usageRowFor((await deployment.doctor()).routeUsage, DEGRADED_ROUTE);
  assert.equal(deploymentStillDegraded.state, 'degraded',
    'the deployment\'s own row still reads degraded — its own derivation is not what admits the seat');

  const next = await fixture.call('recruit',
    { participantId: 'lane-next', objective: 'work', options: { exact: DEGRADED_ROUTE } });
  assert.equal(next.admission?.state, 'admitted', 'recruits are admitted again');
  assert.equal(next.admission?.kind ?? null, null, 'a normally admitted seat is no probe');
  assert.equal(fixture.rowsOfKind('route.probe_admitted').length, 1, 'no second probe was admitted');
  assert.equal(fixture.runs.length, 2, 'the next seat is a real run');

  // The comparison table the receipt carries is the runtime's own reading of the route: ready, with
  // the quota axis back to ok — never `degraded`/`exhausted` beside an admitted seat.
  const compared = next.routes?.considered?.find((entry) => entry.route.effort === DEGRADED_ROUTE.effort);
  assert.ok(compared, 'the receipt compares the route the caller named');
  assert.equal(compared.state, 'ready', 'the route reads ready');
  assert.equal(compared.quota?.state, 'ok', 'with its quota axis back to ok');
  assert.equal(compared.reason, 'named exactly by the caller');
});

// ── (c) a probe still OUT is refused by seat and instant, and no flag is offered ─────────────────

test('475-c: a probe still out is refused by SEAT and by the instant its own row carries, and offers no flag', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  // A LIVE degrade: the provider named no instant and its own 5 hour window has not passed, so
  // nothing is due and only the operator's own probe can go out.
  const { deployment } = await degradedRoute(t, 'in-flight', { window: '5 hour', faultAgo: MINUTE_MS });
  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe in flight' });
  const probe = await fixture.call('recruit', {
    participantId: 'lane-probe', objective: 'probe the route',
    options: { exact: DEGRADED_ROUTE, routeProbe: true },
  });
  assert.equal(probe.admission?.kind, 'probe', 'the operator\'s probe is admitted');
  const admission = fixture.rowsOfKind('route.probe_admitted')[0];
  assert.equal(admission.reason, 'operator_override');
  assert.ok(Number.isFinite(Date.parse(admission.at)), 'the probe row carries the instant it was admitted');

  const refused = await refusalOf(fixture.call('recruit',
    { participantId: 'lane-2', objective: 'work', options: { exact: DEGRADED_ROUTE } }));
  assert.equal(refused?.code, 'route_degraded', 'a second recruit refuses while the probe is out');
  assert.equal(refused.detail?.probeInFlight, true, 'naming the probe that is out');
  assert.equal(refused.detail?.probeSeat, 'lane-probe', 'by the SEAT the ledger recorded');
  assert.equal(refused.detail?.probeAdmittedAt, admission.at,
    'and by the instant that seat\'s own row carries');
  assert.ok(refused.message.includes('lane-probe'), 'the message names the seat');
  assert.ok(refused.message.includes(admission.at), 'and the instant');
  assert.doesNotMatch(refused.message, /unrecorded instant/u, 'never "an unrecorded instant"');
  // The remedy is the caller's own: wait for that seat, or stop it. A probe flag cannot admit
  // anything while the episode's ONE probe is out, so none is named.
  assert.doesNotMatch(refused.message, /--route-probe/u, 'no probe flag is offered while one is out');
  assert.equal(refused.detail?.remedy?.action, 'wait_for_probe_seat');
  assert.equal(refused.detail?.remedy?.flag, undefined, 'and the remedy names no flag at all');
  assert.match(refused.message, /stop it/u, 'the message says how to release the episode');

  // …and the probe's row is still the authority once the 120 s deadline has passed: the seat is
  // ACTIVE (a slow turn is not a lost one), so the incident's own 15:15:08 refusal can no longer
  // read "an unrecorded instant" from a map that had forgotten the admission.
  t.mock.timers.tick(PROBE_DEADLINE_MS + MINUTE_MS);
  const late = await refusalOf(fixture.call('recruit',
    { participantId: 'lane-3', objective: 'work', options: { exact: DEGRADED_ROUTE } }));
  assert.equal(late?.code, 'route_degraded', 'the route is still held by the probe that is out');
  assert.equal(late.detail?.probeSeat, 'lane-probe', 'the seat is still named, past the deadline');
  assert.equal(late.detail?.probeAdmittedAt, admission.at, 'with the admission\'s own instant');
  assert.equal(fixture.runs.length, 1, 'and no second probe was started');
});

// ── (d) a probe whose turn the provider faulted leaves the degrade standing ──────────────────────

test('475-d: a probe whose turn the provider faulted leaves the degrade in place, and the refusal names that death', async (t) => {
  const { deployment, log, row } = await degradedRoute(t, 'probe-failed', { faultAgo: 3 * HOUR_MS, window: '1 hour' });
  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe failed' });
  const probe = await fixture.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: DEGRADED_ROUTE } });
  assert.equal(probe.admission?.kind, 'probe', 'the probe is what is admitted');
  const probeSeat = fixture.seatRow('lane-probe');
  const workerId = probeSeat.bindings.at(-1).workerId;

  // The probe's turn died with the SAME provider fault: the coordinator's own death seam knows it
  // (#442), and the death fold lands a NEW episode for the route — the window moved to this death,
  // and the provider's answer named an instant this time.
  const resetAt = new Date(Date.now() + 2 * HOUR_MS).toISOString();
  fixture.deaths.set(workerId, {
    code: PROVIDER_FAULT_CODES.quota, route: DEGRADED_ROUTE, resetAt, seq: 7, snapshotSha: null,
  });
  log.append(degradedRow(DEGRADED_ROUTE, {
    at: Date.now(), resetAt, resetAtText: null,
    participants: ['w-1', 'w-2', 'lane-probe'],
  }));
  await fixture.call('view', {});

  const faultRows = fixture.store.eventsView().filter((event) => event.kind === 'swarm.participant_faulted');
  assert.equal(faultRows.length, 1, 'the death is durable — the runtime folded it off the coordinator');
  assert.equal(faultRows[0].payload.participantId, 'lane-probe');
  assert.equal(faultRows[0].payload.code, PROVIDER_FAULT_CODES.quota);
  assert.deepEqual(fixture.rowsOfKind('route.recovered'), [],
    'a faulted probe clears NOTHING — the route still reads degraded');

  const refused = await refusalOf(fixture.call('recruit',
    { participantId: 'lane-2', objective: 'work', options: { exact: DEGRADED_ROUTE } }));
  assert.equal(refused?.code, 'route_degraded', 'the re-armed route refuses until its next probe instant');
  assert.equal(refused.detail?.resetAt, resetAt, 'the NEW provider reset rides the refusal');
  assert.equal(refused.detail?.clearsAt, resetAt, 'and it is the instant the route clears');
  assert.equal(refused.detail?.probeFaulted?.participantId, 'lane-probe',
    'the refusal names the probe whose own turn died');
  assert.equal(refused.detail?.probeFaulted?.code, PROVIDER_FAULT_CODES.quota);
  assert.equal(refused.detail?.probeFaulted?.at, probe.admission.probe.at);
  assert.match(refused.message, /lane-probe/u, 'the message names that seat');
  assert.ok(refused.message.includes(`died of ${PROVIDER_FAULT_CODES.quota}`), 'and the typed fault it died of');
  assert.match(refused.message, /re-armed/u, 'and that the episode re-armed with it');
  // The remedy a refusal offers must be a spelling the CLI really holds: the recruit's own
  // `--options` leg, never the undeclared probe token #456 consumed behind the closed argv.
  assert.match(refused.message, /--options/u, 'the remedy names the flag the verb admits');
  assert.doesNotMatch(refused.message, /--route-probe/u, 'never a flag that does not exist');
  assert.equal(row.degraded?.reason, PROVIDER_FAULT_CODES.quota, 'the sequence really was a quota degrade');
});

// ── (e) a probe whose seat settled without answering releases the episode ────────────────────────

test('475-e: a probe seat that settles without answering releases the episode to the next attempt', async (t) => {
  const { deployment } = await degradedRoute(t, 'released', { window: '5 hour', faultAgo: MINUTE_MS });
  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe released' });
  const probe = await fixture.call('recruit', {
    participantId: 'lane-probe', objective: 'probe the route',
    options: { exact: DEGRADED_ROUTE, routeProbe: true },
  });
  assert.equal(probe.admission?.probe?.attempt, 1, 'the operator\'s probe is the episode\'s first attempt');

  // The seat is STOPPED — the remedy the in-flight refusal names. It never answered, so the episode
  // is free again: the next recruit admits a NEW probe rather than being told to wait for a seat
  // that is gone.
  await fixture.call('stop', { participantId: 'lane-probe', reason: 'the probe is abandoned' });
  assert.equal(fixture.seatRow('lane-probe').status, 'left', 'the seat settled');

  const next = await fixture.call('recruit',
    { participantId: 'lane-next', objective: 'probe again', options: { exact: DEGRADED_ROUTE } });
  assert.equal(next.admission?.state, 'admitted', 'the episode admits its next attempt');
  assert.equal(next.admission?.kind, 'probe', 'as the probe it is');
  assert.equal(next.admission?.probe?.attempt, 2, 'the second attempt for the same episode');
  const admissions = fixture.rowsOfKind('route.probe_admitted');
  assert.equal(admissions.length, 2, 'both attempts are durable');
  assert.notEqual(admissions[0].idempotencyKey, admissions[1].idempotencyKey,
    'each attempt has its own key — the first is byte-identical to the #456 key');
  assert.equal(admissions[1].idempotencyKey, `${admissions[0].idempotencyKey}:2`,
    'and the second attempt extends it');
  assert.equal(probe.admission?.probe?.route?.effort, DEGRADED_ROUTE.effort);
});

// ── (f) the operator's probe has ONE admitted spelling, taught where the refusal sends them ─────

test('475-f: the operator\'s probe is spelled through a flag the CLI admits, and the help teaches it', () => {
  // The recruit verb declares no probe flag: `--route-probe` refuses the #431 closed-set way, naming
  // the flags the verb really admits. That is exactly why the refusal's remedy must not have named
  // it — and why the ONE spelling left (`options.routeProbe`, carried by the taught `--options`) is
  // the one both the help and the refusal speak.
  let closed = null;
  try {
    parseBatonCli(['--idempotency-key', 'k475', 'swarm', 'recruit', 'wave', 'seat-1', 'work',
      '--options', JSON.stringify({ exact: DEGRADED_ROUTE }), '--route-probe']);
  } catch (error) { closed = error; }
  assert.ok(closed, 'the undeclared probe token refuses at the parse');
  assert.equal(closed.detail?.field, '--route-probe', 'naming the token');
  assert.equal(closed.detail?.rule, 'closed-set', 'in the #431 closed-set shape');
  assert.ok(closed.detail?.admitted?.includes('--options'), 'and naming the flag that carries the probe');
  assert.ok(!closed.detail?.admitted?.includes('--route-probe'), 'which is not the probe token itself');

  const parsed = parseBatonCli(['--idempotency-key', 'k476', 'swarm', 'recruit', 'wave', 'seat-1', 'work',
    '--options', JSON.stringify({ exact: DEGRADED_ROUTE, routeProbe: true })]);
  assert.equal(parsed.args.options.routeProbe, true, 'the operator\'s probe rides options.routeProbe');
  assert.deepEqual(parsed.args.options.exact, DEGRADED_ROUTE, 'beside the options the caller named');

  // …and `baton help swarm recruit` teaches that spelling, so an operator reads it where the refusal
  // sends them.
  const help = batonCliHelp('swarm.recruit');
  assert.match(help, /routeProbe/u, 'the recruit help teaches options.routeProbe');
  assert.match(help, /--options/u, 'through the flag that carries it');
  assert.match(help, /route_degraded/u, 'and what a recruit reads while a probe holds the episode');
});
