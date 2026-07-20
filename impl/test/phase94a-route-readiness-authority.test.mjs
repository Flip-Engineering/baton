import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { normalizeGoalPlanPolicy } from '../src/goal-plan.mjs';
import { Log } from '../src/log.mjs';
import {
  BatonWebClient, connectBaton, createBatonWebMcpServer, createLocalSocketFetch,
  discoverBatonConnection, openBaton, parseBatonCli, runBatonCli,
} from '../src/index.mjs';
import {
  projectRouteReadinessError, RouteReadinessAuthority, RouteReadinessBlockedError,
} from '../src/route-readiness-authority.mjs';

const ROUTE = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });
const KIMI_ROUTE = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' });
const INDEX_URL = pathToFileURL(join(import.meta.dirname, '..', 'src', 'index.mjs')).href;
const canonicalDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = (value) => Array.isArray(value) ? value.map(sorted)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])])) : value;
const authorityDigest = (value) => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
const bindingCard = (route = ROUTE, overrides = {}) => ({
  harness: route.harness, version: '1.2.3', family: route.harness === 'codex' ? 'openai' : 'grok',
  adapterCardDigest: 'a'.repeat(64),
  modelSelection: {
    mode: 'exact', configuredDefault: route.model, available: [route.model],
    acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: [route.effort], serviceTier: null,
  },
  ...overrides,
});
const card = () => ({
  harness: ROUTE.harness, version: '1.2.3', authPosture: 'subscription',
  concurrencyCeiling: 1, maxContext: 100_000,
  modelSelection: {
    mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
    acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: [ROUTE.effort],
    family: 'grok', serviceTier: null,
  },
  sessions: { multiTurn: 'native', resume: 'native' },
  workerPolicy: {
    schemaVersion: 1,
    autonomy: { supported: ['unattended'], default: 'unattended', perTask: false,
      observation: 'launch', mechanisms: ['test-unattended'] },
    access: { supported: ['full'], default: 'full', perTask: false,
      observation: 'launch', mechanisms: ['test-full'] },
    containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'],
      configuredPreferences: [], observation: 'unavailable' },
  },
  verbs: { spawn: 'native', prompt: 'native', interrupt: 'native', kill: 'native' },
});
const effect = (overrides = {}) => ({
  runId: 'run-phase94a', taskId: 'task-phase94a', nodeKey: 'node-phase94a',
  workerId: 'worker-phase94a', processGeneration: 1, phase: 'spawn', ...overrides,
});
const binding = (overrides = {}) => ({
  ...ROUTE, version: '1.2.3', taskType: 'general', serviceTier: null,
  workerPolicy: null, card: bindingCard(), effect: effect(), ...overrides,
});

test('P94A-RA1: exact private leases are single-use, binding- and credential-epoch-bound, with sanitized replay receipts', async () => {
  let epoch = 'credential-1';
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready', summary: 'ready' }),
    credentialEpoch: () => epoch, now: () => Date.parse('2026-07-20T12:00:00.000Z'),
  });

  const lease = await authority.issue(binding());
  const admitted = await authority.consume(lease, binding());
  assert.equal(admitted.state, 'admitted');
  assert.equal(JSON.stringify(admitted).includes('must-not-escape'), false);
  await assert.rejects(
    authority.consume(lease, binding()),
    (error) => error.code === 'route_lease_replayed'
      && error.receipt?.receiptDigest === admitted.receiptDigest
      && !JSON.stringify(error).includes('must-not-escape'),
  );

  const stale = await authority.issue(binding());
  epoch = 'credential-2';
  await assert.rejects(
    authority.consume(stale, binding()),
    (error) => error.code === 'route_lease_invalid' && error.receipt?.state === 'admitted',
  );
  assert.throws(
    () => authority.validate({ ...ROUTE, extra: true }),
    (error) => error.code === 'route_invalid',
  );
});

test('P94A-RA1b: mismatch, expiry, invalidation, and legacy receipt replay cannot preserve or reconstruct live authority', async () => {
  let now = 1_000;
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready' }),
    credentialEpoch: () => 'credential', now: () => now, leaseTtlMs: 10,
  });
  const mismatched = await authority.issue(binding());
  await assert.rejects(
    authority.consume(mismatched, binding({ taskType: 'review' })),
    (error) => error.code === 'route_lease_invalid',
  );
  await assert.rejects(
    authority.consume(mismatched, binding()),
    (error) => error.code === 'route_lease_replayed',
  );

  const expired = await authority.issue(binding());
  now += 11;
  await assert.rejects(
    authority.consume(expired, binding()),
    (error) => error.code === 'route_lease_invalid',
  );

  now += 1;
  const invalidated = await authority.issue(binding());
  authority.invalidate(ROUTE, 'authentication_refresh_required');
  await assert.rejects(
    authority.consume(invalidated, binding()),
    (error) => error instanceof RouteReadinessBlockedError
      && error.receipt?.state === 'waiting_for_route'
      && error.receipt?.reaped === true,
  );

  let legacyReceipt;
  try { await authority.issue(binding()); }
  catch (error) {
    assert.equal(error instanceof RouteReadinessBlockedError, true);
    legacyReceipt = error.receipt;
  }
  assert.ok(legacyReceipt);
  await assert.rejects(
    authority.consume(legacyReceipt, binding()),
    (error) => error.code === 'route_lease_invalid',
  );
  assert.equal(Object.hasOwn(legacyReceipt, 'capability'), false);

  const firstObservationInvalidation = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready' }), credentialEpoch: () => 'epoch',
  });
  assert.equal(firstObservationInvalidation.invalidate(ROUTE).generation, 2);
});

test('P94A-RA1c: prepareMany is all-or-none and consumeMany preserves exact order and one-shot authority', async () => {
  const secondRoute = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
  let blocked = true;
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE, secondRoute],
    evaluate: (route) => blocked && route.harness === secondRoute.harness
      ? { state: 'blocked', code: 'authentication_required', summary: 'not ready' }
      : { state: 'ready' },
  });
  const secondCard = bindingCard(secondRoute, { version: '2.0.0', family: 'openai' });
  const bindings = [binding(), {
    ...secondRoute, version: secondCard.version, taskType: 'general', serviceTier: null,
    workerPolicy: null, card: secondCard,
    effect: effect({ taskId: 'task-second', nodeKey: 'node-second', workerId: 'worker-second' }),
  }];
  await assert.rejects(
    authority.prepareMany(bindings),
    (error) => error instanceof RouteReadinessBlockedError
      && error.receipt?.state === 'waiting_for_route',
  );

  blocked = false;
  const batch = await authority.prepareMany(bindings);
  const receipts = await authority.consumeMany(batch, bindings);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((receipt) => receipt.route), [ROUTE, secondRoute]);
  await assert.rejects(
    authority.consumeMany(batch, bindings),
    (error) => error.code === 'route_lease_replayed' && error.receipts?.length === 2,
  );

  const mismatch = await authority.prepareMany(bindings);
  await assert.rejects(
    authority.consumeMany(mismatch, [...bindings].reverse()),
    (error) => error.code === 'route_lease_invalid',
  );
  await assert.rejects(
    authority.consumeMany(mismatch, bindings),
    (error) => error.code === 'route_lease_replayed',
  );
});

