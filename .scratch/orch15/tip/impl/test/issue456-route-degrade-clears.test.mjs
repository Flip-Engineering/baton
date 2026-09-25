// Issue #456 — a provider-quota degrade never clears when the provider's reset string has no zone.
//
// Observed 2026-09-18: the zai 5-hour window closed before 09:50Z — the answer spelled
// `reset at 2026-09-18 18:07:32` (Beijing wall time = 10:07:32Z) — #442 degraded the route and
// refused every recruit onto it. Ten minutes AFTER the provider's window reopened the same refusal
// still stood, on both residents, and nothing could ever clear it:
//
//   (a) #442 item 2 clears a degrade "at resetAt or on the next successful turn on that route",
//       and `resetAt` was `null` (item 4 kept only the zone-less `resetAtText`), so the timed clear
//       never armed;
//   (b) the next successful turn cannot happen while every recruit onto the route is refused
//       pre-effect — the two rules deadlock.
//
// The repair, pinned here:
//   (a) the provider's own clock zone, declared ONCE (`PROVIDER_RESET_ZONES`: zai answers Beijing
//       wall time, +08:00), so a zai answer that spells its window zone-less parses to the instant
//       it MEANT — and a provider nothing documents a zone for still derives no instant;
//   (b) a degrade whose provider named no instant carries `probeAfter` (the fault's own window when
//       its text names one, else the registry's fault-probe row) and `clearsAt` (resetAt or
//       probeAfter), so the route never sits degraded with no next step: after `clearsAt` ONE
//       recruit is admitted as a probe (`admission.kind === 'probe'`), durable as a
//       `route.probe_admitted` row, and a second recruit refuses while that probe is out;
//   (c) the probe's own outcome decides: a successful turn on the route retires the episode
//       (recruits are admitted again, the runtime records `route.recovered`), a provider fault
//       re-arms it with the next probeAfter, measured from the new death;
//   (d) the operator override: `swarm recruit … --options '{"routeProbe": true}'`
//       (`options.routeProbe: true`, the ONE spelling #475 leaves: the verb declares no probe flag
//       of its own) admits one recruit onto a degraded route regardless, recorded as
//       `route.probe_admitted {actor}`, and the `route_degraded` refusal names it as the remedy
//       beside `clearsAt`.
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
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { PROVIDER_FAULT_CODES, classifyProviderFault, parseProviderResetAt } from '../src/provider-faults.mjs';
// The #456 exports are reached through the namespace on purpose: this file must LOAD against the
// commit it pins, so every row fails on its own assertion instead of the module failing to link.
import * as providerFaults from '../src/provider-faults.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';

const DEGRADED_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const READY_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
/** The route the incident's answer came from: an omp route whose model names the provider (zai). */
const ZAI_ROUTE = Object.freeze({ harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' });

/** The zone-less spelling the incident's answer carried, and the instant it MEANT (Beijing). */
const ZONE_LESS_RESET = '2026-09-18 18:07:32';
const ZAI_RESET_AT = '2026-09-18T10:07:32.000Z';

const HOUR_MS = 3_600_000;
const ZAI_OFFSET_MINUTES = 8 * 60;
const registryProbeMs = () => FRAME_LIMITS['route.fault_probe_ms']?.value ?? null;

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
  const root = mkdtempSync(join(tmpdir(), `baton-issue456-${label}-`));
  dirs.push(root);
  return root;
}

const owner = Object.freeze({ actor: 'owner', principalId: 'owner' });

function gitRepo(label) {
  const root = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'master'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue456@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 456'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# issue 456\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

/** A fixture adapter that advertises the routes it is handed. Its card carries the REAL provider
 * refusal table of its harness (`providerRefusalsForHarness`), so a failed turn's own 429 text is
 * evidence about the route exactly as it is on a live card (#341 part 2). */
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
      provenance: 'issue456-fixture',
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

/** The completed turn the probe's own seat ends with — the fact that retires the episode (#442
 * item 2's "a later turn on it succeeds", the same reading #341 uses). */
function succeededTurnRow(route) {
  return {
    worker: 'probe-w', harness: `${route.harness}@1.0.0`, turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'worker',
    harnessResolved: route.harness, modelResolved: route.model, effortResolved: route.effort,
    payload: { status: 'completed', summary: 'the probe answered', usageSeal: null },
  };
}

const usageRowFor = (rows, route) => rows.find((row) => (
  row.route.harness === route.harness && row.route.model === route.model && row.route.effort === route.effort));

/** The runtime half of the route truth: the deployment's OWN rows are what a recruit compares —
 * read LIVE through `readRows`, so the whole chain (ledger → deployment derivation → recruit) is
 * the subject of every assertion below. */
function routeFixture(readRows) {
  const store = new CoordinationStore(tmpDir('route-swarm'));
  const workers = [];
  const runs = [];
  // The options the Run intent was resolved from — the closed set a deployment's prepareRun reads,
  // so a runtime-only leg leaking into it is visible here.
  const prepared = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => workers, pausedTurns: () => [] },
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
    { swarmId: 'route-swarm', ...(command === 'view' ? {} : { idempotencyKey: `456-${++key}` }), ...args }, owner);
  const rowsOfKind = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, actor: event.actor, seq: event.seq }));
  return { call, runs, store, rowsOfKind, prepared };
}

