// [attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-146]
// seat-telemetry-red.test.mjs — red-first acceptance suite for the FOLDED #146 fleet
// seat-telemetry contract (contract-foundry-2026-08-13/contract-146.md, v1.1 fold).
//
// Surfaces under test: the deployment doctor (`deployment.doctor`, D2.1), the raw
// application doctor (`doctorReadiness`, D2.1 Fold A5), the `waves.list` capacity block
// (D2.2), the deployment card inheritance (D2.4), and the surface teaching (D2.3 / #159).
//
// ROW INVENTORY (each row is RED at HEAD — the stage assertion fails, the deeper
// assertions are the contract's GREEN condition):
//   A-L   fixture lint — the machinery the rows lean on is REAL at HEAD (green guard).
//   A1    doctor seats, enumerable + observedAtEventSeq + card inheritance      (D1/D2.1/D2.4)
//   A2    deferred === §D5 Arm-1 aggregate, single-pass, dedup by route key      (D1.2/D2.2/A4/A6)
//   A3    waves.list capacity block, BOTH roster forms (object via _runWaveRoute) (D2.2/A3)
//   A4    null honesty, ONE occupancy source (auto: 0 or >1 eligible → null)      (D1.2/A4/A5)
//   A5    replay-consistent label + split live label (no clocks)                  (D3/B3)
//   A6    vendor-scoped honesty (two routes, one vendor, identical counts)        (D1.2/A6)
//   A7    surface teaching (#159): doctor + waves.list + CLI prose                 (D2.3)
//   A8    additive landing + the occupancy-value correction (numeric→null)        (B2/A8)
//   A9    ALLOCATOR BINDING — wave path + doctor path, 3 legs (LOAD-BEARING)      (D1.1/B1)
//   A10   SINGLE OCCUPANCY SOURCE — occupancy === seats for every route           (D2.1/B2)
//   A11   LIVE-COMPONENT FRESHNESS — inFlightRevision, never a clock              (D3/B3)
//
// DISCRIMINATOR LAW (why each fixture separates the correct binding from `adapterFor`):
//   The allocator's explicit path (`_resolveExplicitRoute`, coordinator.mjs:2994-3034)
//   does NOT gate on `turnCompletion: 'pausable'`; `adapterFor` (route-liveness.mjs:121-129)
//   DOES (routeMatches gates pausable at :35-47). So a NON-pausable MockAdapter makes
//   `adapterFor(route)` null while the allocator resolves the harness — a wrong impl reading
//   `adapterFor` can never match the allocator's counts. And a route with >1 auto-eligible
//   adapter (mock + sibling both advertising mock-model/low) makes the allocator's auto path
//   read honest-null while `adapterFor` still reads the harness-keyed 'mock' numeric counts.
//
// Execution contract (reviewer enforces): executable `true`, argv `[]`, cwd `.`,
// expected exit 0. Run from the repo root with `node --test impl/test/seat-telemetry-red.test.mjs`.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { MockAdapter, BatonApplication, bindBaton, createDriver, openBaton } from '../src/index.mjs';

const REPO_ID = 'repo-seat-telemetry-146';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const ROUTE2 = Object.freeze({ harness: 'mock', model: 'mock-model-2', effort: 'low' });

// ---------------------------------------------------------------------------
// Fixture machinery
// ---------------------------------------------------------------------------

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-146-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

// A MockAdapter whose card override controls pausability + ceiling + modelSelection,
// with a blocking-decision scenario that keeps any dispatched handle 'working' until
// answered — a live, in-flight seat.
function adapter(harness, { model = 'mock-model', available = null, ceiling = 4, pausable = false } = {}) {
  const inst = new MockAdapter({
    harness,
    scenario: {
      outcome: 'completed',
      ask: { kind: 'decision', question: 'continue?', options: ['proceed', 'halt'], afterEditIndex: 0 },
      summary: 'seat-telemetry fixture', files: {},
    },
  });
  const baseCard = inst.card.bind(inst);
  inst.card = () => ({
    ...baseCard(),
    ...(pausable ? { turnCompletion: 'pausable' } : {}),
    concurrencyCeiling: ceiling,
    modelSelection: {
      mode: 'exact', configuredDefault: model, available: available ?? [model],
      family: harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null, provenance: 'seat-telemetry-146', refreshedAt: null,
    },
  });
  return inst;
}

const goalPlanAuthority = {
  policy: Object.freeze({
    schemaVersion: 1, repoId: REPO_ID, mandatory: true,
    approvalTtlMs: 60 * 60 * 1_000,
    riskClasses: ['low', 'medium', 'high', 'critical'],
    effectClasses: ['repository_edit', 'provider_call'],
    capabilityClasses: ['code', 'test'],
    limits: Object.freeze({
      maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
      maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
      maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
      maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
    }),
  }),
  authorize: async () => true,
};