test('P94A-RA1d: same-route fan-out is effect-attributed, atomic, recomputable, and cross-effect replay is refused', async () => {
  let now = Date.parse('2026-07-20T12:00:00.000Z');
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready' }),
    credentialEpoch: ({ harness, model, effort, ...extra }) => {
      assert.deepEqual(extra, {});
      return `${harness}:${model}:${effort}:credential-generation-7`;
    },
    now: () => now,
  });
  const bindings = [
    binding({ effect: effect({ taskId: 'task-a', nodeKey: 'node-a', workerId: 'worker-a' }) }),
    binding({ effect: effect({ taskId: 'task-b', nodeKey: 'node-b', workerId: 'worker-b' }) }),
  ];
  const batch = await authority.prepareMany(bindings);
  now += 5;
  const receipts = await authority.consumeMany(batch, bindings);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0].batch.digest, receipts[1].batch.digest);
  assert.deepEqual(receipts.map((row) => row.batch.ordinal), [0, 1]);
  assert.deepEqual(receipts.map((row) => row.batch.count), [2, 2]);
  assert.notEqual(receipts[0].effectDigest, receipts[1].effectDigest);
  assert.equal(receipts.every((row) => row.consumedAt !== row.issuedAt), true);
  assert.equal(receipts[0].batch.digest, authorityDigest({
    schemaVersion: 1,
    bindingDigests: receipts.map((row) => row.bindingDigest),
    effectDigests: receipts.map((row) => row.effectDigest),
    generations: receipts.map((row) => row.generation),
  }));
  for (const receipt of receipts) {
    const { receiptDigest, ...core } = receipt;
    assert.equal(receiptDigest, authorityDigest(core));
    assert.match(receipt.credentialEpochCommitment, /^[a-f0-9]{64}$/u);
    assert.equal(Object.hasOwn(receipt, 'credentialEpochDigest'), false);
  }
  await assert.rejects(authority.consumeMany(batch, bindings.reverse()),
    (error) => error.code === 'route_lease_replayed');
  await assert.rejects(authority.prepareMany([bindings[0], bindings[0]]),
    (error) => error.code === 'route_admission_invalid');
});

test('P94A-RA1e: the complete binding is closed and coherent beyond taskType', async () => {
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready' }), credentialEpoch: () => 'epoch',
  });
  const mutations = [
    binding({ version: 'other' }),
    binding({ card: { ...bindingCard(), extra: true } }),
    binding({ card: { ...bindingCard(), family: '' } }),
    binding({ card: { ...bindingCard(), harness: 'codex' } }),
    binding({ card: { ...bindingCard(), adapterCardDigest: 'bad' } }),
    binding({ card: { ...bindingCard(), modelSelection: {
      ...bindingCard().modelSelection, available: ['another-model'],
    } } }),
    binding({ workerPolicy: { schemaVersion: 1, requestDigest: 'a'.repeat(64),
      adapterCardDigest: 'b'.repeat(64), resolutionDigest: 'c'.repeat(64), extra: true } }),
    binding({ effect: { ...effect(), processGeneration: 0 } }),
    binding({ serviceTier: 'priority' }),
  ];
  for (const candidate of mutations) {
    await assert.rejects(authority.issue(candidate),
      (error) => error.code === 'route_admission_invalid');
  }
  const original = binding();
  const drifted = binding({ card: bindingCard(ROUTE, { adapterCardDigest: 'b'.repeat(64) }) });
  const lease = await authority.issue(original);
  await assert.rejects(authority.consume(lease, drifted),
    (error) => error.code === 'route_lease_invalid');
  const batch = await authority.prepareMany([
    binding({ effect: effect({ taskId: 'card-a', workerId: 'card-a' }) }),
    binding({ effect: effect({ taskId: 'card-b', workerId: 'card-b' }) }),
  ]);
  await assert.rejects(authority.consumeMany(batch, [
    binding({ card: bindingCard(ROUTE, { adapterCardDigest: 'c'.repeat(64) }),
      effect: effect({ taskId: 'card-a', workerId: 'card-a' }) }),
    binding({ effect: effect({ taskId: 'card-b', workerId: 'card-b' }) }),
  ]), (error) => error.code === 'route_lease_invalid');
});

test('P94A-RA1f: credential generation failure blocks and rotation invalidates an atomic batch with unchanged public readiness', async () => {
  let epoch = 'epoch-a';
  let throws = true;
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready', summary: 'unchanged public readiness' }),
    credentialEpoch: () => { if (throws) throw new Error('private failure'); return epoch; },
  });
  await assert.rejects(authority.issue(binding()), (error) => (
    error instanceof RouteReadinessBlockedError
      && error.receipt.blocker.code === 'credential_epoch_unavailable'
  ));
  throws = false;
  const bindings = [binding({ effect: effect({ taskId: 'a', workerId: 'a' }) }),
    binding({ effect: effect({ taskId: 'b', workerId: 'b' }) })];
  const batch = await authority.prepareMany(bindings);
  epoch = 'epoch-b';
  await assert.rejects(authority.consumeMany(batch, bindings),
    (error) => error.code === 'route_lease_invalid');

  let epochCalls = 0;
  const lateFailure = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready' }),
    credentialEpoch: () => {
      epochCalls += 1;
      if (epochCalls === 3) throw new Error('failed after inspection');
      return 'epoch-stable';
    },
  });
  await assert.rejects(lateFailure.issue(binding()), (error) => (
    error instanceof RouteReadinessBlockedError
      && error.receipt.blocker.code === 'credential_epoch_unavailable'
  ));
});

test('P94A-RA1g: evaluator runtime crosses only the closed public schema and never carries secrets', async () => {
  let runtime = {
    version: { state: 'observed', value: '1.2.3' },
    authentication: { posture: 'subscription', state: 'verified' },
    permissions: { mode: 'never', sandbox: 'workspace', autonomy: 'unattended', access: 'workspace' },
    containment: { filesystem: 'workspace', osSandbox: 'observed', network: 'controlled',
      hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'launch' },
  };
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], evaluate: () => ({ state: 'ready', runtime }), credentialEpoch: () => 'epoch',
  });
  assert.deepEqual((await authority.snapshot()).routes[0].runtime, runtime);
  runtime = { ...runtime, evaluatorSecret: 'api_key=private-runtime-secret' };
  const extra = await authority.snapshot();
  assert.equal(Object.hasOwn(extra.routes[0], 'runtime'), false);
  assert.equal(JSON.stringify(extra).includes('private-runtime-secret'), false);
  runtime = { ...runtime, evaluatorSecret: undefined,
    authentication: { posture: 'subscription', state: 'api_key=private-runtime-secret' } };
  delete runtime.evaluatorSecret;
  assert.equal(Object.hasOwn((await authority.snapshot()).routes[0], 'runtime'), false);
});