const refusalOf = async (promise) => {
  try { await promise; return null; } catch (error) { return error; }
};

const liveRows = (deployment) => () => deployment.doctorReadiness().routeUsage;

// ── (a) the provider's own zone, declared once ───────────────────────────────────────────────────

test('456-a: a zai answer that spells its window in Beijing wall time parses to the instant it meant', () => {
  const text = quotaText(ZONE_LESS_RESET);
  const fault = classifyProviderFault({ code: '429', errorMessage: text }, { route: ZAI_ROUTE });

  assert.equal(fault.code, PROVIDER_FAULT_CODES.quota, 'the answer is the quota class');
  assert.equal(providerFaults.PROVIDER_RESET_ZONES?.zai, '+08:00',
    'the provider zone table is ONE declaration: zai answers Beijing wall time');
  assert.equal(fault.detail.resetAt, ZAI_RESET_AT,
    "the zone-less answer parses against the provider's OWN zone, never as UTC");
  assert.equal(fault.detail.resetAtText, ZONE_LESS_RESET,
    "and the provider's own words still ride beside the instant");

  // The zone is a fact about the PROVIDER, not about the parse: the same string under a provider
  // nothing documents derives no instant — a fabricated one is worse than none.
  const undocumented = classifyProviderFault({ code: '429', errorMessage: text },
    { route: { harness: 'mock', model: 'mock-model', effort: 'low' } });
  assert.equal(undocumented.detail.resetAt, null,
    'a provider whose zone nothing documents still derives no instant');
  assert.equal(undocumented.detail.resetAtText, ZONE_LESS_RESET, 'its own text is kept');

  // An answer that QUALIFIES its own zone wins over the table, and the table answers for the one
  // reading the deployment does itself (`parseProviderResetAt(text, {provider})`).
  assert.equal(parseProviderResetAt(quotaText(`${ZONE_LESS_RESET}Z`), { provider: 'zai' }),
    `${ZONE_LESS_RESET.replace(' ', 'T')}.000Z`, 'an explicit zone is honored');
  assert.equal(parseProviderResetAt(text, { provider: 'zai' }), ZAI_RESET_AT,
    'and the provider table answers for the zone-less spelling');
  assert.equal(parseProviderResetAt(text), null, 'no provider, no zone, no invented instant');
});

