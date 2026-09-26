// Issue #575 — degraded-route recovery: a route a provider faulted comes back.
//
// Observed 2026-09-23: Kimi and DeepSeek were refused for every swarm while both providers
// answered directly. Three defects composed into that lock:
//
//   (a) the death a detail-less provider fault mints names its route through
//       `_providerRouteOf`, whose harness was the VERSION-SUFFIXED diagnostic label
//       (`omp@omp/17.4.0`). The degrade episode carried that spelling into the route probe,
//       the probe pinned its recruit to it, and the route table refused the pin with
//       `application_route_not_allowed` — the recovery path could not run.
//   (b) a degrade the provider answered with no reset instant published `clearsAt: null`
//       unless the refusal text named a window, so no probe was ever due and the episode
//       never expired; the quota authority's resetless block never expired either.
//   (c) a stop that landed during setup was certified as a provider crash, so the fold
//       degraded the route the seat was born on — the deployment poisoned its own routes by
//       stopping seats.
//
// The repair, pinned here:
//   - the route is a routing coordinate: `_providerRouteOf` names the plain harness id, and
//     the published block names the served row's coordinates whatever the ledger spelled;
//   - `clearsAt` falls back to the derived probe instant for every fault, and a resetless
//     quota block ends at the declared fault-probe bound (`derivedResetAt`);
//   - a probe that answered retires the provider-fault blocks the row carries, quota included;
//   - an omp exit during setup while the session is killing emits no crash cert.
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, real git checkouts, no provider process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDriver, MockAdapter } from '../src/index.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { Log } from '../src/log.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { ProviderQuotaAuthority } from '../src/route-quota.mjs';
import { PROVIDER_FAULT_CODES } from '../src/provider-faults.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { _providerRouteOf } from '../src/runtime-api.mjs';
import { _recordProviderQuotaBlock } from '../src/runtime-observation.mjs';

const HOUR_MS = 3_600_000;
const registryProbeMs = () => FRAME_LIMITS['route.fault_probe_ms']?.value ?? null;