test('P94A-RA1h: one closed blocker envelope preserves every public route code and rejects tampered evidence', async () => {
  const codes = [
    'harness_unavailable', 'route_unavailable', 'route_unconfigured', 'route_ambiguous',
    'route_authority_unavailable', 'diagnostic_probe_failed', 'authentication_required',
    'authentication_refresh_required', 'authentication_metadata_invalid',
  ];
  for (const code of codes) {
    const authority = new RouteReadinessAuthority({
      routes: [ROUTE], credentialEpoch: () => 'epoch',
      evaluate: () => ({ state: 'blocked', code, summary: `Public blocker ${code}.` }),
    });
    let cause;
    try { await authority.issue(binding()); } catch (error) { cause = error; }
    const projected = projectRouteReadinessError(cause);
    assert.equal(projected.code, 'route_waiting');
    assert.equal(projected.blocker.code, code);
    assert.equal(projected.receipt.receiptDigest, cause.receipt.receiptDigest);
    assert.equal(JSON.stringify(projected).includes('undefined'), false);
    const tampered = { ...cause.receipt, remediation: 'api_key=must-not-cross' };
    assert.equal(projectRouteReadinessError({ receipt: tampered }), null);
  }
});

test('P94A-RA2: bounded diagnostics are exact-route singleflight and require zero session/prompt plus proved reap', async () => {
  let probes = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE],
    evaluate: () => ({
      state: 'blocked', code: 'diagnostic_probe_required',
      summary: 'A bounded authentication diagnostic is required.',
    }),
    probe: async () => {
      probes += 1;
      await gate;
      return {
        state: 'ready', initialized: true, authenticated: true,
        sessionCreated: false, promptSent: false, reaped: true,
      };
    },
    probeTimeoutMs: 1_000,
  });

  const first = authority.inspect(ROUTE);
  const second = authority.inspect(ROUTE);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes, 1);
  release();
  const states = await Promise.all([first, second]);
  assert.equal(states.every((state) => state.state === 'ready'), true);
  assert.equal(states.every((state) => /reaped/u.test(state.summary)), true);
});

test('P94A-RA2b: a timeout cannot orphan or overlap an abort-ignoring probe, and close drains proved reap', async () => {
  let probes = 0;
  let settleFirst;
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], credentialEpoch: () => 'epoch',
    evaluate: () => ({ state: 'blocked', code: 'diagnostic_probe_required' }),
    probeTimeoutMs: 5,
    probe: () => {
      probes += 1;
      if (probes === 1) return new Promise((resolve) => { settleFirst = resolve; });
      return { state: 'ready', initialized: true, authenticated: true,
        sessionCreated: false, promptSent: false, reaped: true };
    },
  });
  const timed = await authority.inspect(ROUTE);
  assert.equal(timed.code, 'diagnostic_probe_unsettled');
  assert.equal((await authority.inspect(ROUTE)).code, 'diagnostic_probe_unsettled');
  assert.equal(probes, 1);
  let closed = false;
  const closing = authority.close().then((value) => { closed = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  settleFirst({ state: 'blocked', initialized: true, authenticated: false,
    sessionCreated: false, promptSent: false, reaped: true });
  assert.deepEqual(await closing, { state: 'closed', reaped: true });
  assert.equal(probes, 1);
});

test('P94A-RA2c: close drains evaluate races, forbids post-close probes and leases, and bounds a never-settling probe', async () => {
  let releaseEvaluate;
  let probes = 0;
  const evaluateGate = new Promise((resolve) => { releaseEvaluate = resolve; });
  const authority = new RouteReadinessAuthority({
    routes: [ROUTE], credentialEpoch: () => 'epoch', probeTimeoutMs: 20,
    evaluate: () => evaluateGate,
    probe: () => { probes += 1; return {
      state: 'ready', initialized: true, authenticated: true,
      sessionCreated: false, promptSent: false, reaped: true,
    }; },
  });
  const issuing = authority.issue(binding());
  await new Promise((resolve) => setImmediate(resolve));
  const closing = authority.close();
  releaseEvaluate({ state: 'blocked', code: 'diagnostic_probe_required' });
  await assert.rejects(issuing, (error) => error.code === 'route_authority_closed');
  assert.deepEqual(await closing, { state: 'closed', reaped: true });
  assert.equal(probes, 0);
  assert.throws(() => authority.issue(binding()), (error) => error.code === 'route_authority_closed');

  const wedged = new RouteReadinessAuthority({
    routes: [ROUTE], credentialEpoch: () => 'epoch', probeTimeoutMs: 10,
    evaluate: () => ({ state: 'blocked', code: 'diagnostic_probe_required' }),
    probe: () => new Promise(() => {}),
  });
  void wedged.inspect(ROUTE).catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(wedged.close(), (error) => error.code === 'route_probe_unreaped');
});

test('P94A-RA3: a configured transient blocker returns waiting_for_route before task, capacity, runtime, worktree, or provider ownership', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = new Log(join(root, 'log'));
  const coordination = coordinationForLog(log);
  const calls = { reserve: 0, create: 0, runtime: 0, spawn: 0 };
  const adapter = {
    card,
    onEvent() {},
    async spawn() { calls.spawn += 1; return { ok: true }; },
    async prompt() { return { ok: true }; },
    async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
  };
  const worktrees = {
    async reserveCapacity() { calls.reserve += 1; return {}; },
    async create() { calls.create += 1; return { path: join(root, 'worktree') }; },
    async remove() { return true; }, async reconcile() { return []; },
  };
  const routeReadinessAuthority = new RouteReadinessAuthority({
    routes: [ROUTE],
    evaluate: () => ({
      state: 'blocked', code: 'authentication_refresh_required',
      summary: 'Provider authentication must be refreshed.',
    }),
  });
  assert.throws(() => new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { grok: adapter }, worktrees,
    runtimeScopes: { create() { return {}; }, remove() { return true; } },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'grok',
    routeReadinessAuthority: {
      admit() {}, inspect() {}, invalidate() {}, validate() {},
      prepareMany() {}, consumeMany() {}, consume() {},
    },
  }), (error) => error.code === 'coordinator_config_invalid' && /issue\(\)/u.test(error.message));
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { grok: adapter }, worktrees,
    runtimeScopes: { create() { calls.runtime += 1; return {}; }, remove() { return true; } },
    referee: async () => ({ reverified: true, observedExit: 0 }),
    route: () => 'grok', routeReadinessAuthority,
  });

  await assert.rejects(
    coordinator.spawn('grok', {
      goal: 'prove pre-effect route admission', constraints: [], pathScope: ['impl/**'],
      definitionOfDone: 'blocked route owns nothing',
      verification: { command: 'true', expectExit: 0 },
      budget: { tokens: 1_000, usd: 1, wallMin: 1 },
    }, { model: ROUTE.model, effort: ROUTE.effort, taskId: 'phase94a-blocked' }),
    (error) => error instanceof RouteReadinessBlockedError
      && error.code === 'route_waiting'
      && error.receipt?.state === 'waiting_for_route'
      && error.receipt?.blocker?.code === 'authentication_refresh_required',
  );
  assert.deepEqual(calls, { reserve: 0, create: 0, runtime: 0, spawn: 0 });
  assert.equal(coordination.snapshot().tasks.length, 0);
  assert.deepEqual(coordinator.list(), []);
});