test('456-b: the deployment reads a zai route\'s zone-less refusal at the instant the provider meant', async (t) => {
  const { deployment, log } = await openDeployment(t, 'zai-zone', [ZAI_ROUTE]);
  const now = Date.now();
  // The incident's own answer, with the window still closed: the route is blocked until the
  // instant the provider MEANT — 18:07:32 Beijing — and not forever.
  const wall = wallClock(now + 2 * HOUR_MS, ZAI_OFFSET_MINUTES);
  const meant = Date.parse(`${wall.replace(' ', 'T')}Z`) - ZAI_OFFSET_MINUTES * 60_000;
  log.append(failedTurnRow(ZAI_ROUTE, { text: quotaText(wall), resetAtText: wall }));

  const row = usageRowFor((await deployment.doctor()).routeUsage, ZAI_ROUTE);
  // The route's own refusal reading is where the deployment parses the provider's words itself
  // (#341 part 2), and it is read against the SAME provider zone the typed fault is: the block this
  // route carries must expire at the instant the provider MEANT, never at an invented UTC one.
  assert.equal(row.lastProviderRefusal?.code, PROVIDER_FAULT_CODES.quota, 'the refusal is the quota class');
  assert.equal(row.lastProviderRefusal?.resetAt, new Date(meant).toISOString(),
    'read against the provider zone, so the block expires at the instant it meant');
  assert.ok(Date.parse(row.lastProviderRefusal.resetAt) > now,
    'and the instant is still ahead, so the block it derives is live rather than already lapsed');
});

// ── (b) a null-reset degrade names its next step ─────────────────────────────────────────────────

test('456-c: a degrade whose provider named no instant carries probeAfter (its own window) and clearsAt', async (t) => {
  const { deployment, log } = await openDeployment(t, 'probe-instant', [DEGRADED_ROUTE, READY_ROUTE]);
  const now = Date.now();
  // The provider refused 30 minutes ago, naming a ONE hour window in its own text and a zone-less
  // reset instant — so the probe instant is the fault's own window, never the registry fallback.
  const faultAt = now - 30 * 60_000;
  const wall = wallClock(faultAt - 2 * HOUR_MS, ZAI_OFFSET_MINUTES);
  log.append(failedTurnRow(DEGRADED_ROUTE, { text: quotaText(wall, '1 hour') }));
  log.append(degradedRow(DEGRADED_ROUTE, { at: faultAt, resetAt: null, resetAtText: wall }));

  const doctor = await deployment.doctor();
  const degraded = usageRowFor(doctor.routeUsage, DEGRADED_ROUTE);
  assert.ok(degraded.degraded, 'the route its provider faulted reads degraded');
  assert.equal(degraded.degraded.resetAt, null, 'the provider zone-qualified no instant');
  assert.equal(degraded.degraded.resetAtText, wall, 'so its own words are what the row keeps');
  const windowTo = Date.parse(degraded.degraded.window.to);
  assert.equal(Date.parse(degraded.degraded.probeAfter), windowTo + HOUR_MS,
    "probeAfter is the fault's OWN window, measured from the fault");
  assert.equal(degraded.degraded.clearsAt, degraded.degraded.probeAfter,
    'with no resetAt the probe instant IS the clear — the row never sits degraded with no next step');
  assert.ok(Date.parse(degraded.degraded.clearsAt) > Date.now(), 'and this one has not cleared yet');

  // The registry row is the fallback for a fault whose text names no window at all.
  assert.equal(registryProbeMs(), 5 * HOUR_MS,
    "the limits registry declares the fault-probe window (the window this fleet's providers publish)");
  const silent = await openDeployment(t, 'probe-fallback', [DEGRADED_ROUTE, READY_ROUTE]);
  silent.log.append(degradedRow(DEGRADED_ROUTE, { at: faultAt, resetAt: null, resetAtText: wall }));
  const silentRow = usageRowFor((await silent.deployment.doctor()).routeUsage, DEGRADED_ROUTE);
  assert.equal(Date.parse(silentRow.degraded.probeAfter),
    Date.parse(silentRow.degraded.window.to) + registryProbeMs(),
    'a fault that names no window falls back to the registry row');

  // And the recruit refusal names the clear and the remedy — never a wall with no next step.
  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe instant' });
  const error = await refusalOf(fixture.call('recruit',
    { participantId: 'lane-1', objective: 'work', options: { exact: DEGRADED_ROUTE } }));
  assert.equal(error?.code, 'route_degraded', 'a recruit before the clear refuses typed');
  assert.equal(error.detail?.clearsAt, degraded.degraded.clearsAt, 'the refusal names when the route clears');
  assert.equal(error.detail?.probeAfter, degraded.degraded.probeAfter, 'and the probe instant itself');
  assert.ok(error.message.includes(degraded.degraded.clearsAt), 'the message names it too');
  assert.match(error.message, /routeProbe/u, 'and the remedy that admits one probe by hand');
  assert.deepEqual(fixture.runs, [], 'the refusal precedes every effect');
});