// The route family the incident blocked: an omp-routed Kimi model and its direct sibling —
// one subscription scope, two spellings in the route table.
const KIMI_OMP = Object.freeze({ harness: 'omp', model: 'kimi-code/k3', effort: 'high' });
const READY_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
// The version-suffixed label `_harnessOf` reported before #575 — the spelling the route table
// refuses.
const VERSIONED_LABEL = 'omp@omp/17.4.0';

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function tmpDir(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue575-${label}-`));
  dirs.push(root);
  return root;
}

const owner = Object.freeze({ actor: 'owner', principalId: 'owner' });

function gitRepo(label) {
  const root = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'master'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue575@example.invalid', GIT_COMMITTER_EMAIL: 'issue575@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 575', GIT_COMMITTER_NAME: 'Issue 575' });
  writeFileSync(join(root, 'README.md'), '# issue 575\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

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
      provenance: 'issue575-fixture',
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

/** The episode the coordinator's death fold lands for a route, spelled the way the pre-#575
 * runtime spelled it: the payload route carries the version-suffixed harness label. The fault
 * class is quota by default — the class whose resetless block #575 ends by derivation; a stall
 * or socket episode derives no instant (#316-a3). */
function degradedRow(route, { at, harnessLabel = VERSIONED_LABEL, resetAt = null, resetAtText = null, failure = PROVIDER_FAULT_CODES.quota } = {}) {
  const stamp = new Date(at).toISOString();
  return {
    worker: 'w-1', harness: harnessLabel, turnEpoch: 1,
    kind: 'provider.degraded', actor: 'policy',
    harnessResolved: harnessLabel, modelResolved: route.model, effortResolved: route.effort,
    payload: {
      route: Object.freeze({ harness: harnessLabel, model: route.model, effort: route.effort }),
      faultClass: failure,
      participants: Object.freeze(['w-1', 'w-2', 'w-3']),
      window: Object.freeze({ from: stamp, to: stamp }), count: 3,
      next: Object.freeze({
        action: 'pause_recruits_until_probe',
        route: Object.freeze({ harness: harnessLabel, model: route.model, effort: route.effort }),
      }),
      resetAt, resetAtText,
    },
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
    { swarmId: 'route-swarm', ...(command === 'view' ? {} : { idempotencyKey: `575-${++key}` }), ...args }, owner);
  const rowsOfKind = (kind) => store.eventsView()
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === kind)
    .map((event) => ({ ...event.payload, actor: event.actor, seq: event.seq }));
  return { call, runs, store, rowsOfKind, prepared, runtime };
}

const refusalOf = async (promise) => {
  try { await promise; return null; } catch (error) { return error; }
};

const liveRows = (deployment) => () => deployment.doctorReadiness().routeUsage;

// ── (a) the route the recovery path names is the served route ───────────────────────────────────

test('575-a: a degrade recorded under a version-suffixed label publishes the served coordinates', async (t) => {
  const { deployment, log } = await openDeployment(t, 'served-label', [KIMI_OMP, READY_ROUTE]);
  // The fault is six hours old: with no window in its words, the registry's fault-probe row
  // derives a probe instant five hours after the death — already past, so a probe is due.
  const faultAt = Date.now() - 6 * HOUR_MS;
  log.append(degradedRow(KIMI_OMP, { at: faultAt }));

  const row = usageRowFor((await deployment.doctor()).routeUsage, KIMI_OMP);
  assert.ok(row?.degraded, 'the route its provider faulted reads degraded');
  assert.deepEqual(
    { harness: row.degraded.route.harness, model: row.degraded.route.model, effort: row.degraded.route.effort },
    KIMI_OMP,
    'the block names the SERVED route, never the version-suffixed label the ledger spelled');
  assert.ok(!JSON.stringify(row.degraded).includes(VERSIONED_LABEL),
    'the version-suffixed label appears nowhere in the published block');
  assert.deepEqual(
    { harness: row.degraded.next?.route?.harness, model: row.degraded.next?.route?.model, effort: row.degraded.next?.route?.effort },
    KIMI_OMP, 'the advice row matches the served coordinates');
  assert.equal(row.degraded.resetAt, null, 'the provider named no reset instant');
  const probeAfter = Date.parse(row.degraded.clearsAt);
  assert.equal(probeAfter, Date.parse(row.degraded.window.to) + registryProbeMs(),
    'the clear is the registry fault-probe bound measured from the death');
  assert.ok(probeAfter < Date.now(), 'and this episode is old enough that a probe is due');

  // The recovery path runs end to end: the due probe is admitted WITHOUT an override, and the
  // route it pins the recruit to is one the route table admits.
  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'served label' });
  const admitted = await fixture.call('recruit',
    { participantId: 'lane-probe', objective: 'probe the route', options: { exact: KIMI_OMP } });
  assert.equal(admitted.admission?.state, 'admitted',
    `the probe recruit is admitted: ${admitted.admission?.state ?? ''} ${admitted.error?.code ?? ''}`);
  assert.equal(admitted.admission?.kind, 'probe', 'as the episode\'s probe');
  assert.deepEqual(admitted.admission?.probe?.route, KIMI_OMP,
    'pinned to the served coordinates, never the versioned label');
  assert.deepEqual(fixture.prepared.at(-1)?.exact, KIMI_OMP,
    'the run intent the deployment resolves carries the served route');
});


test('575-b: a version-suffixed degrade still refuses typed, and the remedy names a runnable route', async (t) => {
  const { deployment, log } = await openDeployment(t, 'refusal-label', [KIMI_OMP, READY_ROUTE]);
  // A LIVE fault (thirty minutes old): the probe instant is still ahead, so the recruit refuses —
  // and the refusal's route facts are the served spelling an operator can act on.
  const faultAt = Date.now() - 30 * 60_000;
  log.append(degradedRow(KIMI_OMP, { at: faultAt }));

  const fixture = routeFixture(liveRows(deployment));
  await fixture.call('create', { purpose: 'typed refusal' });
  const error = await refusalOf(fixture.call('recruit',
    { participantId: 'lane-1', objective: 'work', options: { exact: KIMI_OMP } }));
  assert.equal(error?.code, 'route_degraded', 'a recruit before the clear refuses typed');
  assert.ok(Date.parse(error.detail?.clearsAt) > Date.now(), 'naming when the route clears');
  assert.equal(error.detail?.route?.harness, KIMI_OMP.harness, 'the refusal names the served route');
  assert.equal(error.detail?.route?.model, KIMI_OMP.model);
  assert.equal(error.detail?.route?.effort, KIMI_OMP.effort);
  assert.deepEqual(fixture.runs, [], 'the refusal precedes every effect');
});

// ── (b) a resetless quota block ends at the declared bound ───────────────────────────────────────

test('575-c: the quota authority ends a resetless block at the derived fault-probe bound', () => {
  const now = 1_758_000_000_000;
  const authority = new ProviderQuotaAuthority({ now: () => now, maxEntries: 4 });
  const route = { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'high' };
  const derived = new Date(now + registryProbeMs()).toISOString();
  const block = authority.record(route, { code: PROVIDER_FAULT_CODES.quota, resetAt: null, derivedResetAt: derived, at: now });
  assert.equal(block?.state, 'blocked', 'the block is live when recorded');
  assert.equal(block.resetAt, null, 'the provider named no reset, and the row keeps that answer');
  assert.equal(block.derivedResetAt, derived, 'beside the derived bound the block ends at');

  assert.ok(authority.blockFor(route, now + registryProbeMs() - 1), 'the block holds to its bound');
  assert.equal(authority.blockFor(route, now + registryProbeMs()), null,
    'past the bound the block is gone — the route reads ready again, by derivation');
});

test('575-d: the quota recorder derives the bound, and a provider instant stands alone', () => {
  const now = 1_758_000_000_000;
  const authority = new ProviderQuotaAuthority({ now: () => now, maxEntries: 4 });
  const route = { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'high' };
  const coordinator = {
    _providerQuota: authority,
    _now: () => now,
    _providerRouteOf: () => route,
    _harnessOf: () => 'omp@omp/17.4.0',
    _safeTurnEpoch: () => 1,
    _routeAttribution: () => ({}),
  };
  const recorder = { log: { append: () => ({}) } };
  const handle = { id: 'w-quota' };

  // The provider answered with no instant: the recorder derives the bound beside the honest null.
  const silent = _recordProviderQuotaBlock(coordinator, recorder, handle,
    { code: PROVIDER_FAULT_CODES.quota, detail: { route, resetAt: null, resetAtText: null } }, null);
  assert.equal(silent?.resetAt, null, 'the provider\'s answer stays null');
  assert.equal(silent?.derivedResetAt, new Date(now + registryProbeMs()).toISOString(),
    'and the block ends at the declared bound');

  // The provider named its own instant: nothing is derived, the block ends there alone.
  const named = _recordProviderQuotaBlock(coordinator, recorder, handle,
    { code: PROVIDER_FAULT_CODES.quota, detail: { route, resetAt: '2026-10-01T00:00:00.000Z' } }, null);
  assert.equal(named?.resetAt, '2026-10-01T00:00:00.000Z');
  assert.equal(named?.derivedResetAt, null, 'a provider instant needs no derived bound');
});

test('575-e: a probe that answered retires the quota block the row carries', () => {
  const store = new CoordinationStore(tmpDir('recovered-quota'));
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [], pausedTurns: () => [] },
    authorize: async () => {},
    deploymentSummary: () => null,
    prepareRun: async (request) => request,
    startRun: async () => {},
    stopRun: async () => ({ state: 'closed' }),
  });
  // The episode's identity, as the degrade row spells it, and the probe that answered it —
  // seeded as the durable rows the runtime reads its probe facts from. The admission key is
  // minted by the runtime's own derivation (`_routeProbeState`), so the seeded rows key exactly
  // as a real admission keys.
  const episodeAt = '2026-09-23T10:00:00.000Z';
  const key = runtime._routeProbeState(
    { route: KIMI_OMP, clearsAt: episodeAt, since: episodeAt }, {},
  ).key;
  assert.ok(typeof key === 'string' && key.startsWith('route.probe_admitted:'),
    'the runtime derives the attempt-1 admission key for the episode');
  store.recordDriver('route.probe_admitted', {
    route: KIMI_OMP, at: episodeAt, reason: 'probe_due', episodeAt, attempt: 1,
    clearsAt: episodeAt, probeAfter: episodeAt, swarmId: 's-575', participantId: 'lane-probe', runId: 'run-575',
  }, { actor: 'policy', key });
  store.recordDriver('route.recovered', {
    probeKey: key, route: KIMI_OMP, at: '2026-09-23T10:05:00.000Z', clearsAt: episodeAt,
  }, { actor: 'policy', key: `route.recovered:${key}` });

  // The row as the deployment composes it: quota-blocked AND carrying the episode — the deepseek
  // shape, where the authority's block masks the degrade underneath it.
  const blocked = Object.freeze({
    route: KIMI_OMP, state: 'blocked', code: PROVIDER_FAULT_CODES.quota,
    quota: Object.freeze({ state: 'exhausted', resetAt: null }),
    degraded: Object.freeze({
      route: KIMI_OMP, faultClass: PROVIDER_FAULT_CODES.quota, since: '2026-09-23T08:00:00.000Z',
      clearsAt: episodeAt, probeAfter: episodeAt, count: 1,
    }),
  });
  const recovered = runtime._withRouteRecovery(blocked);
  assert.equal(recovered.state, 'ready', 'the probe\'s answer retires the block');
  assert.equal(recovered.quota.state, 'ok', 'the quota axis reads ok again');
  assert.equal(recovered.degraded, null, 'and the episode is history');

  // A block that names no provider fact keeps its own verdict: a probe answers faults, not
  // static readiness refusals.
  const staticBlocked = Object.freeze({
    route: KIMI_OMP, state: 'blocked', code: 'omp_agent_unconfigured',
    quota: Object.freeze({ state: 'ok', resetAt: null }),
    degraded: Object.freeze({
      route: KIMI_OMP, faultClass: PROVIDER_FAULT_CODES.socket, since: '2026-09-23T08:00:00.000Z',
      clearsAt: episodeAt, probeAfter: episodeAt, count: 1,
    }),
  });
  const kept = runtime._withRouteRecovery(staticBlocked);
  assert.equal(kept.state, 'blocked', 'a static block is not a probe\'s to clear');
});


// ── (c) the death the runtime mints names the plain harness ─────────────────────────────────────

test('575-f: the provider route of a handle is the plain harness id, not the versioned label', () => {
  const coordinator = {
    _adapters: { omp: { card: () => ({ harness: 'omp', version: 'omp/17.4.0' }) } },
  };
  const handle = { vendor: 'omp', modelResolved: 'kimi-code/k3', effortResolved: 'high' };
  assert.deepEqual(_providerRouteOf(coordinator, handle), KIMI_OMP,
    'the routing coordinate is the served spelling the route table admits');
  assert.equal(_providerRouteOf(coordinator, { vendor: 'omp' }), null,
    'a handle that resolved nothing still names no route');
});

// ── (d) a stop during setup owns the exit — no crash cert ────────────────────────────────────────

test('575-g: an omp stop during setup emits no crash cert, and a real setup exit still does', async (t) => {
  const bin = tmp('fake-omp-575');
  const script = join(bin, 'omp');
  // A provider that never becomes ready: the stop decides when the process ends.
  writeFileSync(script, '#!/bin/sh\nsleep 30\n');
  chmodSync(script, 0o755);
  const adapter = new OmpRpcCli({
    cmd: script, requestTimeoutMs: 2_000, model: 'kimi-code/k3',
    modelCatalog: { 'kimi-code/k3': ['high'] },
    versionProbe: () => 'omp test',
    killGraceMs: 50,
    reapOwnedProcessGroup: async () => ({ confirmed: true, reason: null }),
  });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  const spawnPromise = adapter.spawn('w-stop', { goal: 'x', verification: { command: 'true', expectExit: 0 } }, {
    worktree: '/tmp', model: 'kimi-code/k3', reasoningEffort: 'high',
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await adapter.kill('w-stop');
  const ack = await spawnPromise;
  assert.equal(ack.ok, false);
  assert.equal(ack.code, 'setup_process_exit', 'the spawn refusal still names the setup fact');
  assert.equal(events.find((event) => event.kind === 'lifecycle.crashed'), undefined,
    'a stop that lands during setup owns the exit — no crash cert is minted for it');
  assert.ok(events.some((event) => event.kind === 'kill.confirmed'), 'the stop itself is the terminal');

  // The control: a process that exits on its own before ready still publishes the cert, so a
  // broken binary or an unreadable model keeps its evidence (#342).
  const dying = tmp('dying-omp-575');
  const dyingScript = join(dying, 'omp');
  writeFileSync(dyingScript, '#!/bin/sh\necho \'Model "kimi-code/k3" not found\' >&2\nexit 1\n');
  chmodSync(dyingScript, 0o755);
  const crashing = new OmpRpcCli({
    cmd: dyingScript, requestTimeoutMs: 2_000, model: 'kimi-code/k3',
    modelCatalog: { 'kimi-code/k3': ['high'] },
    versionProbe: () => 'omp test',
    reapOwnedProcessGroup: async () => ({ confirmed: true, reason: null }),
  });
  const crashEvents = [];
  crashing.onEvent((event) => crashEvents.push(event));
  const crashAck = await crashing.spawn('w-crash', { goal: 'x', verification: { command: 'true', expectExit: 0 } }, {
    worktree: '/tmp', model: 'kimi-code/k3', reasoningEffort: 'high', processReapTimeoutMs: 500,
  });
  assert.equal(crashAck.ok, false);
  const crashed = crashEvents.find((event) => event.kind === 'lifecycle.crashed');
  assert.ok(crashed, 'a real setup exit is still certified');
  assert.equal(crashed.payload.phase, 'setup');
});

function tmp(label) {
  const root = tmpDir(label);
  execFileSync('mkdir', ['-p', root]);
  return root;
}