test('P94A-RA3b: initial auto-route refusal leaves no durable task, claim, capacity, runtime, worktree, or adapter ownership', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-auto-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = new Log(join(root, 'log'));
  const coordination = coordinationForLog(log);
  const calls = { reserve: 0, activeCapacity: 0, create: 0, runtime: 0, spawn: 0 };
  const adapter = { card, onEvent() {},
    async spawn() { calls.spawn += 1; return { ok: true }; },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; } };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { grok: adapter },
    worktrees: { async reserveCapacity() { calls.reserve += 1; calls.activeCapacity += 1; return {}; },
      async releaseCapacity() { calls.activeCapacity -= 1; return true; }, async create() { calls.create += 1; return {}; },
      async remove() { return true; }, async reconcile() { return []; } },
    runtimeScopes: { create() { calls.runtime += 1; return {}; }, remove() { return true; } },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'grok',
    routeReadinessAuthority: new RouteReadinessAuthority({
      routes: [ROUTE], credentialEpoch: () => 'epoch',
      evaluate: () => ({ state: 'blocked', code: 'route_unavailable', summary: 'blocked' }),
    }),
  });
  await assert.rejects(coordinator.spawn('auto', {
    goal: 'prove auto admission', constraints: [], pathScope: ['impl/**'],
    definitionOfDone: 'no provider ownership', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  }, { model: ROUTE.model, effort: ROUTE.effort, taskId: 'phase94a-auto-blocked' }),
  (error) => error instanceof RouteReadinessBlockedError
    && error.receipt?.state === 'waiting_for_route'
    && error.receipt?.blocker?.code === 'route_unavailable');
  assert.deepEqual(calls, { reserve: 0, activeCapacity: 0, create: 0, runtime: 0, spawn: 0 });
  assert.equal(coordination.task('phase94a-auto-blocked'), null);
  assert.deepEqual(coordination.snapshot().tasks, []);
  assert.deepEqual(coordinator.list(), []);
  const events = log.workers().flatMap((worker) => log.read(worker));
  assert.equal(events.some((event) => event.kind === 'resource.route_admission_consumed'), false);
});

test('P94A-RA3d: a stale post-issue credential race returns to durable waiting with zero resource or provider residue', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-stale-consume-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = new Log(join(root, 'log'));
  const coordination = coordinationForLog(log);
  const calls = { reserve: 0, release: 0, activeCapacity: 0, create: 0, runtime: 0, spawn: 0 };
  let epochCalls = 0;
  let readinessCalls = 0;
  const adapter = { card, onEvent() {},
    async spawn() { calls.spawn += 1; return { ok: true }; },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; } };
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { grok: adapter },
    worktrees: {
      async reserveCapacity() { calls.reserve += 1; calls.activeCapacity += 1; return {}; },
      async releaseCapacity() { calls.release += 1; calls.activeCapacity -= 1; return true; },
      async create() { calls.create += 1; return {}; }, async remove() { return true; },
      async reconcile() { return []; },
    },
    runtimeScopes: { create() { calls.runtime += 1; return {}; }, remove() { return true; } },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'grok',
    routeReadinessAuthority: new RouteReadinessAuthority({
      routes: [ROUTE],
      credentialEpoch: () => { epochCalls += 1; return epochCalls <= 3 ? 'epoch-1' : 'epoch-2'; },
      evaluate: () => {
        readinessCalls += 1;
        return readinessCalls === 1 ? { state: 'ready' } : {
          state: 'blocked', code: 'authentication_refresh_required', summary: 'rotated',
        };
      },
    }),
  });
  const taskId = 'phase94a-stale-consume';
  const handle = await coordinator.spawn('grok', {
    goal: 'prove stale consume cleanup', constraints: [], pathScope: ['impl/**'],
    definitionOfDone: 'wait without ownership', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 },
  }, { model: ROUTE.model, effort: ROUTE.effort, taskId });
  for (let index = 0; index < 20
    && coordinator.list().find((row) => row.id === handle.id)?.status !== 'blocked'; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(calls, {
    reserve: 1, release: 1, activeCapacity: 0, create: 0, runtime: 0, spawn: 0,
  });
  assert.equal(coordination.task(taskId).status, 'pending',
    'the approved durable task remains retryable while owning no live resource');
  assert.equal(coordinator.list().find((row) => row.id === handle.id)?.status, 'blocked');
  assert.equal(coordinator._workers.get(handle.id).localAuthority, false);
  const receipts = log.read(handle.id)
    .filter((event) => event.kind === 'resource.route_admission_consumed');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].payload.receipt.state, 'waiting_for_route');
  assert.equal(receipts[0].payload.receipt.blocker.code, 'authentication_refresh_required');
});

test('P94A-RA3c: restart rechecks a capacity-delayed durable task and never reconstructs its prepared lease', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-restart-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = new Log(join(root, 'log'));
  const coordination = coordinationForLog(log);
  let readiness = 'ready';
  const firstCalls = { spawn: 0 };
  const firstAdapter = { card, onEvent() {},
    async spawn() { firstCalls.spawn += 1; return { ok: true }; },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; } };
  const sharedCapacity = new Set();
  const first = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { grok: firstAdapter },
    worktrees: { async reserveCapacity(taskId) { sharedCapacity.add(taskId); return {}; },
      async releaseCapacity(taskId) { sharedCapacity.delete(taskId); return true; },
      async create() { return {}; }, async remove() { return true; }, async reconcile() { return []; } },
    runtimeScopes: { create() { return {}; }, remove() { return true; } },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'grok',
    routeReadinessAuthority: new RouteReadinessAuthority({
      routes: [ROUTE], credentialEpoch: () => 'epoch',
      evaluate: () => readiness === 'ready' ? { state: 'ready' }
        : { state: 'blocked', code: 'authentication_refresh_required', summary: 'rotated' },
    }),
  });
  const brief = { goal: 'restart gate', constraints: [], pathScope: ['impl/**'],
    definitionOfDone: 'no stale dispatch', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: 1 } };
  await first.spawn('grok', brief, { model: ROUTE.model, effort: ROUTE.effort, taskId: 'occupier' });
  const delayed = await first.spawn('grok', brief,
    { model: ROUTE.model, effort: ROUTE.effort, taskId: 'delayed' });
  assert.equal(delayed.status, 'pending');
  assert.equal(firstCalls.spawn, 1);
  assert.equal(sharedCapacity.has('delayed'), true);

  readiness = 'blocked';
  const replayCalls = { runtime: 0, worktree: 0, spawn: 0 };
  const replayAdapter = { ...firstAdapter,
    card: () => ({ ...card(), concurrencyCeiling: 2 }),
    async spawn() { replayCalls.spawn += 1; return { ok: true }; } };
  const replayed = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { grok: replayAdapter },
    worktrees: { async reserveCapacity(taskId) { sharedCapacity.add(taskId); return {}; },
      async releaseCapacity(taskId) { sharedCapacity.delete(taskId); return true; },
      async create() { replayCalls.worktree += 1; return {}; }, async remove() { return true; },
      async reconcile() { return []; } },
    runtimeScopes: { create() { replayCalls.runtime += 1; return {}; }, remove() { return true; } },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'grok',
    routeReadinessAuthority: new RouteReadinessAuthority({
      routes: [ROUTE], credentialEpoch: () => 'epoch-rotated',
      evaluate: () => ({ state: 'blocked', code: 'authentication_refresh_required', summary: 'rotated' }),
    }),
  });
  await replayed.startupReady();
  try { replayed.tick(); } catch (error) {
    if (error.code !== 'session_recovery_pending') throw error;
  }
  for (let index = 0; index < 20 && replayed.list().find((row) => row.taskId === 'delayed')?.status !== 'blocked'; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(replayCalls, { runtime: 0, worktree: 0, spawn: 0 });
  assert.equal(coordination.task('delayed').status, 'pending');
  assert.equal(sharedCapacity.has('delayed'), false);
  const waiting = log.read(coordination.task('delayed').reservedWorkerId)
    .filter((event) => event.kind === 'resource.route_admission_consumed');
  assert.equal(waiting.at(-1).payload.receipt.state, 'waiting_for_route');
  assert.equal(waiting.at(-1).payload.receipt.cardDigest, authorityDigest(replayAdapter.card()));
});