// ── (c) the probe: ONE recruit, and its outcome decides ──────────────────────────────────────────

test('456-d: after clearsAt ONE recruit is admitted as a probe, and a second refuses while it is out', async (t) => {
  const { deployment, log } = await openDeployment(t, 'probe-admit', [DEGRADED_ROUTE, READY_ROUTE]);
  const now = Date.now();
  // The provider's window already reopened (fault 3 h ago, a 1 h window): the probe is due.
  const faultAt = now - 3 * HOUR_MS;
  const wall = wallClock(faultAt - 2 * HOUR_MS, ZAI_OFFSET_MINUTES);
  log.append(failedTurnRow(DEGRADED_ROUTE, { text: quotaText(wall, '1 hour') }));
  log.append(degradedRow(DEGRADED_ROUTE, { at: faultAt, resetAt: null, resetAtText: wall }));

  const due = usageRowFor((await deployment.doctor()).routeUsage, DEGRADED_ROUTE).degraded;
  assert.ok(Date.parse(due.clearsAt) < Date.now(), "the episode's own clear is in the past — a probe is due");

  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe due' });

  const admitted = await fixture.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: DEGRADED_ROUTE } });
  assert.equal(admitted.admission?.state, 'admitted', 'the due probe is admitted');
  assert.equal(admitted.admission?.kind, 'probe', 'and the receipt says it was the probe');
  assert.equal(admitted.admission?.probe?.route?.effort, DEGRADED_ROUTE.effort);
  assert.equal(admitted.admission?.probe?.clearsAt, due.clearsAt, 'beside the clear it is testing');
  assert.equal(fixture.runs.length, 1, 'the probe is a real recruit — its turn is the test');

  const probes = fixture.rowsOfKind('route.probe_admitted');
  assert.equal(probes.length, 1, 'the probe admission is durable — ONE row');
  assert.equal(probes[0].actor, 'owner', 'naming the actor that admitted it');
  assert.equal(probes[0].route.effort, DEGRADED_ROUTE.effort);
  assert.equal(probes[0].reason, 'probe_due', 'recorded as the probe its own clear instant opened');

  // ONE probe: while the admitted probe's turn is unanswered, the next recruit refuses — the route
  // is still degraded, and the refusal names the probe that is already out.
  const second = await refusalOf(fixture.call('recruit',
    { participantId: 'lane-2', objective: 'work', options: { exact: DEGRADED_ROUTE } }));
  assert.equal(second?.code, 'route_degraded', 'a second recruit refuses while the probe is out');
  assert.equal(second.detail?.probeInFlight, true, 'naming the probe that is out');
  assert.equal(fixture.runs.length, 1, 'and no second run started');
});

