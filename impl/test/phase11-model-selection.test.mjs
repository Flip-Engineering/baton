// Phase 11 MS1-MS5 desired behavior: model is an orchestrator control axis, not a CLI default.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Coordinator, ModelSelectionError } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { buildClaudeSessionArgs, ClaudeSessionCli, GlmSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli, withGrokModelArgs } from '../src/grok-acp.mjs';
import { captureCommit, createFromBase, reap } from '../src/worktree.mjs';
import { foldEvent, initialState } from '../src/story.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));
const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function brief(goal = 'model selection') {
  return {
    goal, constraints: [], pathScope: ['**'], definitionOfDone: 'done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 1 },
  };
}

function card(harness, models) {
  return {
    harness, version: '1', authPosture: 'none', concurrencyCeiling: 4, maxContext: 1000,
    verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' },
    modelSelection: {
      mode: 'exact', configuredDefault: models.default ?? null, available: models.available ?? null,
      family: models.family, acceptedPrefixes: models.acceptedPrefixes ?? [], acceptedAliases: [],
      reasoningEffort: null, serviceTier: null, provenance: 'test-card', refreshedAt: null,
    },
  };
}

function stubAdapter(harness, models, calls = []) {
  return {
    cb: null,
    onEvent(cb) { this.cb = cb; },
    card: () => card(harness, models),
    spawn: async (worker, _brief, opts) => { calls.push({ worker, opts }); return { ok: true }; },
    prompt: async () => ({ ok: true }), interrupt: async () => ({ ok: true }),
    approve: async () => ({ ok: true }), answer: async () => ({ ok: true }), kill: async () => ({ ok: true }),
  };
}