test('P94A-RA4: Wave authorization and approved preview precede all-or-none readiness, then no resource or provider effect occurs', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-wave-admission-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const log = new Log(join(root, 'log'));
  const repoId = 'repo-phase94a-wave';
  const policy = normalizeGoalPlanPolicy({
    schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60_000,
    riskClasses: ['low', 'medium', 'high', 'critical'],
    effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
    limits: {
      maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
      maxTextBytes: 4_096, maxItems: 32, maxScopePaths: 32, maxRouteValues: 8,
      maxGoalBytes: 64 * 1_024, maxPlanBytes: 128 * 1_024, maxStatusBytes: 128 * 1_024,
      maxTokens: 100_000, maxUsd: 100, maxWallMin: 60, maxProviderTurns: 100,
    },
  });
  const coordination = new CoordinationStore(join(root, 'coordination'), {
    goalPlanPolicy: policy,
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  t.after(() => { try { coordination.releaseWriterLease(); } catch {} });
  const auth = (principalId, key, runId = null) => ({
    actor: `direct:${principalId}`, principalId,
    sessionDigest: canonicalDigest(`session:${principalId}`), repoId, runId, key,
  });
  const runId = 'run-phase94a-wave';
  const goal = coordination.defineGoal({
    objective: 'Prove atomic route admission', definitionOfDone: ['No partial Wave ownership'],
    constraints: [], risk: 'high',
    budget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 }, predecessor: null,
  }, auth('owner', 'goal', runId)).goal;
  const routes = [ROUTE, ROUTE];
  const plan = coordination.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: routes.map((route, index) => ({
      key: `node-${index}`, objective: `Execute node ${index}`,
      definitionOfDone: ['No partial Wave ownership'], deps: [], pathScope: ['impl/**'], risk: 'high',
      budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
      verification: {
        command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
        expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000,
        maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [],
      },
      routes: { schemaVersion: 2, allowed: [route] },
      capabilities: ['code', 'test'], effects: ['repository_edit', 'provider_call'],
    })),
  }, auth('planner', 'plan', runId)).plan;
  coordination.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'approval', runId));
  const calls = { authorize: 0, capacity: 0, runtime: 0, worktree: 0, spawn: 0 };
  const order = [];
  const adapters = Object.fromEntries(routes.map((route, index) => [route.harness, {
    card: () => ({
      ...card(), harness: route.harness, version: `1.0.${index}`,
      modelSelection: {
        ...card().modelSelection, configuredDefault: route.model, available: [route.model],
        reasoningEffort: [route.effort], family: route.harness,
      },
    }),
    onEvent() {}, async spawn() { calls.spawn += 1; return { ok: true }; },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
  }]));
  let blocked = true;
  const routeReadinessAuthority = new RouteReadinessAuthority({
    routes: [ROUTE],
    evaluate: () => { order.push('readiness'); return blocked
      ? { state: 'blocked', code: 'authentication_required', summary: 'not authenticated' }
      : { state: 'ready' }; },
  });
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters,
    worktrees: {
      async reserveCapacityMany() { calls.capacity += 1; return [null, null]; },
      async create() { calls.worktree += 1; return {}; }, async remove() { return true; },
      async reconcile() { return []; },
    },
    runtimeScopes: { create() { calls.runtime += 1; return {}; }, remove() { return true; } },
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'grok',
    repoId, routeReadinessAuthority,
    goalPlanAuthority: { policy, authorize: async ({ principalId }) => {
      calls.authorize += 1; order.push('authorize'); return principalId !== 'intruder';
    } },
  });
  const members = routes.map((route, index) => {
    const node = plan.nodes[index];
    const gate = {
      goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
      planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
      nodeKey: node.key, expectedDispatchVersion: 0,
      capabilities: node.capabilities, effects: node.effects,
    };
    const preview = coordination.previewPlanDispatch(gate, {
        vendor: route.harness, model: route.model, effort: route.effort,
      }).brief;
    const { goalPlan: _goalPlan, ...brief } = preview;
    return {
      brief,
      effort: route.effort, goalPlan: gate, model: route.model, runId,
      taskId: `phase94a-wave-${index}`, vendor: route.harness,
    };
  });

  await assert.rejects(
    coordinator.spawnPlanWave(members.map((member, index) => ({
      ...member, taskId: `phase94a-unauthorized-wave-${index}`,
      ...(index === 0 ? { vendor: 'unconfigured-secret-route' } : {}),
    })), {
      actor: 'direct:intruder', principalId: 'intruder', sessionId: 'intruder-session',
      powers: ['plan:dispatch'], idempotencyKey: 'unauthorized-wave-dispatch',
    }),
    (error) => error.code === 'goal_plan_unauthorized',
  );
  assert.equal(calls.authorize, 1);
  assert.deepEqual(order, ['authorize']);
  order.length = 0;

  const before = coordination.snapshot().lastSeq;
  await assert.rejects(
    coordinator.spawnPlanWave(members, {
      actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
      powers: ['plan:dispatch'], idempotencyKey: 'wave-dispatch',
    }),
    (error) => error instanceof RouteReadinessBlockedError
      && error.receipt?.state === 'waiting_for_route'
      && error.receipt?.reaped === true,
  );
  assert.equal(coordination.snapshot().lastSeq, before);
  assert.equal(coordination.snapshot().tasks.length, 0);
  assert.deepEqual(calls, { authorize: 2, capacity: 0, runtime: 0, worktree: 0, spawn: 0 });
  assert.deepEqual(order.slice(0, 3), ['authorize', 'readiness', 'readiness']);
  assert.deepEqual(coordinator.list(), []);

  blocked = false;
  const originalPrepareMany = routeReadinessAuthority.prepareMany.bind(routeReadinessAuthority);
  const originalConsumeMany = routeReadinessAuthority.consumeMany.bind(routeReadinessAuthority);
  let batchPrepares = 0;
  let batchConsumes = 0;
  routeReadinessAuthority.prepareMany = async (...args) => {
    batchPrepares += 1;
    return originalPrepareMany(...args);
  };
  routeReadinessAuthority.consumeMany = async (...args) => {
    batchConsumes += 1;
    if (batchConsumes === 1) throw Object.assign(
      new Error('adversarial whole-batch expiry/mismatch before provider effect'),
      { code: 'route_lease_invalid' },
    );
    return originalConsumeMany(...args);
  };
  const admitted = await coordinator.spawnPlanWave(members, {
    actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
    powers: ['plan:dispatch'], idempotencyKey: 'wave-dispatch-ready',
  });
  assert.equal(admitted.length, 2);
  for (let index = 0; index < 20 && calls.spawn < 2; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(calls.spawn, 2);
  assert.equal(batchPrepares, 2,
    'one invalid batch reparses and reprepares the complete exact fan-out once');
  assert.equal(batchConsumes, 2);
  const consumed = log.workers().flatMap((worker) => log.read(worker))
    .filter((event) => event.kind === 'resource.route_admission_consumed');
  assert.equal(consumed.length, 2);
  assert.equal(consumed[0].payload.receipt.batch.digest, consumed[1].payload.receipt.batch.digest);
  assert.notEqual(consumed[0].payload.receipt.effectDigest, consumed[1].payload.receipt.effectDigest);

  const replayRunId = 'run-phase94a-single-replay';
  const replayGoal = coordination.defineGoal({
    objective: 'Prove historical Plan task reconciliation',
    definitionOfDone: ['No second live route lease'], constraints: [], risk: 'high',
    budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 }, predecessor: null,
  }, auth('owner', 'replay-goal', replayRunId)).goal;
  const replayNode = {
    key: 'single', objective: 'Dispatch exactly once',
    definitionOfDone: ['No second live route lease'], deps: [], pathScope: ['impl/**'], risk: 'high',
    budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    verification: {
      command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
      expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000,
      maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [],
    },
    routes: { schemaVersion: 2, allowed: [ROUTE] },
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const invalidPlan = {
    goal: { goalId: replayGoal.goalId, version: replayGoal.version, digest: replayGoal.digest },
    predecessor: null,
    nodes: [{ ...replayNode, routes: {
      harnesses: [ROUTE.harness], models: [ROUTE.model, 'unconfigured-model'],
      efforts: [ROUTE.effort],
    } }],
  };
  const authCallsBeforeInvalidRoute = calls.authorize;
  await assert.rejects(coordinator.proposePlan(invalidPlan, {
    actor: 'direct:intruder', principalId: 'intruder', sessionId: 'intruder-session',
    powers: ['plan:propose'], repoId, runId: replayRunId,
    idempotencyKey: 'unauthorized-invalid-legacy-route',
  }), (error) => error.code === 'goal_plan_unauthorized');
  assert.equal(calls.authorize, authCallsBeforeInvalidRoute + 1,
    'unauthorized Plan callers cannot distinguish configured route truth');
  await assert.rejects(coordinator.proposePlan(invalidPlan, {
    actor: 'direct:planner', principalId: 'planner', sessionId: 'planner-session',
    powers: ['plan:propose'], repoId, runId: replayRunId, idempotencyKey: 'invalid-legacy-route',
  }), (error) => error.code === 'route_unconfigured');
  assert.equal(calls.authorize, authCallsBeforeInvalidRoute + 2,
    'authorized legacy Cartesian validation follows Plan authorization');
  const replayPlan = coordination.proposePlan({
    goal: { goalId: replayGoal.goalId, version: replayGoal.version, digest: replayGoal.digest },
    predecessor: null, nodes: [replayNode],
  }, auth('planner', 'replay-plan', replayRunId)).plan;
  coordination.approvePlan({
    goal: { goalId: replayGoal.goalId, version: replayGoal.version, digest: replayGoal.digest },
    plan: { planId: replayPlan.planId, version: replayPlan.version, digest: replayPlan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', 'replay-approval', replayRunId));
  const replayGate = {
    goalId: replayGoal.goalId, goalVersion: replayGoal.version, goalDigest: replayGoal.digest,
    planId: replayPlan.planId, planVersion: replayPlan.version, planDigest: replayPlan.digest,
    nodeKey: replayNode.key, expectedDispatchVersion: 0,
    capabilities: replayNode.capabilities, effects: replayNode.effects,
  };
  const replayPreview = coordination.previewPlanDispatch(replayGate, {
    vendor: ROUTE.harness, model: ROUTE.model, effort: ROUTE.effort,
  }).brief;
  const { goalPlan: _replayGoalPlan, ...replayBrief } = replayPreview;
  const replayOptions = {
    taskId: 'phase94a-single-replay', runId: replayRunId, model: ROUTE.model,
    effort: ROUTE.effort, goalPlan: replayGate, actor: 'direct:dispatcher',
    principalId: 'dispatcher', sessionId: 'dispatcher-session', powers: ['plan:dispatch'],
    idempotencyKey: 'single-plan-dispatch',
  };
  blocked = false;
  const firstHistorical = await coordinator.spawn(ROUTE.harness, replayBrief, replayOptions);
  const readinessEvaluations = order.filter((step) => step === 'readiness').length;
  const priorReceiptCount = log.workers().flatMap((worker) => log.read(worker))
    .filter((event) => event.kind === 'resource.route_admission_consumed').length;
  blocked = true;
  const replay = await coordinator.spawn(ROUTE.harness, replayBrief, replayOptions);
  assert.equal(replay.id, firstHistorical.id);
  assert.equal(order.filter((step) => step === 'readiness').length, readinessEvaluations,
    'historical reconciliation must not mint or consume live route authority');
  assert.equal(log.workers().flatMap((worker) => log.read(worker))
    .filter((event) => event.kind === 'resource.route_admission_consumed').length,
  priorReceiptCount);
});

test('P94A-K1: revoked Kimi metadata is zero-process and valid metadata uses only a reaped auth probe', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-kimi-revoked-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const kimiRoot = join(home, '.kimi-code');
  const credentialPath = join(kimiRoot, 'credentials', 'kimi-code.json');
  const marker = join(root, 'kimi-probe-frames.ndjson');
  const diagnosticMarker = join(root, 'kimi-diagnostic-runtime.json');
  mkdirSync(repo, { recursive: true });
  for (const path of [join(kimiRoot, 'bin'), dirname(credentialPath), join(kimiRoot, 'oauth')]) {
    mkdirSync(path, { recursive: true });
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase94a-kimi@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 94A Kimi'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Phase 94A Kimi\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  writeFileSync(join(kimiRoot, 'config.toml'), '[auth]\nmethod = "oauth"\n');
  writeFileSync(join(kimiRoot, 'device_id'), 'phase94a-device\n', { mode: 0o600 });
  writeFileSync(join(kimiRoot, 'oauth', 'kimi-code'), 'fixture\n', { mode: 0o600 });
  writeFileSync(credentialPath, `${JSON.stringify({
    access_token: '', refresh_token: '', expires_at: 0, scope: 'fixture',
    token_type: 'Bearer', expires_in: 0,
  })}\n`, { mode: 0o600 });
  const kimi = join(kimiRoot, 'bin', 'kimi');
  writeFileSync(kimi, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then printf "Kimi Code v9.8.7\\n"; exit 0; fi',
    `printf '{"cwd":"%s","home":"%s","ambient":"%s","argv":"%s"}\\n' "$PWD" "$HOME" "\${BATON_KIMI_AMBIENT_CANARY-}" "$*" > ${JSON.stringify(diagnosticMarker)}`,
    `export FAKE_KIMI_LOG=${JSON.stringify(marker)}`,
    `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(import.meta.dirname, 'fixtures', 'fake-kimi-acp.mjs'))} --serve`,
    '',
  ].join('\n'));
  chmodSync(kimi, 0o700);

  const validCredential = {
    access_token: 'fixture-private-access', refresh_token: 'fixture-private-refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3_600, scope: 'fixture',
    token_type: 'Bearer', expires_in: 3_600,
  };
  const script = [
    `const { openBaton } = await import(${JSON.stringify(INDEX_URL)});`,
    `const { existsSync, readFileSync, writeFileSync } = await import('node:fs');`,
    `const route = ${JSON.stringify(KIMI_ROUTE)};`,
    `const credentialPath = ${JSON.stringify(credentialPath)};`,
    `const deployment = await openBaton({ repo: ${JSON.stringify(repo)}, advanced: {`,
    ` deploymentRoot: ${JSON.stringify(join(root, 'deployment'))}, routes: [route],`,
    ' verification: { command: "node", arguments: ["--version"] },',
    '} });',
    'const before = await deployment.doctor();',
    `const probedWhileRevoked = existsSync(${JSON.stringify(marker)});`,
    'let refusal = null; let started = null;',
    'try { started = await deployment.run("must remain pre-provider", { exact: route }); }',
    'catch (error) { refusal = { code: error?.code, receipt: error?.receipt ?? null }; }',
    `writeFileSync(credentialPath, ${JSON.stringify(`${JSON.stringify(validCredential)}\n`)}, { mode: 0o600 });`,
    'const after = await deployment.doctor();',
    `const probeFrames = readFileSync(${JSON.stringify(marker)}, 'utf8').trim().split('\\n').map(JSON.parse);`,
    `const diagnosticRuntime = JSON.parse(readFileSync(${JSON.stringify(diagnosticMarker)}, 'utf8'));`,
    'const card = deployment.card().readiness;',
    'await deployment.close();',
    'process.stdout.write(JSON.stringify({ before, probedWhileRevoked, refusal, started, after, card, probeFrames, diagnosticRuntime }));',
  ].join('\n');
  const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, HOME: home, BATON_KIMI_AMBIENT_CANARY: 'must-not-cross' },
  }));
  assert.equal(observed.before.routes[0].state, 'blocked');
  assert.equal(observed.before.routes[0].runtime.authentication.state, 'revoked');
  assert.equal(observed.probedWhileRevoked, false);
  assert.equal(observed.refusal, null);
  assert.ok(observed.started);
  assert.equal(observed.after.routes[0].state, 'ready');
  assert.deepEqual(observed.card, observed.after);
  assert.deepEqual(observed.probeFrames.map((frame) => frame.method), ['initialize', 'authenticate']);
  assert.equal(observed.probeFrames.some((frame) => /^session\//u.test(frame.method)), false);
  assert.equal(observed.diagnosticRuntime.argv, 'acp');
  assert.equal(observed.diagnosticRuntime.ambient, '');
  assert.notEqual(observed.diagnosticRuntime.home, home);
  assert.match(observed.diagnosticRuntime.cwd, /runtime\/route-readiness\/probe-/u);
  assert.equal(JSON.stringify(observed).includes('fixture-private'), false);
});