test('456-e: a successful probe turn clears the degrade and is recorded; a provider fault re-arms it', async (t) => {
  const { deployment, log } = await openDeployment(t, 'probe-outcome', [DEGRADED_ROUTE, READY_ROUTE]);
  const now = Date.now();
  const faultAt = now - 3 * HOUR_MS;
  const wall = wallClock(faultAt - 2 * HOUR_MS, ZAI_OFFSET_MINUTES);
  log.append(failedTurnRow(DEGRADED_ROUTE, { text: quotaText(wall, '1 hour') }));
  log.append(degradedRow(DEGRADED_ROUTE, { at: faultAt, resetAt: null, resetAtText: wall }));

  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'probe outcome' });
  const probe = await fixture.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: DEGRADED_ROUTE } });
  assert.equal(probe.admission?.kind, 'probe', 'the probe is what is admitted');

  // The probe's turn ANSWERED — a completed turn on the route retires the episode by derivation.
  log.append(succeededTurnRow(DEGRADED_ROUTE));
  const cleared = usageRowFor((await deployment.doctor()).routeUsage, DEGRADED_ROUTE);
  assert.equal(cleared.degraded, null, 'the successful probe clears the degrade');
  assert.equal(cleared.state, 'ready');

  // …and the runtime records the clearing it observes, so the ledger shows the episode closed and
  // the next seat is admitted normally rather than as another probe.
  const next = await fixture.call('recruit',
    { participantId: 'lane-next', objective: 'work', options: { exact: DEGRADED_ROUTE } });
  assert.equal(next.admission.state, 'admitted', 'recruits are admitted again');
  assert.equal(next.admission.kind ?? null, null, 'a normally admitted seat is no probe');
  const recovered = fixture.rowsOfKind('route.recovered');
  assert.equal(recovered.length, 1, 'the clearing is recorded — route.recovered');
  assert.equal(recovered[0].route.effort, DEGRADED_ROUTE.effort);
  assert.equal(recovered[0].probeAdmissionSeq, probe.admission.probe.seq ?? null,
    'naming the probe admission that answered');

  // A FAILED probe re-arms: the probe died with the same provider fault, so the fold extends the
  // episode to the new death and the next probeAfter moves with it.
  const rearmed = await openDeployment(t, 'probe-rearm', [DEGRADED_ROUTE, READY_ROUTE]);
  const windowAt = Date.now() - 3 * HOUR_MS;
  const wall2 = wallClock(windowAt - 2 * HOUR_MS, ZAI_OFFSET_MINUTES);
  rearmed.log.append(failedTurnRow(DEGRADED_ROUTE, { text: quotaText(wall2, '1 hour') }));
  rearmed.log.append(degradedRow(DEGRADED_ROUTE, { at: windowAt, resetAt: null, resetAtText: wall2 }));
  const before = usageRowFor((await rearmed.deployment.doctor()).routeUsage, DEGRADED_ROUTE).degraded;
  assert.ok(Date.parse(before.clearsAt) < Date.now(), 'the first probe is due');

  // The probe's turn died with the same provider fault: the fold extends the episode to that death.
  rearmed.log.append(degradedRow(DEGRADED_ROUTE, { at: Date.now() - 60_000, resetAt: null, resetAtText: wall2 }));
  const after = usageRowFor((await rearmed.deployment.doctor()).routeUsage, DEGRADED_ROUTE).degraded;
  assert.ok(Date.parse(after.probeAfter) > Date.parse(before.probeAfter),
    "the re-armed episode's probe instant is later than the first window's");
  assert.equal(Date.parse(after.probeAfter), Date.parse(after.window.to) + HOUR_MS,
    "measured from the new death, with the fault's own window");

  const rearmedFixture = routeFixture(liveRows(rearmed.deployment));
  await rearmedFixture.call('create', { purpose: 're-armed' });
  const refused = await refusalOf(rearmedFixture.call('recruit',
    { participantId: 'lane-again', objective: 'work', options: { exact: DEGRADED_ROUTE } }));
  assert.equal(refused?.code, 'route_degraded', 'the re-armed route refuses until its next probe instant');
  assert.equal(refused.detail?.clearsAt, after.clearsAt, 'naming the new clear');
});

// ── (d) the operator override ────────────────────────────────────────────────────────────────────

