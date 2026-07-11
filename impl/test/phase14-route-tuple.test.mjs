import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeTupleKey, resolveEffort } from '../src/route-tuple.mjs';
import { Coordinator, ModelSelectionError } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { buildClaudeSessionArgs } from '../src/claude-session.mjs';
import { withGrokModelArgs } from '../src/grok-acp.mjs';
import { WebNorthbound, validateWebCommandEnvelope } from '../src/web-northbound.mjs';

const card = (efforts = ['low', 'high']) => ({
  harness: 'codex', version: '2',
  concurrencyCeiling: 4,
  sessions: { resume: 'unsupported', fork: 'unsupported' },
  modelSelection: {
    mode: 'exact', family: 'openai', configuredDefault: 'gpt-exact', available: ['gpt-exact'],
    acceptedAliases: [], acceptedPrefixes: [], reasoningEffort: efforts, configuredEffort: 'low', serviceTier: null,
  },
});
const brief = () => ({
  goal: 'route tuple', constraints: [], pathScope: ['**'], definitionOfDone: 'done',
  verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 },
});
const until = async (fn, timeoutMs = 2000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error('timed out');
};
function stubAdapter(name, efforts, calls = []) {
  return {
    cb: null,
    onEvent(cb) { this.cb = cb; },
    card: () => ({ ...card(efforts), harness: name }),
    async spawn(worker, _brief, opts) { calls.push({ op: 'spawn', worker, opts }); return { ok: true }; },
    async prompt() { return { ok: true }; }, async interrupt() { return { ok: true }; },
    async approve() { return { ok: true }; }, async answer() { return { ok: true }; },
    async kill(worker) {
      calls.push({ op: 'kill', worker });
      queueMicrotask(() => this.cb?.({ worker, harness: name, turnEpoch: 2, actor: 'worker', kind: 'kill.confirmed', payload: {} }));
      return { ok: true };
    },
  };
}
function system(adapters, route, hooks = {}) {
  const log = hooks.log ?? new Log(mkdtempSync(join(tmpdir(), 'baton-rt-log-')));
  const coordination = hooks.coordination ?? coordinationForLog(log);
  const captureOpts = hooks.captureOpts ?? [];
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters,
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/${taskId}` }),
      capture: async (_path, opts) => { captureOpts.push(opts); return { sha: `sha-${captureOpts.length}`, snapshotted: true }; },
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      integrate: async (sha) => ({ beforeSha: 'base', resultSha: sha, afterSha: sha }),
      retainResult: async () => 'refs/baton/test', releaseResult: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route,
    approvalTimeoutMs: 1000, stopDeadlineMs: 100,
  });
  return { coordinator, log, coordination, captureOpts };
}

test('RT11.2: exact effort validation rejects empty inventories and unsupported values', () => {
  assert.deepEqual(resolveEffort(card(), 'high'), { ok: true, effort: 'high' });
  assert.equal(resolveEffort(card([]), 'high').ok, false);
  assert.equal(resolveEffort({ ...card(), modelSelection: { reasoningEffort: null } }, 'high').ok, false);
});

test('RT11.3/4: stable tuple learning identity separates resolved low and high buckets', () => {
  const low = routeTupleKey(card(), 'gpt-exact', 'low', 'build');
  const high = routeTupleKey(card(), 'gpt-exact', 'high', 'build');
  assert.notEqual(low, high);
  assert.equal(low, routeTupleKey(card(), 'gpt-exact', 'low', 'build'));
});

test('RT11.1/9: web dispatch forwards effort independently of modelPolicy', async () => {
  let call;
  const northbound = Object.create(WebNorthbound.prototype);
  northbound.coordinator = { spawn: async (...args) => { call = args; return { id: 'w-1' }; } };
  const response = await northbound._dispatch({ command: 'spawn', commandId: 'c1', args: {
    harness: 'codex', model: 'gpt-exact', effort: 'high', modelPolicy: { allow: ['gpt-exact'] }, brief: {},
  } }, 'web:u:s');
  assert.equal(response.status, 200);
  assert.equal(call[2].effort, 'high');
  assert.deepEqual(call[2].modelPolicy, { allow: ['gpt-exact'] });
  const invalid = {
    schemaVersion: 1, commandId: 'c2', idempotencyKey: 'c2', command: 'spawn', repoId: 'repo', origin: 'https://control.test',
    args: { harness: 'codex', effort: '', brief: {} },
  };
  assert.match(validateWebCommandEnvelope(invalid), /effort must be a non-empty string/);
});

test('RT11.7: Claude and Grok native controls preserve exact effort', () => {
  assert.deepEqual(buildClaudeSessionArgs({ effort: 'high', permissionMode: null }).slice(-2), ['--effort', 'high']);
  assert.deepEqual(withGrokModelArgs([], { reasoningEffort: 'low' }), ['--reasoning-effort', 'low']);
});

test('RT11.1/2: direct spawn forwards exact effort and conflicts/refusals allocate nothing', async () => {
  const calls = [];
  const adapter = stubAdapter('codex', ['low', 'high'], calls);
  const { coordinator, coordination } = system({ codex: adapter }, () => 'codex');
  const handle = await coordinator.spawn('codex', brief(), { taskId: 'direct-high', model: 'gpt-exact', effort: 'high' });
  assert.equal(handle.harnessRequested, 'codex');
  assert.equal(handle.harnessResolved, 'codex@2');
  assert.equal(handle.effortRequested, 'high');
  assert.equal(handle.effortResolved, 'high');
  assert.equal(calls[0].opts.reasoningEffort, 'high');
  assert.deepEqual(
    Object.fromEntries(['harnessRequested', 'harnessResolved', 'modelRequested', 'modelResolved', 'modelObserved', 'effortRequested', 'effortResolved', 'effortObserved', 'routeKey']
      .map((field) => [field, coordination.task('direct-high')[field]])),
    {
      harnessRequested: 'codex', harnessResolved: 'codex@2', modelRequested: 'gpt-exact', modelResolved: 'gpt-exact', modelObserved: null,
      effortRequested: 'high', effortResolved: 'high', effortObserved: null, routeKey: handle.routeKey,
    },
  );

  const rejected = system({ codex: stubAdapter('codex', ['low']) }, () => 'codex').coordinator;
  await assert.rejects(
    () => rejected.spawn('codex', brief(), { effort: 'low', modelPolicy: { reasoningEffort: 'high' } }),
    (error) => error instanceof ModelSelectionError && error.code === 'effort_policy_conflict',
  );
  await assert.rejects(
    () => rejected.spawn('auto', brief(), { model: 'gpt-exact', effort: 'high' }),
    (error) => error instanceof ModelSelectionError && error.code === 'effort_unavailable',
  );
  assert.deepEqual(rejected.list(), []);
});

test('RT11.3: auto routing filters by effort and returns the tuple it scored', async () => {
  const lowCalls = []; const highCalls = []; let routed;
  const low = stubAdapter('low-harness', ['low'], lowCalls);
  const high = stubAdapter('high-harness', ['high'], highCalls);
  const { coordinator } = system({ low, high }, (task, cards) => {
    routed = { task, cards: Object.keys(cards), card: cards.high };
    return 'high';
  });
  const handle = await coordinator.spawn('auto', brief(), { taskId: 'auto-high', model: 'gpt-exact', effort: 'high', taskType: 'build' });
  assert.deepEqual(routed.cards, ['high']);
  assert.equal(handle.vendor, 'high');
  assert.equal(handle.effortResolved, 'high');
  assert.equal(highCalls[0].opts.reasoningEffort, 'high');
  assert.equal(lowCalls.length, 0);
  assert.equal(handle.routeKey, routeTupleKey(routed.card, 'gpt-exact', 'high', 'build'));
});

test('RT11.4/5: verified low/high runs learn distinct resolved tuple keys and replay full attribution', async () => {
  const calls = []; const records = []; const captureOpts = [];
  const adapter = stubAdapter('codex', ['low', 'high'], calls);
  const route = () => 'codex'; route.record = (...args) => records.push(args);
  const first = system({ codex: adapter }, route, { captureOpts });
  const complete = async (taskId, effort) => {
    const handle = await first.coordinator.spawn('codex', brief(), { taskId, taskType: 'build', model: 'gpt-exact', effort });
    adapter.cb({ worker: handle.id, harness: 'codex', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.spawned', payload: { modelObserved: 'gpt-exact', effortObserved: effort } });
    adapter.cb({ worker: handle.id, harness: 'codex', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.turn_started', payload: {} });
    adapter.cb({ worker: handle.id, harness: 'codex', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { tokens: 1 } });
    adapter.cb({
      worker: handle.id, harness: 'codex', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.turn_completed',
      payload: { status: 'completed', artifacts: { files: [] }, verification: { command: 'true', claimedExit: 0 } },
    });
    return until(async () => { const result = await first.coordinator.result(handle.id); return result.ready ? { handle, result } : null; });
  };
  const low = await complete('verified-low', 'low');
  const high = await complete('verified-high', 'high');
  assert.notEqual(low.result.routeKey, high.result.routeKey);
  assert.deepEqual(records.map((record) => record[0]), [low.result.routeKey, high.result.routeKey]);
  assert.deepEqual(captureOpts.map((opts) => opts.effort), ['low', 'high']);
  const verified = first.log.read(low.handle.id).find((event) => event.kind === 'verify.reverified');
  assert.equal(verified.effortRequested, 'low');
  assert.equal(verified.effortResolved, 'low');
  assert.equal(verified.effortObserved, 'low');
  assert.equal(verified.payload.capture.routeKey, low.result.routeKey);
  const durableObservation = first.coordination.events().find((event) =>
    event.kind === 'driver.recorded' && event.payload?.kind === 'route.observed' && event.payload?.taskId === 'verified-low');
  assert.equal(durableObservation.payload.harnessRequested, 'codex');
  assert.equal(durableObservation.payload.harnessResolved, 'codex@2');
  assert.equal(durableObservation.payload.modelObserved, 'gpt-exact');
  assert.equal(durableObservation.payload.effortObserved, 'low');
  assert.equal(durableObservation.payload.routeKey, low.result.routeKey);
  assert.ok(durableObservation.payload.evidence?.coordinationSeq);

  const replay = system({ codex: stubAdapter('codex', ['low', 'high']) }, route, {
    log: first.log, coordination: first.coordination, captureOpts,
  }).coordinator;
  const replayed = await replay.result(low.handle.id);
  assert.equal(replayed.effortRequested, 'low');
  assert.equal(replayed.effortResolved, 'low');
  assert.equal(replayed.effortObserved, 'low');
  assert.equal(replayed.routeKey, low.result.routeKey);

  const review = await first.coordinator.spawnReview(low.handle.id, 'codex', {
    taskId: 'effort-review', model: 'gpt-exact', effort: 'high',
    verification: { command: 'true', expectExit: 0 },
  });
  assert.equal(review.effortRequested, 'high');
  assert.equal(review.effortResolved, 'high');
  const requested = first.log.read(low.handle.id).find((event) => event.kind === 'review.requested');
  assert.equal(requested.payload.reviewerEffortRequested, 'high');

  const integrated = await first.coordinator.integrate(low.handle.id, { actor: 'orchestrator' });
  assert.equal(integrated.ok, true);
  const namedEvents = first.log.read(low.handle.id).filter((event) =>
    ['lifecycle.spawned', 'lifecycle.turn_started', 'resource.tokens', 'lifecycle.turn_completed', 'verify.reverified', 'integration.completed'].includes(event.kind));
  assert.ok(namedEvents.length >= 7);
  for (const event of namedEvents) {
    for (const field of ['harnessRequested', 'harnessResolved', 'modelRequested', 'modelResolved', 'modelObserved', 'effortRequested', 'effortResolved', 'effortObserved', 'routeKey']) {
      assert.equal(Object.hasOwn(event, field), true, `${event.kind} must expose ${field}`);
    }
    assert.equal(event.harnessRequested, 'codex');
    assert.equal(event.harnessResolved, 'codex@2');
    assert.equal(event.modelRequested, 'gpt-exact');
    assert.equal(event.modelResolved, 'gpt-exact');
    assert.equal(event.effortRequested, 'low');
    assert.equal(event.effortResolved, 'low');
    assert.equal(event.routeKey, low.result.routeKey);
  }
});

test('RT11.6: native effort mismatch fails and kills, while result prose cannot forge observation', async () => {
  const mismatchCalls = [];
  const mismatchAdapter = stubAdapter('codex', ['low', 'high'], mismatchCalls);
  const mismatch = system({ codex: mismatchAdapter }, () => 'codex').coordinator;
  const handle = await mismatch.spawn('codex', brief(), { taskId: 'effort-mismatch', model: 'gpt-exact', effort: 'high' });
  mismatchAdapter.cb({ worker: handle.id, harness: 'codex', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.spawned', payload: { effortObserved: 'low' } });
  const failed = await mismatch.result(handle.id);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.effortMismatch, { requested: 'high', observed: 'low' });
  await until(() => mismatchCalls.filter((call) => call.op === 'kill').length === 1);
  await until(() => mismatch.list().find((worker) => worker.id === handle.id)?.status === 'dead');

  const proseAdapter = stubAdapter('codex', ['high']);
  const proseSystem = system({ codex: proseAdapter }, () => 'codex');
  const prose = proseSystem.coordinator;
  const safe = await prose.spawn('codex', brief(), { taskId: 'untrusted-effort', model: 'gpt-exact', effort: 'high' });
  proseAdapter.cb({
    worker: safe.id, harness: 'codex', turnEpoch: 2, actor: 'worker', kind: 'content.message',
    payload: { model: 'forged-model', modelId: 'forged-id', modelObserved: 'forged-observed', effortObserved: 'low' },
  });
  proseAdapter.cb({
    worker: safe.id, harness: 'codex', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.turn_completed',
    payload: { status: 'completed', model: 'forged-result-model', modelId: 'forged-result-id', modelObserved: 'forged-result-observed', effortObserved: 'low', artifacts: { files: [] }, verification: { command: 'true', claimedExit: 0 } },
  });
  const completed = await until(async () => { const result = await prose.result(safe.id); return result.ready ? result : null; });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.effortObserved, null);
  assert.equal(completed.effortMismatch, null);
  assert.equal(completed.modelObserved, null);
  assert.equal(completed.modelMismatch, null);
  const safeReplay = system({ codex: stubAdapter('codex', ['high']) }, () => 'codex', {
    log: proseSystem.log, coordination: proseSystem.coordination,
  }).coordinator;
  const replayed = await safeReplay.result(safe.id);
  assert.equal(replayed.modelObserved, null);
  assert.equal(replayed.modelMismatch, null);
});