test('P94A-C1: deployment close drains Web/application owners before surfacing an unreaped diagnostic', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-close-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  mkdirSync(repo, { recursive: true }); mkdirSync(home); mkdirSync(configRoot);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase94a-close@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 94A close'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# close\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  let probeStarted;
  const started = new Promise((resolve) => { probeStarted = resolve; });
  const adapter = {
    card: () => ({ ...card(), readiness: { state: 'ready' } }), onEvent() {},
    routeReadinessProbe: ({ signal }) => new Promise((resolve) => {
      probeStarted();
      signal.addEventListener('abort', () => resolve({
        state: 'blocked', initialized: true, authenticated: false,
        sessionCreated: false, promptSent: false, reaped: false,
      }), { once: true });
    }),
    async spawn() { return { ok: false }; }, async prompt() { return { ok: true }; },
    async interrupt() { return { ok: true }; }, async kill() { return { ok: true }; },
  };
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  const deployment = await openBaton({ repo, advanced: {
    deploymentRoot: join(root, 'deployment'), adapters: { grok: adapter }, routes: [ROUTE],
    verification: { command: 'node', arguments: ['--version'] }, resident: { env, home },
  } });
  await deployment.host();
  const diagnosing = deployment.doctor();
  await started;
  let closeFailure;
  try { await deployment.close(); } catch (error) { closeFailure = error; }
  assert.equal(closeFailure?.code, 'deployment_close_incomplete');
  assert.equal(closeFailure?.errors?.some((error) => error.code === 'route_probe_unreaped'), true);
  assert.equal(closeFailure.cleanup.state, 'closed_degraded');
  assert.equal(closeFailure.cleanup.readiness.reaped, false);
  await assert.rejects(diagnosing, (error) => error.code === 'route_authority_closed');
  await assert.rejects(deployment.run('closed deployment cannot dispatch', { exact: ROUTE }),
    (error) => ['application_closed', 'coordinator_closed'].includes(error.code));
  assert.throws(() => discoverBatonConnection({ cwd: repo, env, home }),
    (error) => error.code === 'cli_config_invalid');
});