function buildApplication(driver, deploymentId, routes) {
  const base = {
    driver, repoId: REPO_ID,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId: REPO_ID,
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536, requiredPredecessorEvidence: [] },
        routes,
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  };
  try { return new BatonApplication({ ...base, deploymentId }); }
  catch (error) {
    if (error?.code !== 'application_config_invalid') throw error;
    return new BatonApplication(base);
  }
}

// Bounded wait for an async transition (dispatch is synchronous within the approval
// chain; a couple of macrotask turns settle microtask ordering).
async function until(fn, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function openHost(t, { adapters, routes = [ROUTE] } = {}) {
  const repo = root('host');
  const logDir = mkdtempSync(join(tmpdir(), 'baton-146-log-'));
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir, adapters,
    stopDeadlineMs: 2_000, goalPlanAuthority,
  });
  const deploymentId = `deployment-${createHash('sha256').update(`${repo}|${logDir}`).digest('hex').slice(0, 32)}`;
  const application = buildApplication(driver, deploymentId, routes);
  const baton = bindBaton(application, principal('wave-owner'));
  const host = { repo, logDir, driver, application, baton, deploymentId };
  t.after(async () => {
    await application.shutdown(principal('cleanup')).catch(() => {});
    try { driver.coordination.releaseWriterLease(); } catch { /* already released by shutdown */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return host;
}

const memberExact = (role, objective, route = ROUTE) => ({
  role, objective, exact: { ...route }, scope: ['reports/**'],
});

async function startWave(application, ik, members) {
  return application.command('waves.start', { idempotencyKey: ik, members }, principal('wave-owner'));
}

// The auto candidate set the allocator's auto path would build for a route's model/effort
// (D1.1 doctor path): every adapter whose card passes resolveCardModel + resolveEffort.
// The session gate `{mode: 'new'}` always passes (cardSupportsSession, coordinator.mjs:774-777).
function autoEligibleSet(driver, route) {
  const names = [];
  for (const [name, ad] of Object.entries(driver.coordinator._adapters)) {
    const selection = ad.card()?.modelSelection;
    const modelOk = selection?.mode === 'exact'
      && (Array.isArray(selection.available) ? selection.available.includes(route.model)
        : selection.configuredDefault === route.model || selection.acceptedAliases?.includes(route.model));
    const effortOk = Array.isArray(selection?.reasoningEffort) && selection.reasoningEffort.includes(route.effort);
    if (modelOk && effortOk) names.push(name);
  }
  return names;
}

// The D1 atom's closed key set, in sorted order.
const ATOM_KEYS = ['ceiling', 'deferred', 'inFlight', 'inFlightRevision', 'route', 'state'];

function assertAtom(atom, label) {
  assert.deepEqual(Object.keys(atom).sort(), ATOM_KEYS, `${label}: closed D1 atom key set`);
  assert.ok(atom.route && typeof atom.route === 'object' && atom.route.harness === 'mock',
    `${label}: route identity present`);
  assert.equal(typeof atom.state, 'string', `${label}: state is never null`);
}

// ---------------------------------------------------------------------------
// A-L — fixture lint: the machinery every RED row leans on is REAL at HEAD.
// Each lint asserts the EXISTING machinery (dispatch, ceiling-skip receipt, the
// pausable-vs-non-pausable adapterFor divergence) — a fixture premise that fails
// here fails the whole row for the wrong reason.
// ---------------------------------------------------------------------------

test('A-L (lint): blocking-decision dispatch holds a working seat; ceiling-skip mints the receipt; adapterFor diverges on pausability', async (t) => {
  const host = await openHost(t, { adapters: { mock: adapter('mock', { ceiling: 1 }) } });
  const wave = await startWave(host.application, 'lint-1', [memberExact('alpha', 'lint alpha')]);
  const runId = wave.members[0].runId;
  await host.baton.runs.open(runId).approve();
  await until(() => host.driver.coordinator._inFlightCount('mock') === 1, 'member working');
  assert.equal(host.driver.coordinator._inFlightCount('mock'), 1,
    'lint: the blocking-decision scenario holds one live seat on the allocator-resolved vendor');

  // Second member on the same route is ceiling-skipped → the receipt is minted.
  const wave2 = await startWave(host.application, 'lint-2', [memberExact('beta', 'lint beta')]);
  await host.baton.runs.open(wave2.members[0].runId).approve();
  const receipts = await until(() => {
    const all = host.driver.coordination.events().filter((ev) => (
      ev.kind === 'task.dispatch_deferred' || ev.payload?.kind === 'task.dispatch_deferred'
    ));
    return all.length === 1 ? all : null;
  }, 'ceiling-skip receipt minted');
  assert.equal(receipts[0].payload?.vendor ?? receipts[0].vendor, 'mock',
    'lint: the receipt names the allocator-resolved vendor (ceiling-skip is vendor-scoped)');

  // Premise: the discriminator depends on routeMatches gating adapterFor on pausability.
  const liveness = readFileSync(join('impl', 'src', 'route-liveness.mjs'), 'utf8');
  assert.ok(/turnCompletion\s*!==\s*'pausable'/u.test(liveness),
    'lint: routeMatches gates on turnCompletion pausable — a non-pausable MockAdapter is invisible to adapterFor, so the parallel binding can never match the allocator');
});

// ---------------------------------------------------------------------------
// A1 — doctor seats, enumerable + observedAtEventSeq + card inheritance (D1/D2.1/D2.4)
// ---------------------------------------------------------------------------

test('A1 (stage: doctor-seats-missing): deployment.doctor carries an enumerable seats array, one closed D1 atom per readiness route in route order, observedAtEventSeq, and the card inherits seats (D2.4)', async (t) => {
  const repo = root('a1');
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(mkdtempSync(join(tmpdir(), 'baton-146-dep-a1-')), 'dep'),
      adapters: { mock: adapter('mock', { ceiling: 4 }) },
      routes: [ROUTE],
      verification: { command: 'true', arguments: [] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch { /* fixture teardown */ } });

  const doctor = await deployment.doctor();
  assert.ok('seats' in doctor,
    'stage: doctor-seats-missing — at HEAD doctorReadiness attaches occupancy NON-enumerably and no seats array exists (contract-146 A1 RED; application-deployment.mjs:1346-1349)');

  // One atom per readiness route, in readiness route order.
  assert.ok(Array.isArray(doctor.seats), 'seats is an array');
  assert.equal(doctor.seats.length, doctor.routes.length, 'one seat atom per readiness route');
  assert.ok(Number.isSafeInteger(doctor.observedAtEventSeq),
    'the response carries observedAtEventSeq — an event seq, never wall time (D3)');
  for (let i = 0; i < doctor.seats.length; i++) {
    assertAtom(doctor.seats[i], `A1 seats[${i}]`);
    assert.equal(doctor.seats[i].route.harness, doctor.routes[i].harness, 'route identity tracks the readiness route');
    assert.equal(doctor.seats[i].route.model, doctor.routes[i].model, 'model tracks the readiness route');
    assert.equal(doctor.seats[i].route.effort, doctor.routes[i].effort, 'effort tracks the readiness route');
    assert.equal(doctor.seats[i].state, doctor.routes[i].state, 'state tracks readiness, never a liveness probe');
  }
  // Single eligible vendor (mock only, non-pausable): the allocator's auto path names it,
  // so the atom reads REAL numbers — 0 is an observable zero (D1.2 honesty table).
  assert.equal(doctor.seats[0].inFlight, 0, 'inFlight: real zero for an empty live seat set');
  assert.equal(doctor.seats[0].ceiling, 4, 'ceiling: the card-declared concurrencyCeiling');
  assert.equal(doctor.seats[0].deferred, 0, 'deferred: honest zero — no pending-with-receipt task');

  // Card inheritance (D2.4): card() composes doctorReadiness, so the card carries the same seats.
  const card = deployment.card();
  assert.ok(card?.readiness && 'seats' in card.readiness,
    'stage-2: card-seats-missing — card() composes doctorReadiness so seats inherit (D2.4 GREEN condition)');
  assert.deepEqual(card.readiness.seats, doctor.seats, 'the card carries byte-identical seats to the doctor');
  assert.equal(card.readiness.observedAtEventSeq, doctor.observedAtEventSeq, 'the card inherits observedAtEventSeq');
  rmSync(repo, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A2 — deferred === §D5 Arm-1 aggregate, single-pass, dedup by route key (D1.2/D2.2/A4/A6)
// ---------------------------------------------------------------------------

test('A2 (stage: capacity-deferred-missing): a ceiling-skipped wave member reads deferred === 1 on the wave capacity atom, deduped by route key — the §D5 Arm-1 aggregate, never the mint-time-frozen inFlight', async (t) => {
  const host = await openHost(t, { adapters: { mock: adapter('mock', { ceiling: 1 }) } });

  // Two members on the SAME route; the first holds the live seat, the second is ceiling-skipped.
  const wave = await startWave(host.application, 'a2-1', [memberExact('alpha', 'a2 alpha')]);
  await host.baton.runs.open(wave.members[0].runId).approve();
  await until(() => host.driver.coordinator._inFlightCount('mock') === 1, 'alpha working');

  const wave2 = await startWave(host.application, 'a2-2', [memberExact('beta', 'a2 beta')]);
  await host.baton.runs.open(wave2.members[0].runId).approve();
  await until(() => {
    const all = host.driver.coordination.events().filter((ev) => (
      ev.kind === 'task.dispatch_deferred' || ev.payload?.kind === 'task.dispatch_deferred'
    ));
    return all.length === 1 ? all : null;
  }, 'beta ceiling-skipped receipt');

  const listed = await host.application.command('waves.list', {}, principal('wave-owner'));
  assert.ok(listed?.waves?.length >= 2, 'fixture: both waves are open rows');
  const row = listed.waves.find((w) => w.waveId === wave.waveId);
  assert.ok(row, 'fixture: the alpha wave row resolves');
  assert.ok('capacity' in row,
    'stage: capacity-deferred-missing — at HEAD waveList rows carry no capacity block (contract-146 A2 RED; application.mjs:11811-11818)');

  // The capacity block is the closed set of DISTINCT routes: one atom for R despite two members.
  assert.ok(Array.isArray(row.capacity), 'capacity is an array');
  assert.equal(row.capacity.length, 1, 'dedup by route key — two members on R read ONE atom');
  assertAtom(row.capacity[0], 'A2 capacity[0]');
  assert.deepEqual(row.capacity[0].route, { harness: 'mock', model: 'mock-model', effort: 'low' },
    'the capacity atom carries the recovered route identity');
  assert.equal(row.capacity[0].inFlight, 1, 'inFlight reads the live seat (coordinator._inFlightCount(mock))');
  assert.equal(row.capacity[0].deferred, 1,
    'deferred reads the pending-with-receipt count on the vendor — the §D5 Arm-1 aggregate (D1.2), not the mint-time-frozen inFlight of the receipt');
  assert.equal(typeof row.capacity[0].state, 'string', 'state is never null');
  assert.ok(Number.isSafeInteger(listed.observedAtEventSeq), 'the response carries observedAtEventSeq (D2.2)');

  // The pin's dynamic clauses — "after a task claims (dispatches), the count drops by one;
  // a cancelled task also leaves it" — are covered BY THE FORMULA: deferred is derived per-read
  // from the set of pending-with-receipt tasks on the vendor, so a claim removes its task from
  // that set by construction (drop-by-one) and a cancel leaves the receipt (count persists).
  // Forcing a claim in this fixture is NOT constructible at HEAD (judgment call, suite-notes §4):
  // the MockAdapter's blocking decision is never delivered to the run's decision surface
  // (decisionList/attention/blockedInteraction stay empty in the wave path), and run.stop leaves
  // the holder's handle 'stopping' — which _inFlightCount (working|stopping|blocked,
  // coordinator.mjs:3039-3045) still counts, so the seat never frees for a re-dispatch in the
  // observation window. The aggregate VALUE and its single-pass derivation are the asserted truth.
});

// ---------------------------------------------------------------------------
// A3 — waves.list capacity block, BOTH roster forms (D2.2/A3)
// ---------------------------------------------------------------------------

test('A3 (stage: waves-capacity-missing): object-roster waves render the capacity block via _runWaveRoute; run-less legacy string-roster waves render capacity: [] — the honest object-roster answer', async (t) => {
  const host = await openHost(t, { adapters: { mock: adapter('mock', { ceiling: 4 }) } });

  // Leg (a) — OBJECT-roster wave (the direct-port member shape). The capacity derivation
  // recovers each member's route via _runWaveRoute (Fold A3), NOT a route field on the
  // member row (the object branch has none).
  const wave = await startWave(host.application, 'a3-obj', [memberExact('alpha', 'a3 object alpha')]);
  await host.baton.runs.open(wave.members[0].runId).approve();
  await until(() => host.driver.coordinator._inFlightCount('mock') === 1, 'a3 member working');

  // Leg (b) — a legacy STRING-roster wave (interpreter seam, wave.mjs:180): run-less
  // members, routes unrecoverable → the honest object-roster answer is capacity: [].
  const legacyWaveId = `wave:${createHash('sha256').update('a3-legacy').digest('hex').slice(0, 32)}`;
  const recorded = host.driver.coordination.recordDriver('wave.started', {
    waveId: legacyWaveId, roster: ['gamma', 'delta'], idempotencyKey: 'a3-legacy-ik',
  }, { actor: 'test', key: `wave.started:${legacyWaveId}` });
  assert.equal(recorded.ok, true, 'fixture: the legacy string-array roster appends');

  const listed = await host.application.command('waves.list', {}, principal('wave-owner'));
  const objRow = listed.waves.find((w) => w.waveId === wave.waveId);
  const legacyRow = listed.waves.find((w) => w.waveId === legacyWaveId);
  assert.ok(objRow && legacyRow, 'fixture: both waves are open rows');

  assert.ok('capacity' in objRow && 'capacity' in legacyRow,
    'stage: waves-capacity-missing — at HEAD waveList rows carry no capacity block in EITHER roster form (contract-146 A3 RED; application.mjs:11811-11818)');

  assert.ok(Array.isArray(objRow.capacity) && objRow.capacity.length === 1, 'object-roster wave has one capacity atom');
  assertAtom(objRow.capacity[0], 'A3 obj capacity[0]');
  assert.deepEqual(objRow.capacity[0].route, { harness: 'mock', model: 'mock-model', effort: 'low' },
    'object-roster route recovered via _runWaveRoute (Fold A3)');
  assert.equal(objRow.capacity[0].inFlight, 1, 'the recovered-route atom reads the allocator-bound live count');

  // The pinned member row (wave-observability A3-1 five keys) is byte-unchanged.
  assert.deepEqual(Object.keys(objRow.roster[0]).sort(), ['attentionCount', 'liveness', 'phase', 'progressClass', 'role'],
    'A3-1: the object member row stays the closed five-key render — capacity is a WAVE-row sibling');
  for (const m of objRow.roster) {
    assert.equal(Object.hasOwn(m, 'route'), false, 'the object member row has no route field (capacity is the sibling)');
  }

  assert.ok(Array.isArray(legacyRow.capacity) && legacyRow.capacity.length === 0,
    'run-less string-roster wave renders capacity: [] — the honest object-roster answer (Fold A3)');
  assert.ok(Number.isSafeInteger(listed.observedAtEventSeq), 'the response carries observedAtEventSeq');
});

// ---------------------------------------------------------------------------
// A4 — null honesty, ONE occupancy source (D1.2/A4/A5)
// ---------------------------------------------------------------------------

test('A4 (stage: doctor-seats-missing): an auto route with >1 eligible candidate, or 0 eligible (saturated), reads all-null — never a fabricated number', async (t) => {
  // Leg (a) — >1 eligible: mock + sibling both auto-eligible for R, no runs.
  const host = await openHost(t, {
    adapters: { mock: adapter('mock', { pausable: true }), sibling: adapter('sibling', { pausable: true }) },
  });
  assert.equal(autoEligibleSet(host.driver, ROUTE).length, 2,
    'fixture: the auto candidate set for R has exactly 2 eligible members');
  const doctor = host.application.doctorReadiness();
  assert.ok('seats' in doctor,
    'stage: doctor-seats-missing — at HEAD the raw doctor has no seats array (contract-146 A4/A5 RED)');
  assert.equal(doctor.seats.length, doctor.routes.length, 'one atom per profile route');
  assert.equal(doctor.seats[0].inFlight, null,
    'auto-ambiguity (>1 eligible) reads honest-null — the router pick is load/adaptive history, unpredictable from route identity alone (D1.1)');
  assert.equal(doctor.seats[0].ceiling, null, 'no vendor resolves → no card to read');
  assert.equal(doctor.seats[0].deferred, null, 'no vendor resolves → no dispatch could defer onto it');
  assert.equal(doctor.seats[0].inFlightRevision, null, 'no vendor resolves → no handle registry to read a revision for');
  assert.equal(doctor.seats[0].state, 'ready', 'state is the static readiness, never null');

  // Leg (b) — 0 eligible (saturated): one live seat fills the ceiling-1 adapter, so the
  // allocator's auto path has nothing eligible to dispatch → honest-null.
  const host2 = await openHost(t, { adapters: { mock: adapter('mock', { ceiling: 1 }) } });
  const wave = await startWave(host2.application, 'a4-sat', [memberExact('alpha', 'a4 sat alpha')]);
  await host2.baton.runs.open(wave.members[0].runId).approve();
  await until(() => host2.driver.coordinator._inFlightCount('mock') === 1, 'a4 sat working');
  const doctor2 = host2.application.doctorReadiness();
  assert.ok('seats' in doctor2,
    'stage: doctor-seats-missing — at HEAD the raw doctor has no seats array (contract-146 A4/A5 RED)');
  assert.equal(doctor2.seats[0].inFlight, null,
    '0 eligible (the allocator would dispatch nothing) reads honest-null, never 0');
  assert.equal(doctor2.seats[0].state, 'ready', 'the route is still ready — the seat is null because dispatch cannot run, not because the route is blocked');
});

// ---------------------------------------------------------------------------
// A5 — replay-consistent freshness label + split live label (D3/B3)
// ---------------------------------------------------------------------------

test('A5 (stage: seats-freshness-label-missing): seats-bearing reads carry observedAtEventSeq = a ledger event seq (never wall time); the source surfaces carry no marker at HEAD', async (t) => {
  // Shape: the raw doctor response carries the replay-consistent marker.
  const host = await openHost(t, { adapters: { mock: adapter('mock', { ceiling: 4 }) } });
  const doctor = host.application.doctorReadiness();
  assert.ok('observedAtEventSeq' in doctor,
    'stage: seats-freshness-label-missing — at HEAD no seats-bearing read exists, so no replay-consistent label (contract-146 A5 RED)');
  assert.ok(Number.isSafeInteger(doctor.observedAtEventSeq),
    'observedAtEventSeq is an event seq — never wall time (the roster new Date().toISOString() stamp is NOT copied)');

  // Source: the three NUL-free surfaces carry no observedAtEventSeq today (RED).
  const surfaces = ['application-deployment.mjs', 'mcp-northbound.mjs', 'application-cli.mjs'];
  for (const file of surfaces) {
    const source = readFileSync(join('impl', 'src', file), 'utf8');
    assert.ok(source.includes('observedAtEventSeq'),
      `stage: source-marker-absent — ${file} carries no observedAtEventSeq at HEAD (contract-146 A5 RED)`);
  }
});

// ---------------------------------------------------------------------------
// A6 — vendor-scoped honesty (D1.2/A6)
// ---------------------------------------------------------------------------

test('A6 (stage: doctor-seats-missing): two routes resolving to the same adapter read IDENTICAL counts — the record never claims per-route independence', async (t) => {
  const host = await openHost(t, {
    adapters: { mock: adapter('mock', { available: ['mock-model', 'mock-model-2'], ceiling: 4 }) },
    routes: [ROUTE, ROUTE2],
  });
  const doctor = host.application.doctorReadiness();
  assert.ok('seats' in doctor,
    'stage: doctor-seats-missing — at HEAD the raw doctor has no seats array (contract-146 A6 RED)');
  assert.equal(doctor.seats.length, 2, 'two profile routes → two atoms');
  assert.equal(autoEligibleSet(host.driver, ROUTE).join(','), 'mock', 'route 1 auto-resolves to mock');
  assert.equal(autoEligibleSet(host.driver, ROUTE2).join(','), 'mock', 'route 2 auto-resolves to mock');
  assert.equal(doctor.seats[0].inFlight, doctor.seats[1].inFlight, 'identical inFlight across the same vendor');
  assert.equal(doctor.seats[0].ceiling, doctor.seats[1].ceiling, 'identical ceiling across the same vendor');
  assert.equal(doctor.seats[0].deferred, doctor.seats[1].deferred, 'identical deferred across the same vendor');
  assert.equal(doctor.seats[0].inFlightRevision, doctor.seats[1].inFlightRevision,
    'identical inFlightRevision — the revision is the VENDOR\'s counter, not per-route');
});

// ---------------------------------------------------------------------------
// A7 — surface teaching (#159, D2.3)
// ---------------------------------------------------------------------------

test('A7 (stage: surface-teaching-missing): baton_deployment_doctor names seats + the split staleness; baton_waves_list names capacity; the CLI doctor helps with the closed field set', async () => {
  const mcp = readFileSync(join('impl', 'src', 'mcp-northbound.mjs'), 'utf8');
  const cli = readFileSync(join('impl', 'src', 'application-cli.mjs'), 'utf8');

  const doctorTool = mcp.slice(mcp.indexOf('baton_deployment_doctor'), mcp.indexOf('baton_decision_answer'));
  assert.ok(/seats/u.test(doctorTool),
    'stage: surface-teaching-missing — baton_deployment_doctor names no seat capacity at HEAD (contract-146 A7 RED; N2: the current "workspace capacity" wording is the disk probe, not seat capacity)');
  assert.ok(/inFlightRevision/u.test(doctorTool),
    'stage: surface-teaching-missing — the doctor description does not teach the split staleness label (inFlightRevision names the live count, B3)');
  assert.ok(/observedAtEventSeq/u.test(doctorTool),
    'stage: surface-teaching-missing — the doctor description does not teach observedAtEventSeq (ledger parts, B3)');

  const wavesTool = mcp.slice(mcp.indexOf('baton_waves_list'), mcp.indexOf('baton_waves_run'));
  assert.ok(/capacity/u.test(wavesTool),
    'stage: surface-teaching-missing — baton_waves_list names no capacity block at HEAD (contract-146 A7 RED)');

  assert.ok(/seats/u.test(cli),
    'stage: surface-teaching-missing — the CLI doctor help teaches no seats/closed field set at HEAD (contract-146 A7 RED)');
  assert.ok(/deferred/u.test(cli),
    'stage: surface-teaching-missing — the CLI doctor help does not teach what deferred means (strictly "skipped-at-the-ceiling-and-still-pending", A4)');
});

// ---------------------------------------------------------------------------
// A8 — additive landing + the occupancy-value correction (B2/A8)
// ---------------------------------------------------------------------------

test('A8 (stage: doctor-seats-missing): the doctor\'s enumerable route rows stay the DP5 closed set while seats/observedAtEventSeq land as additive siblings, and the occupancy VALUE for an auto-ambiguous route corrects numeric → null', async (t) => {
  const repo = root('a8');
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(mkdtempSync(join(tmpdir(), 'baton-146-dep-a8-')), 'dep'),
      adapters: { mock: adapter('mock', { pausable: true }), sibling: adapter('sibling', { pausable: true }) },
      routes: [ROUTE],
      verification: { command: 'true', arguments: [] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch { /* fixture teardown */ } });

  const doctor = await deployment.doctor();
  // Additive posture guard (GREEN at HEAD): the existing enumerable route row keeps its
  // DP5 closed key set — seats is a sibling, never a field swap.
  assert.deepEqual(Object.keys(doctor.routes[0]).sort(),
    ['effort', 'harness', 'model', 'runtime', 'state', 'summary'],
    'A8: the doctor route row stays the DP5 closed enumerable set — seats is an additive sibling');

  assert.ok('seats' in doctor,
    'stage: doctor-seats-missing — at HEAD no additive seats/observedAtEventSeq fields exist (contract-146 A8 RED)');

  // The occupancy-VALUE correction (B2): for the auto-ambiguous route the honest seat is
  // null (mock + sibling both auto-eligible), so the non-enumerable occupancy must read the
  // same null — not the fabricate numeric _inFlightCount(route.harness).
  const occupancy = doctor.routes[0].occupancy;
  assert.equal(occupancy.inFlight, null,
    'A8 correction: the occupancy VALUE for an auto-ambiguous route is null (numeric → null is the intended #146 correction, not a byte-stability break)');
  assert.equal(occupancy.concurrencyCeiling, null, 'ceiling nulls with the vendor');
  rmSync(repo, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A9 — ALLOCATOR BINDING (B1, LOAD-BEARING): wave path + doctor path, 3 legs
// ---------------------------------------------------------------------------

test('A9-1 (stage: capacity-inflight-missing): a wave member dispatched with vendorRequested X reads the counts of X via _resolveExplicitRoute — never adapterFor, never a different vendor', async (t) => {
  const host = await openHost(t, {
    adapters: { mock: adapter('mock', { ceiling: 1 }), sibling: adapter('sibling', { ceiling: 4 }) },
  });
  const wave = await startWave(host.application, 'a9-1', [memberExact('alpha', 'a9-1 alpha')]);
  await host.baton.runs.open(wave.members[0].runId).approve();
  await until(() => host.driver.coordinator._inFlightCount('mock') === 1, 'a9-1 member working on mock');
  await until(() => host.driver.coordinator._inFlightCount('sibling') === 0, 'sibling untouched');

  const listed = await host.application.command('waves.list', {}, principal('wave-owner'));
  const row = listed.waves.find((w) => w.waveId === wave.waveId);
  assert.ok(row, 'fixture: the wave row resolves');
  assert.ok('capacity' in row,
    'stage: capacity-inflight-missing — at HEAD waveList rows have no capacity block (contract-146 A9 RED; D1.1)');
  assert.equal(row.capacity.length, 1, 'one distinct route');
  const atom = row.capacity[0];
  // The seat is the allocator-resolved vendor \'mock\' — the member's route harness IS the
  // vendorRequested axis (waves.start accepts {role, objective, exact, scope} only; the vendor
  // is member.exact.harness → task.vendorRequested at coordinator.mjs:4058, line 5543 pins the
  // route.harness === vendorRequested identity). So this member was dispatched with
  // vendorRequested: \'mock\' on R, and _resolveExplicitRoute(\'mock\', {model, effort}) is the
  // ONLY binding the atom may read (D1.1 / B1). The discriminator: a NON-pausable MockAdapter is
  // invisible to adapterFor, so the parallel binding cannot produce this number.
  assert.equal(atom.route.harness, 'mock',
    `the atom's route identity is the member's vendorRequested axis — X = 'mock' (A9)`);
  assert.equal(atom.inFlight, host.driver.coordinator._inFlightCount('mock'),
    'the capacity atom reads the allocator-resolved vendor\'s counts — _resolveExplicitRoute(\'mock\')');
  assert.equal(atom.inFlight, 1, 'and that count is the live seat');
  assert.notEqual(atom.inFlight, host.driver.coordinator._inFlightCount('sibling'),
    'it NEVER reads a different vendor\'s counts');
});

test('A9-2 (stage: doctor-seats-missing): doctor/generic path — an auto route with >1 eligible candidate reads all-null (the router pick is unpredictable from route identity alone)', async (t) => {
  const host = await openHost(t, {
    adapters: { mock: adapter('mock', { pausable: true }), sibling: adapter('sibling', { pausable: true }) },
  });
  assert.equal(autoEligibleSet(host.driver, ROUTE).length, 2,
    'fixture: exactly 2 auto-eligible candidates for R');
  // The parallel binding would read a value here: adapterFor(route) resolves the harness-
  // keyed pausable \'mock\'. The allocator refuses — the atom must too.
  const doctor = host.application.doctorReadiness();
  assert.ok('seats' in doctor,
    'stage: doctor-seats-missing — at HEAD the raw doctor has no seats array (contract-146 A9 RED; D1.1)');
  assert.equal(doctor.seats[0].inFlight, null, '>1 eligible → honest-null (ambiguous by design)');
  assert.equal(doctor.seats[0].ceiling, null, 'no vendor names a card');
  assert.equal(doctor.seats[0].deferred, null, 'no vendor names a receipt scope');
  assert.equal(doctor.seats[0].inFlightRevision, null, 'no vendor names a handle registry');
});

test('A9-3 (stage: doctor-seats-missing): doctor/generic path — an auto route with exactly ONE eligible candidate reads that candidate\'s counts', async (t) => {
  const host = await openHost(t, { adapters: { mock: adapter('mock', { ceiling: 4 }) } });
  const wave = await startWave(host.application, 'a9-3', [memberExact('alpha', 'a9-3 alpha')]);
  await host.baton.runs.open(wave.members[0].runId).approve();
  await until(() => host.driver.coordinator._inFlightCount('mock') === 1, 'a9-3 working');
  assert.equal(autoEligibleSet(host.driver, ROUTE).join(','), 'mock', 'fixture: exactly one auto-eligible candidate');

  const doctor = host.application.doctorReadiness();
  assert.ok('seats' in doctor,
    'stage: doctor-seats-missing — at HEAD the raw doctor has no seats array (contract-146 A9 RED; D1.1)');
  // 1 eligible → the allocator names mock; the atom reads _inFlightCount(mock) = 1. The
  // discriminator: the NON-pausable MockAdapter is invisible to adapterFor, so a wrong
  // impl binding there reads null — it cannot produce this live count.
  assert.equal(doctor.seats[0].inFlight, host.driver.coordinator._inFlightCount('mock'),
    'the single-eligible auto route reads the allocator\'s candidate counts');
  assert.equal(doctor.seats[0].inFlight, 1, 'and that count is the live seat');
});

// ---------------------------------------------------------------------------
// A10 — SINGLE OCCUPANCY SOURCE (B2)
// ---------------------------------------------------------------------------

test('A10 (stage: doctor-seats-missing): routes[i].occupancy.inFlight === seats[i].inFlight for every readiness route — matched (same numbers) and auto-ambiguous (same null)', async (t) => {
  // Matched route: single mock, no runs — occupancy and seats both read the real zero.
  const repo = root('a10-matched');
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(mkdtempSync(join(tmpdir(), 'baton-146-dep-a10m-')), 'dep'),
      adapters: { mock: adapter('mock', { ceiling: 4 }) },
      routes: [ROUTE],
      verification: { command: 'true', arguments: [] },
    },
  });
  const doctor = await deployment.doctor();
  assert.ok('seats' in doctor,
    'stage: doctor-seats-missing — at HEAD the doctor has no seats array (contract-146 A10 RED; B2)');
  assert.equal(doctor.routes[0].occupancy.inFlight, doctor.seats[0].inFlight,
    'matched route: occupancy === seats (both read the allocator-bound value)');
  assert.equal(doctor.seats[0].inFlight, 0, 'real zero — the doctor and the atom agree');
  await deployment.close().catch(() => {});
  rmSync(repo, { recursive: true, force: true });

  // Auto-ambiguous route: mock + sibling both auto-eligible — occupancy and seats must
  // read the SAME null (B2: the single source, never a fabricate-number in one and null in
  // the other).
  const repo2 = root('a10-amb');
  const deployment2 = await openBaton({
    repo: repo2,
    advanced: {
      deploymentRoot: join(mkdtempSync(join(tmpdir(), 'baton-146-dep-a10a-')), 'dep'),
      adapters: { mock: adapter('mock', { pausable: true }), sibling: adapter('sibling', { pausable: true }) },
      routes: [ROUTE],
      verification: { command: 'true', arguments: [] },
    },
  });
  t.after(async () => { try { await deployment2.close(); } catch { /* fixture teardown */ } });
  const doctor2 = await deployment2.doctor();
  assert.ok('seats' in doctor2,
    'stage: doctor-seats-missing — at HEAD the doctor has no seats array (contract-146 A10 RED; B2)');
  assert.equal(doctor2.seats[0].inFlight, null, 'auto-ambiguous seat reads honest-null');
  assert.equal(doctor2.routes[0].occupancy.inFlight, doctor2.seats[0].inFlight,
    'auto-ambiguous route: occupancy === seats (the single source reads null in BOTH)');
  rmSync(repo2, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A11 — LIVE-COMPONENT FRESHNESS (B3)
// ---------------------------------------------------------------------------

test('A11 (stage: inFlightRevision-missing): the live inFlight component carries a per-atom inFlightRevision — the vendor\'s incarnation-local handle-revision counter, never a clock', async () => {
  const surfaces = ['application-deployment.mjs', 'mcp-northbound.mjs', 'application-cli.mjs'];
  for (const file of surfaces) {
    const source = readFileSync(join('impl', 'src', file), 'utf8');
    assert.ok(source.includes('inFlightRevision'),
      `stage: inFlightRevision-missing — ${file} carries no inFlightRevision at HEAD (contract-146 A11 RED; B3)`);
    // Guard (passes at HEAD): wherever the counter is derived it must never be a clock.
    assert.equal(/inFlightRevision\s*=\s*new\s+Date\b/u.test(source), false,
      `${file}: the revision is a handle-revision counter, never a clock (the campaign no-clock law)`);
  }
});