test('456-f: options.routeProbe admits one recruit onto a live degrade, recorded as route.probe_admitted {actor}', async (t) => {
  const { deployment, log } = await openDeployment(t, 'probe-override', [DEGRADED_ROUTE, READY_ROUTE]);
  const now = Date.now();
  // A LIVE degrade: the provider's answer named no instant, and its own window has not passed yet.
  const faultAt = now - 60_000;
  const wall = wallClock(faultAt - 2 * HOUR_MS, ZAI_OFFSET_MINUTES);
  log.append(failedTurnRow(DEGRADED_ROUTE, { text: quotaText(wall, '5 hour') }));
  log.append(degradedRow(DEGRADED_ROUTE, { at: faultAt, resetAt: null, resetAtText: wall }));

  const degraded = usageRowFor((await deployment.doctor()).routeUsage, DEGRADED_ROUTE).degraded;
  assert.ok(Date.parse(degraded.clearsAt) > Date.now(), 'nothing is due yet');

  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'override' });
  const plain = await refusalOf(fixture.call('recruit',
    { participantId: 'lane-plain', objective: 'work', options: { exact: DEGRADED_ROUTE } }));
  assert.equal(plain?.code, 'route_degraded', 'a plain recruit is refused');

  const override = await fixture.call('recruit', {
    participantId: 'lane-override', objective: 'work',
    options: { exact: DEGRADED_ROUTE, routeProbe: true },
  });
  assert.equal(override.admission?.state, 'admitted', 'the override admits onto the live degrade');
  assert.equal(override.admission?.kind, 'probe', "as a probe, so the route's outcome is re-read");
  assert.equal(override.admission?.probe?.reason, 'operator_override', 'naming the override as its reason');
  assert.equal(override.admission?.probe?.clearsAt, degraded.clearsAt, 'beside the clear it bypassed');

  const probes = fixture.rowsOfKind('route.probe_admitted');
  assert.equal(probes.length, 1, 'the override is durable');
  assert.equal(probes[0].actor, 'owner', 'and names the actor that made it');
  assert.equal(probes[0].reason, 'operator_override', 'recorded as the override, never as a due probe');
  assert.equal(probes[0].clearsAt, degraded.clearsAt);
  // …and the flag is the RUNTIME's own leg: the deployment's prepareRun resolves a closed option
  // set, so the override must never be handed to it as part of the Run intent.
  assert.equal(Object.hasOwn(fixture.prepared.at(-1) ?? {}, 'routeProbe'), false,
    'the operator flag never reaches the Run intent');
  assert.deepEqual(fixture.prepared.at(-1)?.exact, DEGRADED_ROUTE, 'while the route the caller named does');
});

// ── (e) the CLI spelling ─────────────────────────────────────────────────────────────────────────

test('456-g: the CLI carries the operator\'s probe as options.routeProbe, and declares no probe flag', () => {
  // ONE spelling: the runtime reads `options.routeProbe`, and the recruit's own `--options` flag —
  // the flag the usage line teaches — is what carries it.
  const parsed = parseBatonCli(['--idempotency-key', 'k456', 'swarm', 'recruit', 'wave', 'seat-1', 'work',
    '--options', JSON.stringify({ exact: DEGRADED_ROUTE, routeProbe: true })]);
  assert.equal(parsed.name, 'swarm.recruit');
  assert.equal(parsed.args.options.routeProbe, true, 'the wire field is options.routeProbe');
  assert.deepEqual(parsed.args.options.exact, DEGRADED_ROUTE, 'beside the options the caller named');

  // …and no `--route-probe` token exists to be offered as a remedy (#475): the closed argv refuses
  // it exactly as it refuses any other invented flag, naming the flags the verb DOES admit.
  let refused = null;
  try {
    parseBatonCli(['--idempotency-key', 'k458', 'swarm', 'recruit', 'wave', 'seat-1', 'work',
      '--options', JSON.stringify({ exact: DEGRADED_ROUTE }), '--route-probe']);
  } catch (error) { refused = error; }
  assert.ok(refused, '--route-probe is not an admitted recruit flag');
  assert.equal(refused.detail?.field, '--route-probe', 'the parse refuses it by name');
  assert.equal(refused.detail?.rule, 'closed-set', 'the #431 closed-set shape');
  assert.ok(refused.detail?.admitted?.includes('--options'), 'naming the flag that carries the probe');

  // Absent, it stays absent: a pre-#456 recruit parses byte-identically.
  const plain = parseBatonCli(['--idempotency-key', 'k457', 'swarm', 'recruit', 'wave', 'seat-1', 'work']);
  assert.equal(plain.idempotencyKey, 'k457');
  assert.deepEqual(plain.args, { swarmId: 'wave', participantId: 'seat-1', objective: 'work',
    idempotencyKey: 'k457' });
});