function coordinator(adapters, route = () => Object.keys(adapters)[0]) {
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-ms-log-')));
  const c = new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(), adapters,
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/${taskId}` }), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0 }), route,
    approvalTimeoutMs: 1000, stopDeadlineMs: 100,
  });
  return { c, log };
}

async function until(events, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await sleep(10);
  }
  throw new Error(`event not observed; kinds=${events.map((e) => e.kind).join(',')}`);
}

async function untilValue(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(10);
  }
  throw new Error('value not observed before timeout');
}

test('MS1/MS5: spawn model is independent of vendor and survives handle, event, observed state, and result', async () => {
  const calls = [];
  const ad = stubAdapter('stub', { default: 'stub-default', available: ['stub-default', 'stub-exact'], family: 'stub' }, calls);
  const { c, log } = coordinator({ stub: ad });
  const h = await c.spawn('stub', brief(), { taskId: 'model-fields', model: 'stub-exact' });
  assert.equal(h.vendor, 'stub');
  assert.equal(h.modelRequested, 'stub-exact');
  assert.equal(h.modelResolved, 'stub-exact');
  assert.equal(h.modelObserved, null);
  assert.equal(calls[0].opts.model, 'stub-exact');
  assert.equal(log.read(h.id)[0].payload.modelRequested, 'stub-exact');

  ad.cb({ worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { modelId: 'stub-exact', totalTokens: 5 } });
  assert.equal(c.list()[0].modelObserved, 'stub-exact');
  const pending = await c.result(h.id);
  assert.equal(pending.modelRequested, 'stub-exact');
  assert.equal(pending.modelObserved, 'stub-exact');
});

test('MS1: an exact model rejected by a known card fails typed before allocation', async () => {
  const ad = stubAdapter('stub', { default: 'stub-a', available: ['stub-a'], family: 'stub' });
  const { c } = coordinator({ stub: ad });
  await assert.rejects(
    () => c.spawn('stub', brief(), { model: 'stub-does-not-exist' }),
    (err) => err instanceof ModelSelectionError && err.code === 'model_unavailable',
  );
  assert.deepEqual(c.list(), []);
});

test('MS2: Claude task model overrides constructor default and reports the wire-observed model', async (t) => {
  const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], model: 'claude-default-fake', killGraceMs: 20 });
  const events = [];
  cli.onEvent((e) => events.push(e));
  t.after(() => cli.kill('claude-model').catch(() => {}));
  const ack = await cli.spawn('claude-model', brief(), { worktree: tmpdir(), model: 'claude-task-fake' });
  assert.equal(ack.ok, true);
  const spawned = await until(events, (e) => e.kind === 'lifecycle.spawned');
  assert.equal(spawned.payload.modelRequested, 'claude-task-fake');
  assert.equal(spawned.payload.modelObserved, 'claude-task-fake');
});

test('MS2: Codex exact model reaches thread/start and is reported from its response', async (t) => {
  const cli = new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], model: 'gpt-default-fake', requestTimeoutMs: 500, versionProbe: () => 'fake' });
  const events = [];
  cli.onEvent((e) => events.push(e));
  t.after(() => cli.kill('codex-model').catch(() => {}));
  const ack = await cli.spawn('codex-model', brief(), { worktree: tmpdir(), model: 'gpt-task-fake', reasoningEffort: 'high' });
  assert.equal(ack.ok, true);
  const spawned = await until(events, (e) => e.kind === 'lifecycle.spawned');
  assert.equal(spawned.payload.modelRequested, 'gpt-task-fake');
  assert.equal(spawned.payload.modelObserved, 'gpt-task-fake');
  assert.equal(spawned.payload.effortObserved, 'high');
});

test('MS2: Grok exact model reaches argv and prompt usage reports the observed model', async (t) => {
  const cli = new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], model: 'grok-default-fake', requestTimeoutMs: 500, versionProbe: () => 'fake' });
  const events = [];
  cli.onEvent((e) => events.push(e));
  t.after(() => cli.kill('grok-model').catch(() => {}));
  const ack = await cli.spawn('grok-model', brief(), { worktree: tmpdir(), model: 'grok-task-fake' });
  assert.equal(ack.ok, true);
  const spawned = await until(events, (e) => e.kind === 'lifecycle.spawned');
  assert.equal(spawned.payload.modelRequested, 'grok-task-fake');
  const usage = await until(events, (e) => e.kind === 'resource.tokens');
  assert.equal(usage.payload.modelId, 'grok-task-fake');
});

test('MS3: product cards publish model selection, defaults, discovery posture, and controls', () => {
  const cards = [
    new ClaudeSessionCli({ model: 'claude-default' }).card(),
    new CodexAppServerCli({ model: 'gpt-default', requestTimeoutMs: 10, versionProbe: () => 'fake' }).card(),
    new GrokAcpCli({ model: 'grok-default', requestTimeoutMs: 10, versionProbe: () => 'fake' }).card(),
    new GlmSessionCli({ model: 'glm-default' }).card(),
  ];
  for (const c of cards) {
    assert.equal(c.modelSelection.mode, 'exact');
    assert.equal(typeof c.modelSelection.configuredDefault, 'string');
    assert.ok(Object.hasOwn(c.modelSelection, 'available'));
    assert.ok(Object.hasOwn(c.modelSelection, 'reasoningEffort'));
    assert.ok(Object.hasOwn(c.modelSelection, 'serviceTier'));
    assert.equal(typeof c.modelSelection.provenance, 'string');
    assert.ok(Object.hasOwn(c.modelSelection, 'refreshedAt'));
  }
  assert.equal(cards[3].modelSelection.family, 'glm');
  assert.deepEqual(cards[3].modelSelection.acceptedPrefixes, ['glm-']);
});

test('MS2/MS4: reasoning controls map to native Claude and Grok argv', () => {
  assert.deepEqual(
    buildClaudeSessionArgs({ model: 'claude-x', effort: 'high', permissionMode: null }),
    ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'claude-x', '--effort', 'high'],
  );
  assert.deepEqual(
    withGrokModelArgs(['agent', 'stdio'], { model: 'grok-x', reasoningEffort: 'high' }),
    ['agent', '--always-approve', '--model', 'grok-x', '--reasoning-effort', 'high', 'stdio'],
  );
});

test('MS4: auto routing filters harnesses by exact model before scoring', async () => {
  const claudeCalls = [];
  const grokCalls = [];
  const claude = stubAdapter('claude-code', { default: 'claude-a', available: ['claude-a'], family: 'claude' }, claudeCalls);
  const grok = stubAdapter('grok', { default: 'grok-a', available: ['grok-a', 'grok-exact'], family: 'grok' }, grokCalls);
  let routedCards;
  const { c } = coordinator({ claude, grok }, (_task, cards) => {
    routedCards = Object.keys(cards);
    return Object.keys(cards)[0];
  });
  const h = await c.spawn('auto', brief(), { taskId: 'auto-model', model: 'grok-exact' });
  assert.deepEqual(routedCards, ['grok']);
  assert.equal(h.vendor, 'grok');
  assert.equal(grokCalls[0].opts.model, 'grok-exact');
  assert.equal(claudeCalls.length, 0);
});

test('MS4: model preference and deny policy resolve deterministically before routing', async () => {
  const claudeCalls = [];
  const grokCalls = [];
  const claude = stubAdapter('claude-code', { default: 'claude-a', available: ['claude-a'], family: 'claude' }, claudeCalls);
  const grok = stubAdapter('grok', { default: 'grok-a', available: ['grok-a', 'grok-b'], family: 'grok' }, grokCalls);
  const { c } = coordinator({ claude, grok }, (_task, cards) => Object.keys(cards)[0]);
  const h = await c.spawn('auto', brief(), {
    taskId: 'policy-model',
    modelPolicy: { prefer: ['grok-b'], deny: ['claude-a'] },
  });
  assert.equal(h.vendor, 'grok');
  assert.equal(h.modelResolved, 'grok-b');
  assert.equal(grokCalls[0].opts.model, 'grok-b');
  assert.equal(claudeCalls.length, 0);
});

test('MS4: conflicting or unsatisfied exact model policy refuses visibly before allocation', async () => {
  const ad = stubAdapter('stub', { default: 'stub-a', available: ['stub-a'], family: 'stub' });
  const { c } = coordinator({ stub: ad });
  await assert.rejects(
    () => c.spawn('auto', brief(), { model: 'stub-a', modelPolicy: { deny: ['stub-a'] } }),
    (err) => err instanceof ModelSelectionError && err.code === 'model_policy_conflict',
  );
  await assert.rejects(
    () => c.spawn('auto', brief(), { model: 'other-model' }),
    (err) => err instanceof ModelSelectionError && err.code === 'model_unavailable',
  );
  await assert.rejects(
    () => c.spawn('auto', brief(), { modelPolicy: { serviceTier: 'not-supported' } }),
    (err) => err instanceof ModelSelectionError && err.code === 'model_unavailable',
  );
  assert.deepEqual(c.list(), []);
});

test('MS5: model attribution reaches verification, router learning, and terminal replay', async () => {
  const calls = [];
  const captureOpts = [];
  const routeRecords = [];
  const ad = stubAdapter('stub', { default: 'stub-default', available: ['stub-exact'], family: 'stub' }, calls);
  const route = () => 'stub';
  route.record = (...args) => routeRecords.push(args);
  const log = new Log(mkdtempSync(join(tmpdir(), 'baton-ms5-log-')));
  const coordination = coordinationForLog(log);
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/${taskId}` }),
    capture: async (_path, opts) => { captureOpts.push(opts); return { sha: 'captured', snapshotted: true }; },
    createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
    remove: async () => {}, reconcile: async () => {},
  };
  const build = (adapter = ad) => new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { stub: adapter }, worktrees,
    referee: async () => ({ reverified: true, observedExit: 0 }), route,
    approvalTimeoutMs: 1000, stopDeadlineMs: 100,
  });
  const c = build();
  const h = await c.spawn('stub', brief(), { taskId: 'attributed-model', taskType: 'review', model: 'stub-exact' });
  ad.cb({ worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { modelId: 'stub-exact', totalTokens: 5 } });
  ad.cb({
    worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'lifecycle.turn_completed',
    payload: { status: 'completed', summary: 'done', artifacts: { files: [] }, verification: { command: 'true', claimedExit: 0 } },
  });
  await untilValue(async () => (await c.result(h.id)).ready, 3000);
  assert.deepEqual(captureOpts[0], { vendor: 'stub', model: 'stub-exact', ownerTaskId: 'attributed-model' });
  const verified = log.read(h.id).find((e) => e.kind === 'verify.reverified');
  assert.equal(verified.modelRequested, 'stub-exact');
  assert.equal(verified.modelResolved, 'stub-exact');
  assert.equal(verified.modelObserved, 'stub-exact');
  assert.equal(verified.payload.capture.model, 'stub-exact');
  assert.equal(routeRecords[0][0], '["stub","1","stub-exact","default","stub","review"]');

  const replayed = build(stubAdapter('stub', { default: 'stub-default', available: ['stub-exact'], family: 'stub' }));
  const result = await replayed.result(h.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.modelRequested, 'stub-exact');
  assert.equal(result.modelResolved, 'stub-exact');
  assert.equal(result.modelObserved, 'stub-exact');
});

