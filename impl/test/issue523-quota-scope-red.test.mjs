// issue523-quota-scope-red.test.mjs — Issue #523: a provider quota block or degrade is a fact
// about the SUBSCRIPTION (the API service account), never about the (harness, model, effort)
// triple.
//
// The observed failure (2026-09-19, reported by the operator): `omp/zai/glm-5.3-flash@high` sat
// "degraded (provider_quota_exhausted)" for over 24 hours while `@low` and `@max` of the same
// model, same credential, read "ready" the whole time and ran real turns successfully. Effort is
// a client-side request parameter; no provider meters quota per effort. And per-model grouping
// would also be wrong: omp's catalog serves `opencode-go/deepseek-v4-pro` and
// `deepseek/deepseek-v4-pro` — the same model id through two different subscriptions (#524) —
// which share no quota.
//
// The pinned contract (docs/51-provider-quota-scope.md):
//
//   523-a  `routeQuotaScope(route)` derives the one quota axis — the route's explicit provider,
//          else the model's provider segment, else the harness. Effort is never read.
//   523-b  the ProviderQuotaAuthority keys its blocks by that scope: a block observed on
//          `zai/glm-5.3-flash@high` reads live for `@low` and `@max`, and never for the same
//          model id reached through a different subscription.
//   523-c  the deployment's doctor rows and the pre-effect recruit refusal read the same scope:
//          every route of an exhausted subscription reads blocked, a recruit on any of them
//          refuses before any effect, and the same model id on another subscription stays ready.
//   523-d  a provider.degraded episode degrades every route of its scope, refuses a recruit on a
//          sibling effort, and a later successful turn on ANY route of the scope retires the
//          episode for all of them.
//   523-e  the coordinator's fold groups deaths by scope: same-class deaths at two efforts of one
//          model are ONE episode, and the episode row carries the scope it groups by.
//
// Hermetic: temp dirs under os.tmpdir(), fixture adapters, real git checkouts, no provider
// process. `git stash` is never used.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { ProviderQuotaAuthority } from '../src/route-quota.mjs';
// The #523 export is reached through the namespace on purpose: this file must LOAD against the
// commit it pins, so every row fails on its own assertion instead of the module failing to link.
import * as providerFaults from '../src/provider-faults.mjs';

const T0 = Date.parse('2026-09-19T00:00:00Z');
const MIN = 60_000;

const GLM_LOW = Object.freeze({ harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'low' });
const GLM_HIGH = Object.freeze({ harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'high' });
const GLM_MAX = Object.freeze({ harness: 'omp', model: 'zai/glm-5.3-flash', effort: 'max' });
// The #524 pair: the same model id served by two different subscriptions.
const DS_LOW = Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-v4-pro', effort: 'low' });
const DS_HIGH = Object.freeze({ harness: 'omp', model: 'deepseek/deepseek-v4-pro', effort: 'high' });
const OCG_LOW = Object.freeze({ harness: 'omp', model: 'opencode-go/deepseek-v4-pro', effort: 'low' });

