// Phase 10.1 SC12-SC18 desired-behavior regressions. These were authored after the
// zero-quota diagnostic reproductions in docs/handoff/evidence/phase10.1-reverification.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { initialState, foldEvent, renderNarrative } from '../src/story.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const FAKE_CODEX = fileURLToPath(new URL('./fixtures/fake-codex-appserver.mjs', import.meta.url));
const FAKE_GROK = fileURLToPath(new URL('./fixtures/fake-grok-acp.mjs', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
function brief(goal = 'x') { return { goal, constraints: [], pathScope: ['**'], definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 1 } }; }

function makeAdapters() {
  return [
    ['claude', () => new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], killGraceMs: 20 }), 'HOLD_UNTIL_INTERRUPT'],
    ['codex', () => new CodexAppServerCli({ cmd: process.execPath, args: [FAKE_CODEX, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' }), 'FAKE:STAY_OPEN'],
    ['grok', () => new GrokAcpCli({ cmd: process.execPath, args: [FAKE_GROK, '--serve'], requestTimeoutMs: 1500, versionProbe: () => 'fake' }), 'FAKE:STAY_OPEN'],
  ];
}

function collect(cli) {
  const events = [];
  cli.onEvent((e) => events.push(e));
  return events;
}

function killPids(events) {
  for (const e of events) {
    const pid = e.payload?.pid;
    if (!pid) continue;
    try { process.kill(-pid, 'SIGKILL'); } catch {}
  }
}

function stubAdapter(over = {}) {
  const calls = { prompts: [] };
  const a = {
    calls, cb: null,
    onEvent(cb) { this.cb = cb; },
    emit(kind, worker, payload = {}) { this.cb?.({ worker, harness: 'stub@1', turnEpoch: 1, kind, actor: 'worker', payload }); },
    card: () => ({ harness: 'stub', version: '1', authPosture: 'none', concurrencyCeiling: 4, maxContext: 1000, verbs: { spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native', approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported' } }),
    spawn: over.spawn ?? (async () => ({ ok: true })),
    prompt: over.prompt ?? (async (_w, msg) => { calls.prompts.push(msg); return { ok: true }; }),
    interrupt: over.interrupt ?? (async () => ({ ok: true })),
    kill: over.kill ?? (async () => ({ ok: true })),
    approve: async () => ({ ok: true }), answer: async () => ({ ok: true }),
  };
  return a;
}

function makeCoordinator(a, opts = {}) {
  const log = new Log(mkdtempSync(join(tmpdir(), 'p101-log-')));
  const worktrees = opts.worktrees ?? {
    create: async () => ({ path: mkdtempSync(join(tmpdir(), 'p101-wt-')) }),
    capture: async () => ({ sha: 'x' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
  };
  const build = () => new Coordinator({
    log, coordination: coordinationForLog(log), fences: new FenceTable(), adapters: { v: a }, worktrees,
    referee: async () => ({ reverified: true, observedExit: 0 }), route: () => 'v',
    approvalTimeoutMs: 100, stopDeadlineMs: opts.stopDeadlineMs ?? 100,
  });
  const coordinator = build();
  return { coordinator, log, replay: build };
}

test('SC12: kill while each session adapter awaits worktree readiness prevents child creation', async (t) => {
  for (const [name, make, marker] of makeAdapters()) {
    const gate = deferred();
    const cli = make();
    const events = collect(cli);
    t.after(() => killPids(events));
    const spawning = cli.spawn(`${name}-pending`, brief(marker), { worktreeReady: gate.promise });
    await sleep(5);
    await cli.kill(`${name}-pending`);
    gate.resolve({ path: mkdtempSync(join(tmpdir(), `p101-${name}-`)) });
    const ack = await spawning;
    await sleep(30);
    assert.equal(ack.ok, false, `${name}: cancelled pending spawn must refuse`);
    assert.equal(events.some((e) => e.kind === 'lifecycle.spawned'), false, `${name}: no child/session may appear after kill`);
    assert.equal(events.filter((e) => e.kind === 'kill.confirmed').length, 1, `${name}: pending kill must confirm exactly once`);
  }
});

test('SC12: interrupt while each session adapter awaits worktree readiness prevents child creation', async (t) => {
  for (const [name, make, marker] of makeAdapters()) {
    const gate = deferred();
    const cli = make();
    const events = collect(cli);
    t.after(() => killPids(events));
    const spawning = cli.spawn(`${name}-pending-i`, brief(marker), { worktreeReady: gate.promise });
    await sleep(5);
    await cli.interrupt(`${name}-pending-i`);
    gate.resolve({ path: mkdtempSync(join(tmpdir(), `p101-${name}-i-`)) });
    const ack = await spawning;
    await sleep(30);
    assert.equal(ack.ok, false, `${name}: interrupted pending spawn must refuse`);
    assert.equal(events.some((e) => e.kind === 'lifecycle.spawned'), false, `${name}: no child/session may appear after interrupt`);
    assert.equal(events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 1, `${name}: pending interrupt must confirm exactly once`);
  }
});

test('SC12: same-worker spawn reservation is atomic across worktreeReady for every session adapter', async (t) => {
  for (const [name, make] of makeAdapters()) {
    const gate = deferred();
    const cli = make();
    const events = collect(cli);
    t.after(() => killPids(events));
    try {
      const p1 = cli.spawn(`${name}-dupe`, brief('ordinary'), { worktreeReady: gate.promise });
      const p2 = cli.spawn(`${name}-dupe`, brief('ordinary'), { worktreeReady: gate.promise });
      gate.resolve({ path: mkdtempSync(join(tmpdir(), `p101-${name}-dupe-`)) });
      const acks = await Promise.all([p1, p2]);
      assert.equal(acks.filter((a) => a.ok).length, 1, `${name}: exactly one spawn owns the worker`);
      for (let i = 0; i < 50 && events.filter((e) => e.kind === 'lifecycle.spawned').length < 1; i += 1) await sleep(5);
      assert.equal(events.filter((e) => e.kind === 'lifecycle.spawned').length, 1, `${name}: exactly one child/session is visible`);
    } finally {
      await cli.kill(`${name}-dupe`).catch(() => {});
      await sleep(20);
    }
  }
});

test('SC12: stop before worktree readiness reaps the worktree after late creation', async () => {
  const gate = deferred();
  let created = false;
  const removals = [];
  const worktrees = {
    create: async () => { await gate.promise; created = true; return { path: mkdtempSync(join(tmpdir(), 'p101-late-created-')) }; },
    capture: async () => ({ sha: 'x' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {}, remove: async () => { removals.push({ created }); }, reconcile: async () => {},
  };
  let a;
  a = stubAdapter({
    spawn: async (_w, _b, opts) => { await opts.worktreeReady; return opts.signal.aborted ? { ok: false, reason: 'cancelled' } : { ok: true }; },
    kill: async (w) => { queueMicrotask(() => a.emit('kill.confirmed', w)); return { ok: true }; },
  });
  const { coordinator } = makeCoordinator(a, { worktrees });
  const h = await coordinator.spawn('v', brief());
  await coordinator.kill(h.id);
  gate.resolve();
  for (let i = 0; i < 50 && !removals.some((r) => r.created); i += 1) await sleep(5);
  assert.equal(removals.some((r) => r.created), true, 'late-created worktree must be reaped after it exists');
  assert.equal((await coordinator.result(h.id)).status, 'cancelled');
});

test('SC13: spawn refusal racing a confirmed kill preserves cancelled and appends no crash', async () => {
  const gate = deferred();
  let a;
  a = stubAdapter({
    spawn: async () => { await gate.promise; return { ok: false, reason: 'killed handshake' }; },
    kill: async (w) => { queueMicrotask(() => a.emit('kill.confirmed', w)); return { ok: true }; },
  });
  const { coordinator, log, replay } = makeCoordinator(a);
  const h = await coordinator.spawn('v', brief());
  await coordinator.kill(h.id);
  gate.resolve();
  await sleep(20);
  assert.equal((await coordinator.result(h.id)).status, 'cancelled');
  assert.equal(log.read(h.id).filter((e) => e.kind === 'lifecycle.crashed').length, 0);
  assert.equal((await replay().result(h.id)).status, 'cancelled', 'SC13 terminal monotonicity must survive replay');
});

test('SC13: terminal state is monotonic at runtime and replay under late worker events', async () => {
  const a = stubAdapter();
  const { coordinator, log, replay } = makeCoordinator(a);
  const h = await coordinator.spawn('v', brief());
  a.emit('lifecycle.turn_completed', h.id, { status: 'completed', verification: { claimedExit: 0 } });
  for (let i = 0; i < 50 && (await coordinator.result(h.id)).status !== 'completed'; i += 1) await sleep(5);
  assert.equal((await coordinator.result(h.id)).status, 'completed');

  for (const [kind, payload] of [
    ['lifecycle.turn_started', {}],
    ['question.asked', { requestId: 'late-q', blocking: true }],
    ['approval.requested', { requestId: 'late-a', blocking: true }],
    ['lifecycle.crashed', { error: 'late crash' }],
    ['kill.confirmed', {}],
  ]) a.emit(kind, h.id, payload);

  assert.equal((await coordinator.result(h.id)).status, 'completed');
  assert.equal((await replay().result(h.id)).status, 'completed');
  assert.ok(log.read(h.id).some((e) => e.kind === 'lifecycle.crashed'), 'late facts stay visible even though terminal state is immutable');
});

test('SC14: queued send cannot cross a finalized interrupt and revive the task', async () => {
  const first = deferred();
  let a;
  a = stubAdapter({
    prompt: async (_w, msg) => { a.calls.prompts.push(msg); if (msg === 'A') await first.promise; return { ok: true }; },
    interrupt: async (w) => { queueMicrotask(() => a.emit('control.interrupt_confirmed', w)); return { ok: true }; },
  });
  const { coordinator } = makeCoordinator(a);
  const h = await coordinator.spawn('v', brief());
  const pA = coordinator.send(h.id, 'A', 'send');
  for (let i = 0; i < 20 && a.calls.prompts.length === 0; i += 1) await sleep(1);
  const pB = coordinator.send(h.id, 'B', 'send');
  await coordinator.interrupt(h.id);
  first.resolve();
  const rB = await pB;
  await pA;
  assert.equal(rB.ok, false);
  assert.deepEqual(a.calls.prompts, ['A']);
  assert.equal((await coordinator.result(h.id)).status, 'cancelled');
});

test('SC14: queued send cannot cross a finalized kill and revive the task', async () => {
  const first = deferred();
  let a;
  a = stubAdapter({
    prompt: async (_w, msg) => { a.calls.prompts.push(msg); if (msg === 'A') await first.promise; return { ok: true }; },
    kill: async (w) => { queueMicrotask(() => a.emit('kill.confirmed', w)); return { ok: true }; },
  });
  const { coordinator } = makeCoordinator(a);
  const h = await coordinator.spawn('v', brief());
  const pA = coordinator.send(h.id, 'A', 'send');
  for (let i = 0; i < 20 && a.calls.prompts.length === 0; i += 1) await sleep(1);
  const pB = coordinator.send(h.id, 'B', 'send');
  await coordinator.kill(h.id);
  first.resolve();
  const rB = await pB;
  await pA;
  assert.equal(rB.ok, false);
  assert.deepEqual(a.calls.prompts, ['A']);
  assert.equal((await coordinator.result(h.id)).status, 'cancelled');
});

test('SC14: adapter refusal is not logged as successful delivery', async () => {
  const a = stubAdapter({ prompt: async () => ({ ok: false, reason: 'wire refused' }) });
  const { coordinator, log } = makeCoordinator(a);
  const h = await coordinator.spawn('v', brief());
  const ack = await coordinator.send(h.id, 'x', 'send');
  assert.equal(ack.ok, false);
  assert.equal(log.read(h.id).some((e) => e.kind === 'control.send'), false);
});

test('SC15: rejecting spawn becomes a durable failed task', async () => {
  const a = stubAdapter({ spawn: async () => { throw new Error('spawn threw'); } });
  const { coordinator, log } = makeCoordinator(a);
  const h = await coordinator.spawn('v', brief());
  await sleep(20);
  assert.equal((await coordinator.result(h.id)).status, 'failed');
  assert.equal(log.read(h.id).filter((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'spawn').length, 1);
});

test('SC16: Codex turn/start failure reaps the child before refusing spawn', async (t) => {
  const cli = new CodexAppServerCli({
    cmd: process.execPath, args: [FAKE_CODEX, '--serve'], env: { FAKE_CODEX_TURN_START_FAIL: '1' },
    requestTimeoutMs: 500, versionProbe: () => 'fake',
  });
  const events = collect(cli);
  t.after(() => killPids(events));
  const ack = await cli.spawn('codex-turn-fail', brief(), { worktree: tmpdir() });
  assert.equal(ack.ok, false);
  const pid = events.find((e) => e.kind === 'lifecycle.spawned')?.payload?.pid;
  assert.ok(pid, 'fixture proves a child existed before turn/start failed');
  for (let i = 0; i < 50; i += 1) { try { process.kill(pid, 0); await sleep(5); } catch { break; } }
  assert.throws(() => process.kill(pid, 0), 'refused spawn must leave no child alive');
});

function ev(seq, kind, payload = {}) { return { seq, ts: new Date(seq * 1000).toISOString(), worker: 'w', harness: 'h@1', turnEpoch: 1, actor: 'worker', kind, payload }; }

test('SC17: crash is not done; warning-bearing clean exit is done', () => {
  let crashed = initialState();
  crashed = foldEvent(crashed, ev(1, 'lifecycle.spawned', { taskId: 't', brief: brief() }));
  crashed = foldEvent(crashed, ev(2, 'lifecycle.crashed', { error: 'boom' }));
  assert.doesNotMatch(renderNarrative(crashed), /1 done/);
  assert.match(renderNarrative(crashed), /crashed/);

  let clean = initialState();
  clean = foldEvent(clean, ev(1, 'lifecycle.spawned', { taskId: 't', brief: { ...brief(), pathScope: ['src/**'] } }));
  clean = foldEvent(clean, ev(2, 'content.file_edit', { path: 'docs/outside.md' }));
  clean = foldEvent(clean, ev(3, 'lifecycle.exited'));
  assert.match(renderNarrative(clean), /1 done/);
});

test('SC17: a new turn clears its predecessor verdict', () => {
  let state = initialState();
  state = foldEvent(state, ev(1, 'lifecycle.spawned', { taskId: 't', brief: brief() }));
  state = foldEvent(state, ev(2, 'lifecycle.turn_started'));
  state = foldEvent(state, ev(3, 'lifecycle.turn_completed'));
  state = foldEvent(state, ev(4, 'verify.reverified', { accept: true }));
  state = foldEvent(state, ev(5, 'lifecycle.turn_started'));
  assert.equal(state.workers.get('w').lastVerdict, null);
  assert.doesNotMatch(renderNarrative(state), /1 done/);
});

test('SC17: a later process crash cannot inherit done from an earlier accepted verdict', () => {
  let state = initialState();
  state = foldEvent(state, ev(1, 'lifecycle.spawned', { taskId: 't', brief: brief() }));
  state = foldEvent(state, ev(2, 'lifecycle.turn_started'));
  state = foldEvent(state, ev(3, 'lifecycle.turn_completed'));
  state = foldEvent(state, ev(4, 'verify.reverified', { accept: true }));
  state = foldEvent(state, ev(5, 'lifecycle.crashed', { error: 'session died after verification' }));
  assert.doesNotMatch(renderNarrative(state), /1 done/);
  assert.match(renderNarrative(state), /crashed/);
});

test('SC18: timeoutMs is enforced by every session adapter', async (t) => {
  for (const [name, make, marker] of makeAdapters()) {
    const cli = make();
    const events = collect(cli);
    t.after(() => killPids(events));
    try {
      // The bare suite starts many fixture processes in parallel. Keep this above ordinary host
      // scheduler latency so the assertion measures an active-session timeout, not setup jitter.
      const ack = await cli.spawn(`${name}-timeout`, brief(marker), { worktree: tmpdir(), timeoutMs: 600 });
      assert.equal(ack.ok, true);
      for (let i = 0; i < 160 && !events.some((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'timeout'); i += 1) await sleep(5);
      assert.equal(events.filter((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'timeout').length, 1, `${name}: timeout must be observable exactly once`);
    } finally {
      await cli.kill(`${name}-timeout`).catch(() => {});
      await sleep(20);
    }
  }
});

test('SC18: confirmed interrupt clears each session wall timer', async (t) => {
  for (const [name, make, marker] of makeAdapters()) {
    const cli = make();
    const events = collect(cli);
    t.after(() => killPids(events));
    try {
      const worker = `${name}-interrupt-clears-timeout`;
      const ack = await cli.spawn(worker, brief(marker), { worktree: tmpdir(), timeoutMs: 600 });
      assert.equal(ack.ok, true);
      await cli.interrupt(worker);
      for (let i = 0; i < 160 && !events.some((e) => e.kind === 'control.interrupt_confirmed'); i += 1) await sleep(5);
      assert.equal(events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 1, `${name}: interrupt must confirm`);
      await sleep(650);
      assert.equal(events.some((e) => e.kind === 'lifecycle.crashed' && e.payload?.phase === 'timeout'), false, `${name}: cleared timer must not fire after interrupt`);
      await cli.kill(worker);
    } finally {
      await sleep(20);
    }
  }
});