test('P94A-P1: direct, resident Web, and connected MCP expose one sanitized live route truth', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase94a-parity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  mkdirSync(repo, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(configRoot, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase94a-parity@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 94A parity'], { cwd: repo });
  writeFileSync(join(repo, 'README.md'), '# Phase 94A parity\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  let state = 'blocked';
  let probes = 0;
  let providerStarts = 0;
  let cleanupDeployment = null;
  let cleanupMcp = null;
  let cleanupMcpCoordination = null;
  let cleanupReopened = null;
  t.after(async () => {
    await Promise.allSettled([
      cleanupMcp?.close(), cleanupReopened?.close(), cleanupDeployment?.close(),
    ].filter(Boolean));
    try { cleanupMcpCoordination?.releaseWriterLease(); } catch {}
  });
  const parityCard = () => ({ ...card(), concurrencyCeiling: 8, readiness: { state: 'ready' } });
  const adapter = {
    card: parityCard, onEvent() {},
    async routeReadinessProbe() {
      probes += 1;
      return { state: state === 'ready' ? 'ready' : 'blocked', initialized: true,
        authenticated: state === 'ready', sessionCreated: false, promptSent: false, reaped: true };
    },
    async spawn(_worker, _brief, options) {
      providerStarts += 1;
      await options.worktreeReady;
      return { ok: false, reason: 'fixture provider boundary observed' };
    },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async kill() { return { ok: true }; },
  };
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: configRoot };
  const deploymentRoot = join(root, 'deployment');
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot, adapters: { grok: adapter }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--version'] },
      resident: { env, home },
    },
  });
  cleanupDeployment = deployment;
  await deployment.host();
  const probesAfterHost = probes;
  const connected = await connectBaton({ repo, advanced: { env, home } });
  assert.equal(probesAfterHost, 0, 'resident host static self-check launches no provider diagnostic');
  assert.equal(probes, 0, 'UI/Web connection and static card discovery launch no provider diagnostic');
  const probesBeforeWebDoctor = probes;
  const webBlocked = await connected.doctor();
  assert.equal(probes, probesBeforeWebDoctor + 1,
    'an explicit authenticated Web doctor performs one bounded live probe');
  const directBlocked = await deployment.doctor();
  const connection = discoverBatonConnection({ cwd: repo, env, home });
  const fetchImpl = createLocalSocketFetch({
    socketPath: connection.socketPath, baseUrl: connection.baseUrl,
    ownerUid: typeof process.getuid === 'function' ? process.getuid() : null,
  });
  const mcpCoordination = coordinationForLog(new Log(join(root, 'mcp-log')));
  cleanupMcpCoordination = mcpCoordination;
  const probesBeforeMcpConnect = probes;
  const mcp = await createBatonWebMcpServer({ coordination: mcpCoordination, connection, fetchImpl });
  cleanupMcp = mcp;
  assert.equal(probes, probesBeforeMcpConnect,
    'MCP connection and static capability/card discovery launch no provider diagnostic');
  assert.deepEqual(webBlocked.deployment, directBlocked);
  assert.deepEqual(mcp.application.card().readiness, directBlocked);
  assert.equal(JSON.stringify(webBlocked).includes(home), false);
  const directWaiting = await deployment.run('direct route parity', { exact: ROUTE });
  await directWaiting.approve();
  assert.equal(directWaiting.last.phase ?? directWaiting.last.outline?.phase, 'waiting_for_route');
  const directWaitingView = await directWaiting.status();
  assert.equal(directWaitingView.attention?.some((item) => (
    item.kind === 'route_readiness'
      && item.blocker.code === 'diagnostic_probe_failed'
      && typeof item.remediation === 'string'
  )), true);
  assert.equal(directWaitingView.nextActions?.some((item) => item.kind === 'retry_route'), true);
  const retryAction = (await directWaiting.actions()).find((item) => item.kind === 'retry_route');
  assert.equal(retryAction?.priority, 'optional');
  const probesBeforeAutomaticDrive = probes;
  assert.equal((await directWaiting.drive()).outline.phase, 'waiting_for_route');
  assert.equal((await directWaiting.complete()).outline.phase, 'waiting_for_route');
  assert.equal(probes, probesBeforeAutomaticDrive,
    'automatic drive/complete cannot invoke the deliberate retry_route action');
  const webWaiting = await connected.runs.start('resident Web route parity', { exact: ROUTE });
  await webWaiting.approve();
  assert.equal(webWaiting.last.phase ?? webWaiting.last.outline?.phase, 'waiting_for_route');
  await mcp.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase94a', version: '1' } },
  });
  await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const mcpBlocked = await mcp.handle({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'baton_run_start', arguments: {
      intent: { runId: 'run-phase94a-mcp-blocked', objective: 'MCP route parity', route: ROUTE },
    } },
  });
  assert.equal(mcpBlocked.result.isError, false);
  assert.match(mcpBlocked.result.content[0].text, /awaiting_plan_approval/u);
  const mcpStartView = JSON.parse(mcpBlocked.result.content[0].text);
  const approveAction = mcpStartView.outline?.actions?.find((action) => action.kind === 'approve_plan');
  assert.ok(approveAction?.actionId);
  const mcpWaiting = await mcp.handle({
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'baton_run_act', arguments: {
        runId: mcpStartView.runId, actionId: approveAction.actionId, inputs: {},
      },
    },
  });
  assert.equal(mcpWaiting.result.isError, false);
  assert.match(mcpWaiting.result.content[0].text, /waiting_for_route/u);

  const cliWaiting = await connected.runs.start('CLI route retry parity', { exact: ROUTE });
  await cliWaiting.approve();
  const replayWaiting = await deployment.run('durable waiting replay parity', { exact: ROUTE });
  await replayWaiting.approve();
  const rawClient = new BatonWebClient({
    baseUrl: connection.baseUrl, origin: connection.origin, repoId: connection.repoId,
    token: connection.token, fetchImpl, commandTimeoutMs: 30_000, pollMs: 10,
    clock: Date.now, sleep: async (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });

  state = 'ready';
  assert.equal((await directWaiting.act('retry_route')).outline.phase, 'running');
  assert.equal((await webWaiting.act('retry_route')).outline.phase, 'running');
  const mcpWaitingView = JSON.parse(mcpWaiting.result.content[0].text);
  const mcpRetryAction = mcpWaitingView.outline.actions.find((action) => action.kind === 'retry_route');
  const mcpRetried = await mcp.handle({
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: {
      name: 'baton_run_act', arguments: {
        runId: mcpWaitingView.runId, actionId: mcpRetryAction.actionId, inputs: {},
      },
    },
  });
  assert.equal(mcpRetried.result.isError, false);
  const cliRetried = await runBatonCli(parseBatonCli([
    'run', 'do', cliWaiting.id, 'retry_route', '--idempotency-key', 'phase94a-cli-retry',
  ]), rawClient);
  assert.equal(cliRetried.outline.phase, 'running');
  for (let index = 0; index < 40 && providerStarts < 4; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(providerStarts, 4,
    'direct, connected Web, MCP, and CLI deliberate retries each cross one provider boundary');
  for (let index = 0; index < 100; index += 1) {
    const phases = await Promise.all([
      directWaiting.status(), webWaiting.status(),
      rawClient.command('run.status', { runId: mcpWaitingView.runId }),
      rawClient.command('run.status', { runId: cliWaiting.id }),
    ]);
    if (phases.every((view) => view.phase === 'failed')) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual((await Promise.all([
    directWaiting.status(), webWaiting.status(),
    rawClient.command('run.status', { runId: mcpWaitingView.runId }),
    rawClient.command('run.status', { runId: cliWaiting.id }),
  ])).map((view) => view.phase), ['failed', 'failed', 'failed', 'failed']);
  const probesBeforeReadyWebDoctor = probes;
  const webReady = await connected.doctor();
  assert.equal(probes, probesBeforeReadyWebDoctor + 1);
  const directReady = await deployment.doctor();
  assert.deepEqual(webReady.deployment, directReady);
  assert.deepEqual(await mcp.application.readiness(), directReady);
  assert.deepEqual(mcp.application.card().readiness, directReady);
  await mcp.close();
  cleanupMcp = null;
  state = 'blocked';
  await deployment.close();
  cleanupDeployment = null;
  const reopened = await openBaton({
    repo,
    advanced: {
      deploymentRoot, adapters: { grok: adapter }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--version'] },
      resident: { env, home },
    },
  });
  cleanupReopened = reopened;
  const replayed = await reopened.runs.attach(replayWaiting.id);
  assert.equal(replayed.last.outline.phase, 'waiting_for_route');
  assert.equal(replayed.last.outline.resources.ownedCount, 0);
  await reopened.close();
  cleanupReopened = null;
});