const dirs = [];
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue523-${label}-`));
  dirs.push(dir);
  return dir;
}

function gitRepo(t, label) {
  const root = tmpDir(label);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['checkout', '-q', '-b', 'master'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue523@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 523'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# issue 523\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

/** A fixture adapter that advertises every route it is handed (the issue316-a3 card shape). */
function ompAdapter(routes) {
  const adapter = new MockAdapter({
    harness: 'omp',
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
      available: [...new Set(routes.map((route) => route.model))], family: 'omp',
      acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [...new Set(routes.map((route) => route.effort))],
      serviceTier: null, provenance: 'issue523-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable' },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  return adapter;
}

async function openDeployment(t, label, routes) {
  const repo = gitRepo(t, `${label}-repo`);
  const root = join(tmpDir(`${label}-owner`), 'deployment');
  mkdirSync(join(root, '..'), { recursive: true });
  let driverOptions = null;
  const adapter = ompAdapter(routes);
  const deployment = await openBatonDeployment({
    repo,
    advanced: {
      deploymentRoot: root,
      adapters: { omp: adapter },
      routes,
      verification: { command: process.execPath, arguments: ['--version'] },
    },
  }, (options) => { driverOptions = options; return createDriver(options); });
  t.after(async () => { try { await deployment.close(); } catch { /* closed by the test */ } });
  return { deployment, driverOptions, adapter };
}

const usageRowFor = (rows, route) => rows.find((row) => (
  row.route.harness === route.harness && row.route.model === route.model && row.route.effort === route.effort));

const owner = Object.freeze({ actor: 'owner', principalId: 'owner' });

// ── 523-a: the scope derivation itself ──────────────────────────────────────────────────────────

test('523-a: routeQuotaScope is the subscription axis — provider, else model segment, else harness; effort is never read', () => {
  assert.equal(typeof providerFaults.routeQuotaScope, 'function',
    'provider-faults.mjs exports the ONE quota-scope derivation');
  const scope = providerFaults.routeQuotaScope;
  // Effort is a client-side request parameter: two efforts of one route are one scope.
  assert.equal(scope(GLM_HIGH), scope(GLM_LOW), 'effort is never a quota axis');
  assert.equal(scope(GLM_HIGH), scope(GLM_MAX));
  // The model's provider segment names the service the route talks to.
  assert.equal(scope(GLM_HIGH), 'zai');
  // The registry route's explicit provider field wins when it names one.
  assert.equal(scope({ harness: 'claude-code', provider: 'claude', model: 'claude-opus-4-6', effort: 'max' }), 'claude');
  // A model with no provider segment falls back to the harness's own service.
  assert.equal(scope({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' }), 'codex');
  // The same model id through two subscriptions is two scopes (#524's pair).
  assert.notEqual(scope(DS_LOW), scope(OCG_LOW),
    'deepseek/deepseek-v4-pro and opencode-go/deepseek-v4-pro share no quota');
  // A scope never needs the dispatch axes: a route naming no effort still scopes.
  assert.equal(scope({ harness: 'omp', model: 'zai/glm-5.3-flash' }), 'zai',
    'the scope derivation never requires effort');
});

// ── 523-b: the exhausted-route authority keys by scope ──────────────────────────────────────────

test('523-b: a quota block recorded on one effort reads live for every route of the scope, and never for another subscription', () => {
  const authority = new ProviderQuotaAuthority({ now: () => T0, maxEntries: 16 });
  const resetAt = new Date(T0 + 5 * 60 * MIN).toISOString();
  const recorded = authority.record(GLM_HIGH, { resetAt });
  assert.ok(recorded, 'the observation is recorded');
  assert.equal(recorded.scope, 'zai', 'the block names the scope it groups by');
  assert.deepEqual(recorded.route, GLM_HIGH, 'and the exact route that observed it');

  // The reported incident, inverted: the sibling efforts of the same subscription are blocked too.
  assert.ok(authority.blockFor(GLM_LOW), '@low shares the subscription the provider exhausted');
  assert.ok(authority.blockFor(GLM_MAX), '@max shares the subscription the provider exhausted');
  assert.equal(authority.blockFor(GLM_LOW).resetAt, resetAt);

  // A different subscription serving the same model id is untouched.
  assert.equal(authority.blockFor(DS_LOW), null, 'deepseek is not zai');
  // And exhausting deepseek blocks its own efforts but never opencode-go's same-named model.
  authority.record(DS_HIGH, { resetAt });
  assert.ok(authority.blockFor(DS_LOW), 'deepseek@low shares deepseek@high\'s account');
  assert.equal(authority.blockFor(OCG_LOW), null,
    'opencode-go/deepseek-v4-pro is a different subscription from deepseek/deepseek-v4-pro');
});

// ── 523-c: the doctor and the pre-effect recruit refusal read the same scope ────────────────────

test('523-c: every route of an exhausted subscription reads blocked, a recruit on any sibling refuses pre-effect, another subscription stays ready', async (t) => {
  const routes = [GLM_LOW, GLM_HIGH, GLM_MAX, DS_LOW, OCG_LOW];
  const { deployment, driverOptions, adapter } = await openDeployment(t, 'quota-scope', routes);
  const quota = driverOptions.routeQuotaAuthority;
  assert.ok(quota, 'the deployment hands its coordinator the exhausted-route authority');

  let spawns = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawns += 1; return spawn(...args); };

  // The provider refuses glm-5.3-flash@high for quota — the incident's own observation.
  const resetAt = new Date(Date.now() + 60_000).toISOString();
  quota.record(GLM_HIGH, { resetAt });

  const doctor = await deployment.doctor();
  for (const route of [GLM_LOW, GLM_HIGH, GLM_MAX]) {
    const row = usageRowFor(doctor.routeUsage, route);
    assert.equal(row.state, 'blocked',
      `${route.effort}: the whole zai subscription is exhausted, not one effort of it`);
    assert.equal(row.quota.state, 'exhausted');
    assert.equal(row.resetAt, resetAt);
  }
  for (const route of [DS_LOW, OCG_LOW]) {
    assert.equal(usageRowFor(doctor.routeUsage, route).state, 'ready',
      'a subscription the provider did not refuse stays ready');
  }

  // The recruit on a sibling effort refuses BEFORE any effect — the incident's split-brain, closed.
  await assert.rejects(
    deployment.run('do the work', { exact: GLM_LOW }),
    (error) => error?.code === 'provider_quota_exhausted' && error?.resetAt === resetAt,
    'a recruit on @low of the exhausted subscription refuses before any effect',
  );
  assert.equal(spawns, 0, 'the refusal precedes every adapter effect');
});

// ── 523-d: a degrade episode covers its scope, and one success in the scope retires it ──────────

test('523-d: a provider.degraded episode degrades every route of its scope and a success on any member retires it', async (t) => {
  const routes = [GLM_LOW, GLM_HIGH, DS_LOW];
  const { deployment, driverOptions, adapter } = await openDeployment(t, 'degrade-scope', routes);
  const log = new Log(driverOptions.logDir);

  // The durable episode the coordinator's fold lands for deaths on @high.
  log.append({
    worker: 'w-1', harness: 'omp@1.0.0', turnEpoch: 1,
    kind: 'provider.degraded', actor: 'policy',
    harnessResolved: GLM_HIGH.harness, modelResolved: GLM_HIGH.model, effortResolved: GLM_HIGH.effort,
    payload: {
      route: Object.freeze({ ...GLM_HIGH }),
      faultClass: 'provider_quota_exhausted',
      participants: Object.freeze(['w-1']),
      window: Object.freeze({ from: new Date(T0).toISOString(), to: new Date(T0).toISOString() }),
      count: 1,
      next: Object.freeze({ action: 'pause_recruits_until_probe', route: Object.freeze({ ...GLM_HIGH }) }),
      resetAt: null, resetAtText: null,
    },
  });

  const doctor = await deployment.doctor();
  for (const route of [GLM_LOW, GLM_HIGH]) {
    const row = usageRowFor(doctor.routeUsage, route);
    assert.ok(row.degraded, `${route.effort}: the episode is a fact about the zai subscription`);
    assert.equal(row.degraded.state, 'degraded');
    assert.equal(row.degraded.scope, 'zai', 'the published episode names its scope');
    assert.equal(row.state, 'degraded');
  }
  assert.equal(usageRowFor(doctor.routeUsage, DS_LOW).degraded, null,
    'a route on another subscription carries no episode');

  // A recruit on the sibling effort refuses typed, before any effect.
  let spawns = 0;
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (...args) => { spawns += 1; return spawn(...args); };
  const store = new CoordinationStore(join(tmpDir('degrade-scope-swarm'), 'coordination'));
  const workers = [];
  const runtime = new SwarmRuntime({
    store, coordinator: { list: () => workers, pausedTurns: () => [] }, authorize: async () => {},
    deploymentSummary: () => deployment.doctorReadiness(),
    prepareRun: async (request) => ({ ...request, route: request.options?.exact ?? null }),
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  await runtime.command('swarm.create',
    { swarmId: 'degraded', purpose: 'degraded scope', idempotencyKey: 'issue523-d-0' }, owner);
  await assert.rejects(
    runtime.command('swarm.recruit', {
      swarmId: 'degraded', participantId: 'lane-1', objective: 'work',
      idempotencyKey: 'issue523-d-1', options: { exact: GLM_LOW },
    }, owner),
    (error) => error?.code === 'route_degraded',
    'a recruit on a sibling effort of the degraded scope refuses route_degraded',
  );
  assert.equal(spawns, 0, 'the refusal precedes every effect');

  // A successful turn on ANY route of the scope — the probe #456 admits — retires the episode
  // for the whole scope: the account answered, which is the fact the episode was waiting on.
  // The probe runs on a SERVED route of the scope; @high (the observing route) is one.
  log.append({
    worker: 'probe-w', harness: 'omp@1.0.0', turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'worker',
    harnessResolved: GLM_HIGH.harness, modelResolved: GLM_HIGH.model, effortResolved: GLM_HIGH.effort,
    payload: { status: 'completed', summary: 'the probe answered', usageSeal: null },
  });
  const healed = await deployment.doctor();
  assert.equal(usageRowFor(healed.routeUsage, GLM_HIGH).state, 'ready',
    'the observing route reads ready after the probe');
  assert.equal(usageRowFor(healed.routeUsage, GLM_LOW).state, 'ready',
    'the sibling effort reads ready off the SAME success — one scope, one retirement');
});

// ── 523-e: the coordinator's fold groups deaths by scope ────────────────────────────────────────

const MOCK_ROUTE_LOW = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const MOCK_ROUTE_HIGH = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'high' });
const STALL_CODE = 'provider_turn_failed';
const STALL_TEXT = 'OpenAI completions stream timed out while waiting for the first event';

/** A scriptable adapter whose card resolves the mock routes (the issue316 coordinator fixture). */
class RouteAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null,
      maxContext: 100000, verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', kill: 'native' },
      modelSelection: {
        mode: 'exact', family: 'mock', configuredDefault: 'mock-model', available: ['mock-model'],
        acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: ['low', 'high'], configuredEffort: 'low',
        serviceTier: null,
      },
    };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

function coordinatorFixture(t) {
  const root = tmpDir('fold');
  const log = new Log(join(root, 'log'));
  const adapter = new RouteAdapter();
  let clock = T0;
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      pathFor: (taskId) => join(root, `wt-${taskId}`),
      async create(taskId) {
        const path = join(root, `wt-${taskId}`);
        mkdirSync(path, { recursive: true });
        writeFileSync(join(path, 'work.mjs'), '// the member produced this\n');
        return { path, branch: `baton/${taskId}`, baseSha: 'b'.repeat(40) };
      },
      async reconcile() { return { errors: [], retained: [] }; },
      worktreeAvailable: () => true,
    },
    referee: async (task) => ({ reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock',
    now: () => clock,
    watchdog: { stallMs: 10 * MIN },
  });
  return { coordinator, adapter, log, advance: (ms) => { clock += ms; } };
}

const foldBrief = () => ({
  goal: 'do the thing', constraints: [], pathScope: ['.'], definitionOfDone: 'tests pass',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 100000, usd: 5, wallMin: 30 },
});

/** One seat's death on the given exact route, as the #295 path records it. */
async function seatStallsOn(coordinator, adapter, handle, route) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    payload: { phase: 'provider', code: STALL_CODE, error: STALL_TEXT, detail: { route, resetAt: null } },
  });
  await coordinator.wait(25);
  const stopped = coordinator.kill(handle.id, 'policy');
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
  await stopped;
  await coordinator.wait(25);
}

test('523-e: same-class deaths at two efforts of one model fold to ONE episode, and the episode names its scope', async (t) => {
  const { coordinator, adapter, log, advance } = coordinatorFixture(t);

  const first = await coordinator.spawn('mock', foldBrief(), { runId: 'run:523-e-1' });
  await seatStallsOn(coordinator, adapter, first, MOCK_ROUTE_LOW);
  advance(MIN);
  const second = await coordinator.spawn('mock', foldBrief(), { runId: 'run:523-e-2' });
  await seatStallsOn(coordinator, adapter, second, MOCK_ROUTE_HIGH);

  const page = await coordinator.attentionFollow({ scope: { runId: 'run:523-e-1' }, afterCursor: 0 },
    { principalId: 'wave-owner', sessionId: 'session-wave-owner' });
  const degraded = (page?.reasons ?? page?.wakes ?? []).filter((row) => row.kind === 'provider_degraded');
  assert.equal(degraded.length, 1,
    'two efforts of one model are one quota scope, so two deaths are ONE episode');
  const row = degraded[0];
  assert.equal(row.scope, 'mock', 'the episode names the scope it groups by');
  assert.equal(row.count, 2, 'the episode folds both deaths');
  assert.deepEqual(row.participants.slice().sort(), [first.id, second.id].sort());

  const durableKinds = [];
  for (const worker of log.workers()) {
    for (const event of log.read(worker)) {
      if (event.kind === 'provider.degraded') durableKinds.push(event);
    }
  }
  assert.equal(durableKinds.length, 1, 'the durable fold row is one row for the scope');
  assert.equal(durableKinds[0].payload.scope, 'mock',
    'the durable episode carries the scope so a read never re-derives a different one');
});