test('MS5: a non-alias observed-model mismatch fails visibly and kills the fallback session', async () => {
  let killCalls = 0;
  const ad = stubAdapter('stub', { default: 'stub-a', available: ['stub-a', 'stub-exact'], family: 'stub' });
  ad.kill = async () => { killCalls += 1; return { ok: true }; };
  const { c, log } = coordinator({ stub: ad });
  const h = await c.spawn('stub', brief(), { taskId: 'model-mismatch', model: 'stub-exact' });
  ad.cb({ worker: h.id, harness: 'stub', turnEpoch: 2, actor: 'worker', kind: 'resource.tokens', payload: { modelId: 'stub-fallback' } });
  const result = await c.result(h.id);
  assert.equal(result.ready, true);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.modelMismatch, { requested: 'stub-exact', observed: 'stub-fallback' });
  assert.equal(log.read(h.id).filter((e) => e.kind === 'model.mismatch').length, 1);
  assert.equal(killCalls, 1);
});

test('MS5: snapshot commits carry Baton-Model independently of Baton-Vendor', async (t) => {
  const repo = mkdtempSync(join(tmpdir(), 'baton-ms5-repo-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'baton-test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const wt = await createFromBase(repo, 'model-trailer', base);
  writeFileSync(join(wt.dir, 'model.txt'), 'attributed\n');
  await captureCommit(repo, 'model-trailer', { vendor: 'grok', model: 'grok-exact', effort: 'high' });
  const message = execFileSync('git', ['log', '-1', '--format=%B'], { cwd: wt.dir, encoding: 'utf8' });
  assert.match(message, /Baton-Vendor: grok/);
  assert.match(message, /Baton-Model: grok-exact/);
  assert.match(message, /Baton-Effort: high/);
  await reap(repo, 'model-trailer', { force: true, deleteBranch: true });
});

test('MS5: story keeps requested, resolved, observed, and mismatch model identities', () => {
  let state = initialState();
  state = foldEvent(state, {
    worker: 'w-model', harness: 'stub@1', seq: 1, ts: '2026-01-01T00:00:00Z', turnEpoch: 1,
    actor: 'orchestrator', kind: 'lifecycle.spawned',
    harnessRequested: 'stub-registry', harnessResolved: 'stub@1', routeKey: '["stub","1","stub-exact","high"]',
    modelRequested: 'stub-exact', modelResolved: 'stub-exact', modelObserved: null,
    effortRequested: 'high', effortResolved: 'high', effortObserved: null,
    payload: { taskId: 't-model', brief: brief() },
  });
  state = foldEvent(state, {
    worker: 'w-model', harness: 'stub@1', seq: 2, ts: '2026-01-01T00:00:01Z', turnEpoch: 1,
    actor: 'worker', kind: 'content.message', payload: { model: 'forged-prose-model', effortObserved: 'forged-prose-effort' },
  });
  state = foldEvent(state, {
    worker: 'w-model', harness: 'stub@1', seq: 3, ts: '2026-01-01T00:00:02Z', turnEpoch: 1,
    actor: 'worker', kind: 'resource.tokens', modelObserved: 'stub-fallback', payload: { modelId: 'stub-fallback' },
    effortObserved: 'low',
  });
  state = foldEvent(state, {
    worker: 'w-model', harness: 'stub@1', seq: 4, ts: '2026-01-01T00:00:03Z', turnEpoch: 1,
    actor: 'policy', kind: 'model.mismatch', payload: { requested: 'stub-exact', observed: 'stub-fallback' },
  });
  state = foldEvent(state, {
    worker: 'w-model', harness: 'stub@1', seq: 5, ts: '2026-01-01T00:00:04Z', turnEpoch: 1,
    actor: 'policy', kind: 'effort.mismatch', payload: { requested: 'high', observed: 'low' },
  });
  const worker = state.workers.get('w-model');
  assert.equal(worker.harnessRequested, 'stub-registry');
  assert.equal(worker.harnessResolved, 'stub@1');
  assert.equal(worker.routeKey, '["stub","1","stub-exact","high"]');
  assert.equal(worker.modelRequested, 'stub-exact');
  assert.equal(worker.modelResolved, 'stub-exact');
  assert.equal(worker.modelObserved, 'stub-fallback');
  assert.equal(worker.effortRequested, 'high');
  assert.equal(worker.effortResolved, 'high');
  assert.equal(worker.effortObserved, 'low');
  assert.deepEqual(worker.modelMismatch, { requested: 'stub-exact', observed: 'stub-fallback' });
  assert.deepEqual(worker.effortMismatch, { requested: 'high', observed: 'low' });
});
