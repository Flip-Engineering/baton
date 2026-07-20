// Cluster 2 (Workers & Trust) — adapter.mjs test suite.
// Covers MockAdapter determinism/scriptability and SubprocessAdapter-family guard
// behavior (structural only — no live CLI is ever invoked; BATON_ALLOW_LIVE_ADAPTERS
// is never set to "1" anywhere in this file).
//
// AUTHORITATIVE CONTRACT: spec/RECONCILIATION.md D1 overrides spec/IMPLEMENTATION.md
// §2 (adapter.mjs) wherever they differ. D1 pins ONE session-shaped Adapter interface
// (`card/spawn/prompt/interrupt/approve/answer/kill/onEvent`) implemented identically
// by every harness (Mock/Codex/Claude/Glm). `answer()` is distinct from `approve()`
// (red core#1): approvals carry a closed 'allow'|'deny'|'cancel' decision; questions
// carry free-form {text|decision}. Confirmed-stop (interrupt/kill) is ALWAYS an event,
// never a return value (red core#2) — interrupt()/kill() Acks resolve immediately;
// the authoritative stop is `control.interrupt_confirmed`/`kill.confirmed` observed
// via onEvent. `MockAdapter` additionally keeps its pre-D1 `run(brief, opts)`
// convenience (= spawn + await the terminal event + translate to WorkerResult /
// AdapterCrashError) so one-shot tests keep working; the session methods below are
// the primary, coordinator-facing surface.
//
// DESIGN NOTE (gap D1 leaves to this cluster to fill, documented here since nothing
// else pins it): D1's abstract `spawn(worker, brief): Promise<Ack>` carries no place
// for `worktree`/`timeoutMs`/`log` — those are threaded through a 3rd `opts` param
// specific to concrete adapters (`spawn(workerId, brief, opts)`), exactly mirroring
// `run(brief, opts)`'s existing opts bag. `onEvent(cb)` is a single-slot registration
// (last caller wins) — one callback per adapter instance, matching the pattern
// already used by Cluster 1's `ScriptableAdapter` test fixture. Every event pushed to
// that callback carries `worker` (per D1's plain `BatonEvent`, which — unlike
// IMPLEMENTATION.md's stale `Omit<BatonEvent,'worker'>` — is NOT worker-omitted) so a
// single adapter instance can multiplex many concurrent worker sessions correctly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MockAdapter,
  CodexAdapter,
  ClaudeAdapter,
  GlmAdapter,
  assertIsAdapter,
  AdapterCrashError,
  renderBrief,
} from '../src/adapter.mjs';

// ---------- helpers ----------

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' });
}

/** A real, initialized git repo with one base commit. Used directly as a worker's worktree. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-test-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Test'], dir);
  sh('git', ['commit', '--allow-empty', '-q', '-m', 'base'], dir);
  return dir;
}

function commitCount(dir) {
  return sh('git', ['log', '--oneline'], dir).trim().split('\n').filter(Boolean).length;
}

function makeBrief(overrides = {}) {
  return {
    goal: 'make done.txt exist',
    constraints: [],
    pathScope: [],
    definitionOfDone: 'done.txt exists and contains "ok"',
    verification: { command: 'test -f done.txt', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 10 },
    ...overrides,
  };
}

function makeOpts(worktree, overrides = {}) {
  return {
    worktree,
    timeoutMs: 20000,
    workerId: 'w1',
    turnEpoch: 1,
    ...overrides,
  };
}

function stubLog() {
  const events = [];
  return { events, log: { append: (e) => { events.push(e); return e; } } };
}

/**
 * Session-mode test bus: a single onEvent(cb) subscriber that records every event and
 * lets a test await the FIRST future (or already-seen) event matching a predicate —
 * event-driven, not polling, so it stays deterministic under real setTimeout-based
 * MockAdapter scenario timing.
 */
function makeEventBus() {
  const events = [];
  const waiters = [];
  const cb = (e) => {
    events.push(e);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i].predicate(e)) {
        waiters[i].resolve(e);
        waiters.splice(i, 1);
      }
    }
  };
  const waitFor = (predicate, timeoutMs = 3000) => {
    const already = events.find(predicate);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waitFor timed out after ${timeoutMs}ms; saw kinds: ${events.map((e) => e.kind).join(',')}`)), timeoutMs);
      waiters.push({ predicate, resolve: (e) => { clearTimeout(timer); resolve(e); } });
    });
  };
  const kindIs = (kind) => (e) => e.kind === kind;
  return { events, cb, waitFor, kindIs };
}

const TERMINAL_KINDS = new Set(['lifecycle.turn_completed', 'control.interrupt_confirmed', 'kill.confirmed', 'lifecycle.crashed']);

// ============================================================
// card() / assertIsAdapter (D1 session duck-type) — behaviors 1-2
// ============================================================

test('card() returns a well-formed HarnessCard for all four adapters', () => {
  const mock = new MockAdapter({ scenario: { outcome: 'completed' } });
  for (const [name, adapter] of [
    ['mock', mock],
    ['codex', new CodexAdapter()],
    ['claude', new ClaudeAdapter()],
    ['glm', new GlmAdapter()],
  ]) {
    const card = adapter.card();
    assert.equal(typeof card.harness, 'string', `${name}.harness`);
    assert.equal(typeof card.version, 'string', `${name}.version`);
    assert.ok(['subscription', 'api_key'].includes(card.authPosture), `${name}.authPosture`);
    assert.ok(Number.isInteger(card.concurrencyCeiling) && card.concurrencyCeiling > 0, `${name}.concurrencyCeiling`);
    assert.ok(Number.isInteger(card.maxContext) && card.maxContext > 0, `${name}.maxContext`);
    assert.equal(typeof card.verbs, 'object', `${name}.verbs`);
    assert.ok('spawn' in card.verbs, `${name}.verbs.spawn required`);
    assert.ok('interrupt' in card.verbs, `${name}.verbs.interrupt required`);
  }
  assert.equal(new GlmAdapter().card().concurrencyCeiling, 1, 'GLM Pro concurrency ceiling is hard-pinned to 1');
  assert.deepEqual(mock.card().governance, {
    usage: { tokens: 'native', usd: 'native', tokenMetric: 'mock_scenario_tokens', terminalSeal: 'native' },
    providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
    toolCalls: { observation: 'unavailable', enforcement: 'unavailable' },
    maxWireFrameBytes: 1024 * 1024,
  });
});

test('assertIsAdapter (D1): accepts all four real adapters and rejects anything missing a SESSION method', () => {
  assert.doesNotThrow(() => assertIsAdapter(new MockAdapter({ scenario: { outcome: 'completed' } })));
  assert.doesNotThrow(() => assertIsAdapter(new CodexAdapter()));
  assert.doesNotThrow(() => assertIsAdapter(new ClaudeAdapter()));
  assert.doesNotThrow(() => assertIsAdapter(new GlmAdapter()));

  assert.throws(() => assertIsAdapter({}), TypeError);
  assert.throws(() => assertIsAdapter(null), TypeError);
  // D1's full method set: card, spawn, prompt, interrupt, approve, answer, kill, onEvent.
  const full = {
    card() {}, spawn() {}, prompt() {}, interrupt() {}, approve() {}, answer() {}, kill() {}, onEvent() {},
  };
  assert.doesNotThrow(() => assertIsAdapter(full), 'a duck-type with every D1 method is accepted');
  for (const missing of ['spawn', 'prompt', 'interrupt', 'approve', 'answer', 'kill', 'onEvent']) {
    const partial = { ...full };
    delete partial[missing];
    assert.throws(() => assertIsAdapter(partial), TypeError, `missing ${missing}() must be rejected`);
  }
  // answer() and approve() are DISTINCT required methods (red core#1) — an adapter that
  // only implements one, aliasing the other, is not a conforming Adapter.
  const aliasedApprove = { ...full };
  delete aliasedApprove.answer;
  assert.throws(() => assertIsAdapter(aliasedApprove), TypeError, 'approve() alone does not satisfy answer()');
});

// ============================================================
// MockAdapter.run — one-shot convenience, basic outcomes — behaviors 3-4
// ============================================================

test('MockAdapter.run outcome:"completed" writes scripted edits as real files and creates a real git commit', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'done.txt', content: 'ok' }],
    authorName: 'Mock Worker',
    authorEmail: 'mock@baton.local',
  };
  const adapter = new MockAdapter({ scenario });
  const result = await adapter.run(makeBrief(), makeOpts(dir));

  assert.equal(result.status, 'completed');
  assert.ok(existsSync(join(dir, 'done.txt')));
  assert.equal(readFileSync(join(dir, 'done.txt'), 'utf8'), 'ok');
  assert.ok(commitCount(dir) >= 2, 'a new commit beyond the base commit exists');
  const author = sh('git', ['log', '-1', '--pretty=%an <%ae>'], dir).trim();
  assert.equal(author, 'Mock Worker <mock@baton.local>');
});

test('MockAdapter commit capture ignores ambient GIT repository redirects', async (t) => {
  const worktree = makeRepo(); const decoy = makeRepo();
  t.after(() => { rmSync(worktree, { recursive: true, force: true }); rmSync(decoy, { recursive: true, force: true }); });
  const prior = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE, index: process.env.GIT_INDEX_FILE };
  process.env.GIT_DIR = join(decoy, '.git'); process.env.GIT_WORK_TREE = decoy; process.env.GIT_INDEX_FILE = join(decoy, '.git', 'poison-index');
  try {
    await new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'owned.txt', content: 'owned\n' }] } }).run(makeBrief(), makeOpts(worktree));
  } finally {
    for (const [key, value] of [['GIT_DIR', prior.dir], ['GIT_WORK_TREE', prior.tree], ['GIT_INDEX_FILE', prior.index]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  assert.equal(readFileSync(join(worktree, 'owned.txt'), 'utf8'), 'owned\n');
  assert.equal(commitCount(worktree), 2);
  assert.equal(commitCount(decoy), 1);
});

test('MockAdapter.run outcome:"failed" still applies and commits real (if wrong) work', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = { outcome: 'failed', edits: [{ path: 'wrong.txt', content: 'oops' }] };
  const adapter = new MockAdapter({ scenario });
  const result = await adapter.run(makeBrief(), makeOpts(dir));

  assert.equal(result.status, 'failed');
  assert.ok(existsSync(join(dir, 'wrong.txt')), 'edits are committed even on a failed outcome');
  assert.ok(commitCount(dir) >= 2);
});

// ============================================================
// SESSION MODE: spawn()/onEvent basic completed flow — new, D1
// ============================================================

test('SESSION: spawn() acks immediately and emits turn_started -> content.file_edit* -> lifecycle.turn_completed{result} via onEvent', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a' }, { path: 'b.txt', content: 'b' }],
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  const ack = await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  assert.equal(ack.ok, true, 'spawn() Ack resolves ok:true without waiting for the run to finish');

  const terminal = await bus.waitFor((e) => e.kind === 'lifecycle.turn_completed');
  assert.equal(terminal.worker, 'w1', 'events are attributed to the spawning worker');
  assert.equal(terminal.payload.result.status, 'completed');

  const kinds = bus.events.map((e) => e.kind);
  assert.equal(kinds[0], 'lifecycle.turn_started');
  assert.equal(kinds.at(-1), 'lifecycle.turn_completed');
  assert.equal(kinds.filter((k) => k === 'content.file_edit').length, 2, 'D3: content.file_edit, one per applied edit');
  assert.ok(existsSync(join(dir, 'a.txt')) && existsSync(join(dir, 'b.txt')));
  assert.deepEqual(terminal.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
});

test('MockAdapter reports scenario usage synchronously before terminal with the same counter-bound seal', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', budgetUsed: { tokens: 9, usd: 0.03 } } });
  const bus = makeEventBus(); adapter.onEvent(bus.cb);
  await adapter.spawn('usage-worker', makeBrief(), { worktree: dir, timeoutMs: 20_000, turnEpoch: 1 });
  const terminal = await bus.waitFor((event) => event.kind === 'lifecycle.turn_completed');
  const usageIndex = bus.events.findIndex((event) => event.kind === 'resource.tokens');
  const terminalIndex = bus.events.indexOf(terminal);
  assert.ok(usageIndex >= 0 && usageIndex < terminalIndex);
  const usage = bus.events[usageIndex];
  assert.equal(usage.payload.counterId, terminal.payload.usageSeal.counterId);
  assert.deepEqual(terminal.payload.usageSeal, {
    tokens: 'reported', usd: 'reported', counterId: 'mock:usage-worker:1', tokenMetric: 'mock_scenario_tokens',
  });
});

test('WF3: MockAdapter rejects readiness before announcing a turn or touching disk', async () => {
  const adapter = new MockAdapter({ scenario: { outcome: 'completed', edits: [{ path: 'never.txt', content: 'never' }] } });
  const bus = makeEventBus(); adapter.onEvent(bus.cb);
  const failed = Promise.reject(Object.assign(new Error('checkout failed'), { code: 'worktree_unavailable' }));
  failed.catch(() => {});
  const ack = await adapter.spawn('wf3', makeBrief(), { worktreeReady: failed, timeoutMs: 20_000 });
  assert.equal(ack.ok, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(bus.events.some((event) => event.kind === 'lifecycle.crashed'), false);
  assert.equal(bus.events.some((event) => event.kind === 'lifecycle.turn_started'), false);
  assert.equal(bus.events.some((event) => event.kind === 'content.file_edit'), false);
});

test('SESSION: forgeSuccess via spawn() — the terminal event lies about the result, but real disk content stays honest', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const brief = makeBrief();
  const scenario = {
    outcome: 'failed',
    forgeSuccess: true,
    edits: [{ path: 'unrelated.txt', content: 'not done.txt' }],
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', brief, { worktree: dir, timeoutMs: 20000 });
  const terminal = await bus.waitFor((e) => e.kind === 'lifecycle.turn_completed');

  assert.equal(terminal.payload.result.status, 'completed', 'the mock lies in the event payload, same as it lies in run()');
  assert.equal(terminal.payload.result.verification.claimedExit, brief.verification.expectExit);
  assert.ok(existsSync(join(dir, 'unrelated.txt')));
  assert.ok(!existsSync(join(dir, 'done.txt')), 'done.txt was never actually created — the check would really fail');
});

// ============================================================
// blocked without blocker — behavior 5 (kept on run(); TypeError contract unaffected)
// ============================================================

test('MockAdapter.run outcome:"blocked" with no blocker set rejects with a TypeError (validated at run() entry)', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = { outcome: 'blocked' /* no blocker */ };
  const adapter = new MockAdapter({ scenario });
  await assert.rejects(() => adapter.run(makeBrief(), makeOpts(dir)), TypeError);
});

test('SESSION: spawn() with the same invalid scenario resolves Ack{ok:false} synchronously and never emits any event', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const adapter = new MockAdapter({ scenario: { outcome: 'blocked' } });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  const ack = await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  assert.equal(ack.ok, false);
  assert.match(ack.reason ?? '', /blocker/i);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(bus.events, [], 'a construction-time scenario error never starts a session, never emits turn_started');
});

// ============================================================
// determinism — behavior 7
// ============================================================

test('MockAdapter is deterministic: same scenario replayed in two fresh worktrees yields matching results and identical file content', async (t) => {
  const dir1 = makeRepo();
  const dir2 = makeRepo();
  t.after(() => { rmSync(dir1, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true }); });

  const scenario = {
    outcome: 'completed',
    edits: [
      { path: 'a.txt', content: 'alpha' },
      { path: 'b.txt', content: 'beta' },
    ],
    summary: 'did the thing',
    budgetUsed: { tokens: 42, usd: 0.01 },
  };
  const adapter1 = new MockAdapter({ scenario });
  const adapter2 = new MockAdapter({ scenario });

  const r1 = await adapter1.run(makeBrief(), makeOpts(dir1));
  const r2 = await adapter2.run(makeBrief(), makeOpts(dir2));

  // Commit SHAs are inherently worktree/repo-specific (different base commit identity per
  // temp repo) so they are excluded from the structural comparison; everything else —
  // including file content — must match byte-for-byte.
  const strip = (r) => {
    const clone = structuredClone(r);
    delete clone.artifacts.commits;
    delete clone.artifacts.diffRef;
    return clone;
  };
  assert.deepEqual(strip(r1), strip(r2));
  assert.equal(readFileSync(join(dir1, 'a.txt'), 'utf8'), readFileSync(join(dir2, 'a.txt'), 'utf8'));
  assert.equal(readFileSync(join(dir1, 'b.txt'), 'utf8'), readFileSync(join(dir2, 'b.txt'), 'utf8'));
});

// ============================================================
// SESSION MODE: interrupt() — Ack-immediately, confirmed-stop-as-event (D1/D9)
// ============================================================

test('SESSION: interrupt() acks immediately; control.interrupt_requested logs synchronously; control.interrupt_confirmed arrives only after the scripted stop delay, with exact partial progress', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [
      { path: 'a.txt', content: 'a', delayMs: 5 },
      { path: 'b.txt', content: 'b', delayMs: 5000 },
      { path: 'c.txt', content: 'c', delayMs: 5000 },
    ],
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  await bus.waitFor((e) => e.kind === 'content.file_edit'); // exactly 1 edit has landed

  const interruptAck = await adapter.interrupt('w1');
  assert.equal(interruptAck.ok, true, 'interrupt() Ack resolves without waiting for the confirmed-stop event');

  const requested = bus.events.find((e) => e.kind === 'control.interrupt_requested');
  assert.ok(requested, 'the request itself is logged synchronously, distinct from the confirmation');

  const confirmed = await bus.waitFor((e) => e.kind === 'control.interrupt_confirmed');
  assert.equal(confirmed.worker, 'w1');
  assert.equal(confirmed.payload.result.status, 'cancelled');
  assert.equal(confirmed.payload.result.progress, 1 / 3);
  assert.deepEqual(confirmed.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });

  assert.ok(existsSync(join(dir, 'a.txt')));
  assert.ok(!existsSync(join(dir, 'b.txt')));
  assert.ok(!existsSync(join(dir, 'c.txt')));
  assert.equal(bus.events.filter((e) => e.kind === 'lifecycle.turn_completed').length, 0, 'a stopped run never also fires turn_completed');
});

test('SESSION: interrupt racing natural completion always resolves exactly ONE terminal event, never both, never a hang', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 0 }],
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  const interruptAck = await adapter.interrupt('w1');
  assert.equal(interruptAck.ok, true, 'every interrupt() Ack resolves — never hangs (D9)');

  const terminal = await bus.waitFor((e) => TERMINAL_KINDS.has(e.kind));
  assert.ok(['control.interrupt_confirmed', 'lifecycle.turn_completed'].includes(terminal.kind));

  await new Promise((resolve) => setTimeout(resolve, 30));
  const terminalCount = bus.events.filter((e) => TERMINAL_KINDS.has(e.kind)).length;
  assert.equal(terminalCount, 1, 'exactly one terminal event ever fires for a session, regardless of the race');
});

test('SESSION: a second interrupt() while already stopping does not re-emit control.interrupt_requested or produce a second confirmation', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5 }, { path: 'b.txt', content: 'b', delayMs: 200 }],
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  await bus.waitFor((e) => e.kind === 'content.file_edit');

  const ack1 = await adapter.interrupt('w1');
  const ack2 = await adapter.interrupt('w1');
  assert.equal(ack1.ok, true);
  assert.equal(ack2.ok, true, 'a redundant interrupt() while stopping is still acked (never rejects/hangs)');

  await bus.waitFor((e) => e.kind === 'control.interrupt_confirmed');
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(bus.events.filter((e) => e.kind === 'control.interrupt_requested').length, 1, 'the adapter does not re-request a stop already in flight');
  assert.equal(bus.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 1, 'exactly one confirmation, never a duplicate');
});

test('SESSION: kill() arriving during a soft interrupt()\'s wait escalates to kill.confirmed, not interrupt_confirmed', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5 }, { path: 'b.txt', content: 'b', delayMs: 5000 }],
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  await bus.waitFor((e) => e.kind === 'content.file_edit');

  await adapter.interrupt('w1'); // soft stop requested, not yet confirmed (b.txt's delayMs is huge)
  const killAck = await adapter.kill('w1');
  assert.equal(killAck.ok, true);

  const terminal = await bus.waitFor((e) => TERMINAL_KINDS.has(e.kind));
  assert.equal(terminal.kind, 'kill.confirmed', 'kill escalates a pending interrupt — the terminal outcome is a kill, not the softer interrupt');
  assert.deepEqual(terminal.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
  assert.equal(bus.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 0, 'the soft interrupt never separately confirms once escalated');
});

// ============================================================
// SESSION MODE: kill() from idle/working — new
// ============================================================

test('SESSION: kill() on a working session acks immediately, logs kill.requested then (after settling) kill.confirmed, and halts further edits', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5 }, { path: 'b.txt', content: 'b', delayMs: 5000 }],
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  await bus.waitFor((e) => e.kind === 'content.file_edit');

  const killAck = await adapter.kill('w1');
  assert.equal(killAck.ok, true);
  assert.ok(bus.events.some((e) => e.kind === 'kill.requested'), 'kill request is logged synchronously');

  const confirmed = await bus.waitFor((e) => e.kind === 'kill.confirmed');
  assert.equal(confirmed.worker, 'w1');
  assert.deepEqual(confirmed.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });
  assert.ok(!existsSync(join(dir, 'b.txt')), 'the edit scheduled after the kill point never lands');
});

// ============================================================
// SESSION MODE: question.asked/answer() vs approval.requested/approve() — red core#1 / D1
// ============================================================

test('SESSION: a blocking QUESTION is unblocked by answer(), and approve() has no effect on it', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'before.txt', content: 'before' }],
    ask: {
      kind: 'question',
      question: 'proceed?',
      blocking: true,
      afterEditIndex: 1,
      onAnswerEdits: [{ path: 'after.txt', content: 'after' }],
    },
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  const asked = await bus.waitFor((e) => e.kind === 'question.asked');
  assert.equal(asked.payload.question, 'proceed?');
  const requestId = asked.payload.requestId;
  assert.equal(typeof requestId, 'string');

  // Wrong method: approve() must NOT unblock a question wait-item.
  const wrongAck = await adapter.approve('w1', requestId, 'allow');
  assert.equal(wrongAck.ok, false, 'approve() is refused against a question wait-item (D1: distinct methods, not aliases)');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!existsSync(join(dir, 'after.txt')), 'the run is still blocked — approve() had no effect');

  // Right method: answer() unblocks it and the effect is observable both on disk and in the log.
  const rightAck = await adapter.answer('w1', requestId, { decision: 'yes' });
  assert.equal(rightAck.ok, true);

  const answered = await bus.waitFor((e) => e.kind === 'question.answered');
  assert.equal(answered.payload.requestId, requestId);
  const terminal = await bus.waitFor((e) => e.kind === 'lifecycle.turn_completed');
  assert.equal(terminal.payload.result.status, 'completed');
  assert.ok(existsSync(join(dir, 'after.txt')), 'onAnswerEdits applied after answer() — the real effect, not just a status');
});

test('SESSION: a blocking APPROVAL is unblocked by approve(), and answer() has no effect on it', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'before.txt', content: 'before' }],
    ask: {
      kind: 'approval',
      question: 'allow risky op?',
      blocking: true,
      afterEditIndex: 1,
      onAnswerEdits: [{ path: 'after.txt', content: 'after' }],
    },
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  const asked = await bus.waitFor((e) => e.kind === 'approval.requested');
  const requestId = asked.payload.requestId;

  const wrongAck = await adapter.answer('w1', requestId, { decision: 'yes' });
  assert.equal(wrongAck.ok, false, 'answer() is refused against an approval wait-item');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(!existsSync(join(dir, 'after.txt')));

  const rightAck = await adapter.approve('w1', requestId, 'allow');
  assert.equal(rightAck.ok, true);

  const resolved = await bus.waitFor((e) => e.kind === 'approval.resolved');
  assert.equal(resolved.payload.requestId, requestId);
  assert.equal(resolved.payload.decision, 'allow', 'the closed decision enum is carried onto the resolved event');
  await bus.waitFor((e) => e.kind === 'lifecycle.turn_completed');
  assert.ok(existsSync(join(dir, 'after.txt')));
});

test('SESSION: approve() rejects a "cancel" decision path without applying onAnswerEdits, ending the run non-completed', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'before.txt', content: 'before' }],
    ask: {
      kind: 'approval',
      question: 'allow risky op?',
      blocking: true,
      afterEditIndex: 1,
      onAnswerEdits: [{ path: 'after.txt', content: 'after' }],
    },
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w1', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  const asked = await bus.waitFor((e) => e.kind === 'approval.requested');
  await adapter.approve('w1', asked.payload.requestId, 'deny');

  const resolved = await bus.waitFor((e) => e.kind === 'approval.resolved');
  assert.equal(resolved.payload.decision, 'deny');
  const terminal = await bus.waitFor((e) => TERMINAL_KINDS.has(e.kind));
  assert.notEqual(terminal.payload?.result?.status, 'completed', 'a denied approval never yields a completed run');
  assert.ok(!existsSync(join(dir, 'after.txt')), 'the gated edits are never applied on denial');
});

test('never answered, then interrupted: run never settles until interrupt(), then cancels promptly (one-shot run() convenience)', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ac = new AbortController();
  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'before.txt', content: 'before' }],
    ask: { question: 'proceed?', blocking: true, afterEditIndex: 1 },
  };
  const adapter = new MockAdapter({ scenario });

  const runPromise = adapter.run(makeBrief(), makeOpts(dir, { signal: ac.signal }));
  let settled = false;
  runPromise.then(() => { settled = true; }, () => { settled = true; });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false, 'an unanswered blocking ask with no onAsk must not let run() settle on its own');

  ac.abort();
  const result = await runPromise;
  assert.equal(result.status, 'cancelled');
});

test('non-blocking ask: run() proceeds to completion without waiting, but still emits question.asked (D3 kind)', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'done.txt', content: 'ok' }],
    ask: { kind: 'question', question: 'fyi', blocking: false, afterEditIndex: 0 },
  };
  const adapter = new MockAdapter({ scenario });
  const { events, log } = stubLog();

  const result = await adapter.run(makeBrief(), makeOpts(dir, { log }));
  assert.equal(result.status, 'completed');
  const askEvent = events.find((e) => e.kind === 'question.asked');
  assert.ok(askEvent, 'D3: question.asked, not approval.requested, for a question-kind ask');
  assert.equal(askEvent.payload.question, 'fyi');
});

// ============================================================
// SESSION MODE: crash surfaces as an EVENT (lifecycle.crashed), not a rejection —
// but run() still bridges it back to an AdapterCrashError rejection for one-shot callers.
// ============================================================

test('SESSION: a crashed run emits lifecycle.crashed via onEvent; no terminal completion/confirmation event ever follows', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5000 }],
    crashAfterMs: 5,
  };
  const adapter = new MockAdapter({ scenario });
  const bus = makeEventBus();
  adapter.onEvent(bus.cb);

  await adapter.spawn('w-crash', makeBrief(), { worktree: dir, timeoutMs: 20000 });
  const crashed = await bus.waitFor((e) => e.kind === 'lifecycle.crashed');
  assert.equal(crashed.worker, 'w-crash');
  assert.deepEqual(crashed.payload.usageSeal, { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(bus.events.filter((e) => e.kind === 'lifecycle.turn_completed').length, 0);
  assert.equal(bus.events.filter((e) => e.kind === 'control.interrupt_confirmed').length, 0);
  assert.ok(!existsSync(join(dir, 'a.txt')), 'the edit scheduled after the crash point never landed');
  assert.equal(commitCount(dir), 1, 'only the base commit exists — no fake completion commit');
});

test('crash: run() rejects with AdapterCrashError carrying workerId (bridges lifecycle.crashed back to a rejection)', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5000 }],
    crashAfterMs: 5,
  };
  const adapter = new MockAdapter({ scenario });

  await assert.rejects(
    () => adapter.run(makeBrief(), makeOpts(dir, { workerId: 'w-crash' })),
    (err) => {
      assert.ok(err instanceof AdapterCrashError);
      assert.equal(err.workerId, 'w-crash');
      return true;
    },
  );
  assert.ok(!existsSync(join(dir, 'a.txt')));
  assert.equal(commitCount(dir), 1);
});

test('crash and a "failed" WorkerResult are distinguishable failure channels', async (t) => {
  const crashDir = makeRepo();
  const failDir = makeRepo();
  t.after(() => { rmSync(crashDir, { recursive: true, force: true }); rmSync(failDir, { recursive: true, force: true }); });

  const crashAdapter = new MockAdapter({ scenario: { outcome: 'completed', crashAfterMs: 1, edits: [{ path: 'x', content: 'x', delayMs: 5000 }] } });
  const failAdapter = new MockAdapter({ scenario: { outcome: 'failed' } });

  let crashPathHit = false;
  try {
    await crashAdapter.run(makeBrief(), makeOpts(crashDir));
    assert.fail('expected a rejection');
  } catch (err) {
    assert.ok(err instanceof AdapterCrashError);
    crashPathHit = true;
  }
  assert.ok(crashPathHit);

  const result = await failAdapter.run(makeBrief(), makeOpts(failDir));
  assert.equal(result.status, 'failed', 'a low-quality-but-resolved result is a separate channel from a rejection');
});

// ============================================================
// crash / abort landing MID-git-op — red workers-trust#11
// ============================================================

test('a same-tick crash (crashAfterMs:0, delayMs:0) never leaves the worktree with a corrupt git state', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 0 }],
    crashAfterMs: 0,
  };
  const adapter = new MockAdapter({ scenario });

  try {
    await adapter.run(makeBrief(), makeOpts(dir));
  } catch {
    // either the crash wins the race (rejects) or the edit's git commit wins — both are
    // acceptable; what's NOT acceptable is a half-written index.
  }

  // The worktree must always be a git-valid state: `git status` doesn't error, and no
  // lockfile survives a same-tick abort (A5/A8: an in-flight git write is atomic).
  assert.doesNotThrow(() => sh('git', ['status', '--porcelain'], dir));
  assert.ok(!existsSync(join(dir, '.git', 'index.lock')), 'no index.lock survives a same-tick crash');
});

test('a same-tick abort (delayMs:0, immediate signal.abort()) never leaves the worktree with a corrupt git state', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ac = new AbortController();
  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 0 }],
  };
  const adapter = new MockAdapter({ scenario });
  const runPromise = adapter.run(makeBrief(), makeOpts(dir, { signal: ac.signal }));
  ac.abort();
  await runPromise;

  assert.doesNotThrow(() => sh('git', ['status', '--porcelain'], dir));
  assert.ok(!existsSync(join(dir, '.git', 'index.lock')), 'no index.lock survives a same-tick abort');
});

// ============================================================
// timeout enforcement — behavior 15
// ============================================================

test('MockAdapter self-enforces opts.timeoutMs even with no externally-supplied signal', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 5000 }],
  };
  const adapter = new MockAdapter({ scenario });
  const result = await adapter.run(makeBrief(), makeOpts(dir, { timeoutMs: 20, signal: undefined }));

  assert.equal(result.status, 'cancelled');
  assert.match(result.summary + JSON.stringify(result), /timeout/i);
});

// ============================================================
// log emission (D3 kinds) — behaviors 16-17
// ============================================================

test('log emission: documented D3 event-kind order for a full completed run() (opts.log)', async (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a' }, { path: 'b.txt', content: 'b' }],
  };
  const adapter = new MockAdapter({ scenario });
  const { events, log } = stubLog();
  await adapter.run(makeBrief(), makeOpts(dir, { log }));

  const kinds = events.map((e) => e.kind);
  assert.equal(kinds[0], 'lifecycle.turn_started');
  assert.equal(kinds.at(-1), 'lifecycle.turn_completed');
  const editKinds = kinds.filter((k) => k === 'content.file_edit');
  assert.equal(editKinds.length, 2, 'D3: content.file_edit (not action.file_edit), one per applied edit');
  assert.ok(kinds.every((k) => !k.startsWith('action.')), 'no pre-D3 action.* kind survives');

  const firstEditEvent = events.find((e) => e.kind === 'content.file_edit');
  assert.ok(firstEditEvent.payload && typeof firstEditEvent.payload.path === 'string');
});

test('opts.log presence/absence never changes the resolved WorkerResult', async (t) => {
  const dirWithLog = makeRepo();
  const dirNoLog = makeRepo();
  t.after(() => { rmSync(dirWithLog, { recursive: true, force: true }); rmSync(dirNoLog, { recursive: true, force: true }); });

  const scenario = { outcome: 'completed', edits: [{ path: 'a.txt', content: 'a' }] };
  const { log } = stubLog();
  const r1 = await new MockAdapter({ scenario }).run(makeBrief(), makeOpts(dirWithLog, { log }));
  const r2 = await new MockAdapter({ scenario }).run(makeBrief(), makeOpts(dirNoLog));

  const strip = (r) => { const c = structuredClone(r); delete c.artifacts.commits; delete c.artifacts.diffRef; return c; };
  assert.deepEqual(strip(r1), strip(r2));
});

// ============================================================
// renderBrief — behavior 18
// ============================================================

test('renderBrief includes definitionOfDone and the pinned verification.command verbatim, for every dialect', () => {
  const brief = makeBrief({
    definitionOfDone: 'THE EXACT DONE STRING #12345',
    verification: { command: 'THE EXACT PINNED COMMAND --flag=xyz', expectExit: 0 },
  });
  for (const dialect of ['codex-v2', 'claude']) {
    const rendered = renderBrief(brief, dialect);
    assert.equal(typeof rendered, 'string');
    assert.ok(rendered.includes('THE EXACT DONE STRING #12345'), `${dialect} must contain definitionOfDone verbatim`);
    assert.ok(rendered.includes('THE EXACT PINNED COMMAND --flag=xyz'), `${dialect} must contain the pinned command verbatim — the worker can never redefine done`);
  }
});

test('renderBrief preserves structured verifier argv for every provider dialect', () => {
  const brief = makeBrief({
    verification: {
      command: 'npm',
      arguments: ['test', '--prefix', 'impl', '--', 'a value with spaces'],
      cwd: 'packages/worker',
      expectExit: 0,
    },
  });
  for (const dialect of ['codex-v2', 'claude', 'grok-acp', 'kimi-acp']) {
    const rendered = renderBrief(brief, dialect);
    assert.match(rendered, /direct executable and argv \(no shell\)/u);
    assert.match(rendered, /Executable \(JSON string\): "npm"/u);
    assert.ok(rendered.includes('Arguments (JSON array, in order): ["test","--prefix","impl","--","a value with spaces"]'));
    assert.match(rendered, /Working directory .*: "packages\/worker"/u);
  }
});

test('renderBrief tells Context recipients they are already supervised without inventing a nested Baton surface', () => {
  const brief = makeBrief({
    tools: [],
    contextInput: {
      callId: `context-call:${'a'.repeat(64)}`,
      unitId: `context-unit:${'b'.repeat(64)}`,
      value: { finding: 'attached immutable result' },
    },
  });
  for (const dialect of ['codex-v2', 'claude']) {
    const rendered = renderBrief(brief, dialect);
    assert.match(rendered, /already dispatched and supervised by Baton/u);
    assert.match(rendered, /attached immutable Context is the complete task input/u);
    assert.match(rendered, /Writing a named output path does not authorize reading/u);
    assert.match(rendered, /Do not search for or launch another Baton CLI, MCP server, or Run/u);
    assert.match(rendered, /Unit: context-unit:/u);
    assert.ok(rendered.indexOf('## Immutable Context') < rendered.indexOf('## Verification'));
  }
});

test('renderBrief separates unattended harness capability from Baton write authority', () => {
  const brief = makeBrief({ pathScope: ['reviews/exact-report.md'] });
  for (const dialect of ['codex-v2', 'claude', 'grok-acp', 'kimi-acp']) {
    const rendered = renderBrief(brief, dialect);
    assert.match(rendered, /Harness permissions are execution capability, not write authority/u);
    assert.match(rendered, /Never modify, move, chmod, delete, replace, or repair anything outside/u);
    assert.match(rendered, /home directory, credentials, toolchains, shims, global configuration, or caches/u);
    assert.match(rendered, /Report an environmental blocker instead of repairing the host/u);
    assert.ok(rendered.indexOf('## Write authority') < rendered.indexOf('## Path scope'));
  }
});

test('renderBrief makes Plan repository-mutation authority explicit in every provider dialect', () => {
  const dialects = ['codex-v2', 'claude', 'grok-acp', 'kimi-acp'];
  const evidenceOnly = makeBrief({
    goal: 'Implement changes despite this inverse prose.',
    effects: [], requiredEffects: [],
  });
  const requiredEdit = makeBrief({
    goal: 'Audit only and do not edit despite this inverse prose.',
    effects: ['repository_edit'], requiredEffects: ['repository_edit'],
  });
  const derivedSemanticReview = makeBrief({
    goal: 'Write the derived semantic-review report.',
    pathScope: ['reviews/semantic-report.json'],
  });
  for (const dialect of dialects) {
    const evidenceRendered = renderBrief(evidenceOnly, dialect);
    assert.match(evidenceRendered, /Repository mutation is not authorized/u, dialect);
    assert.match(evidenceRendered, /Inspect\/read and return evidence only/u, dialect);
    assert.match(evidenceRendered, /do not create, modify, or delete files/u, dialect);

    const changeRendered = renderBrief(requiredEdit, dialect);
    assert.match(changeRendered, /approved Plan requires an in-scope repository edit for acceptance/u,
      dialect);
    assert.match(changeRendered, /Objective prose does not weaken this requirement/u, dialect);
    assert.doesNotMatch(changeRendered, /Repository mutation is not authorized/u, dialect);

    const reviewRendered = renderBrief(derivedSemanticReview, dialect);
    assert.doesNotMatch(reviewRendered, /Repository mutation authority/u, dialect);
    assert.doesNotMatch(reviewRendered, /do not create, modify, or delete files/u, dialect);
  }
});

// ============================================================
// SubprocessAdapter family — behaviors 19-22 (guard-off only; never live)
// ============================================================

test('SubprocessAdapter.run() with the live guard OFF (default) resolves blocked, never spawns, for all three vendors', async () => {
  const originalEnv = process.env.BATON_ALLOW_LIVE_ADAPTERS;
  delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
  try {
    for (const Adapter of [CodexAdapter, ClaudeAdapter, GlmAdapter]) {
      const adapter = new Adapter();
      const result = await adapter.run(makeBrief(), { worktree: '/nonexistent', timeoutMs: 1000, live: false });
      assert.equal(result.status, 'blocked');
      assert.match(result.blocker, /BATON_ALLOW_LIVE_ADAPTERS|live/i);
      assert.equal(result.verification.claimedExit, -1, 'un-matchable to any real expectExit');
      assert.equal(result.progress, 0);
    }
  } finally {
    if (originalEnv === undefined) delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
    else process.env.BATON_ALLOW_LIVE_ADAPTERS = originalEnv;
  }
});

test('SESSION: SubprocessAdapter.spawn() with the live guard OFF acks {ok:false}, never emits a single event', async () => {
  const originalEnv = process.env.BATON_ALLOW_LIVE_ADAPTERS;
  delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
  try {
    for (const Adapter of [CodexAdapter, ClaudeAdapter, GlmAdapter]) {
      const adapter = new Adapter();
      const bus = makeEventBus();
      adapter.onEvent(bus.cb);
      const ack = await adapter.spawn('w1', makeBrief(), { worktree: '/nonexistent', timeoutMs: 1000, live: false });
      assert.equal(ack.ok, false);
      assert.match(ack.reason ?? '', /BATON_ALLOW_LIVE_ADAPTERS|live/i);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(bus.events, [], 'the guard trips before any session, worker-mediated or not, ever starts');
    }
  } finally {
    if (originalEnv === undefined) delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
    else process.env.BATON_ALLOW_LIVE_ADAPTERS = originalEnv;
  }
});

test('the two-key live guard is a real AND: only one key set still takes the disabled path', async () => {
  const originalEnv = process.env.BATON_ALLOW_LIVE_ADAPTERS;
  try {
    // Key 1 only: opts.live true, env var unset.
    delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
    const r1 = await new ClaudeAdapter().run(makeBrief(), { worktree: '/nonexistent', timeoutMs: 1000, live: true });
    assert.equal(r1.status, 'blocked');
    assert.equal(r1.verification.claimedExit, -1);

    // Key 2 only: env var set, opts.live false/omitted.
    process.env.BATON_ALLOW_LIVE_ADAPTERS = '1';
    const r2 = await new ClaudeAdapter().run(makeBrief(), { worktree: '/nonexistent', timeoutMs: 1000, live: false });
    assert.equal(r2.status, 'blocked');
    assert.equal(r2.verification.claimedExit, -1);
  } finally {
    if (originalEnv === undefined) delete process.env.BATON_ALLOW_LIVE_ADAPTERS;
    else process.env.BATON_ALLOW_LIVE_ADAPTERS = originalEnv;
  }
});

test('argv() produces the documented cmd/args for each SubprocessAdapter subclass, with the rendered brief asserted directly (no vacuous escape hatch)', () => {
  const brief = makeBrief();
  const opts = { worktree: '/tmp/whatever', timeoutMs: 1000 };

  const codex = new CodexAdapter().argv(brief, opts);
  assert.equal(codex.cmd, 'codex');
  assert.deepEqual(codex.args.slice(0, 5), ['--ask-for-approval', 'never', '--sandbox', 'danger-full-access', 'exec']);
  assert.deepEqual(codex.args.slice(5, 7), ['--json', '--skip-git-repo-check']);
  assert.equal(codex.args.length, 8, 'exactly one trailing positional follows the explicit autonomy policy');
  assert.equal(codex.args[7], renderBrief(brief, 'codex-v2'));
  assert.ok(codex.args[7].includes(brief.verification.command));

  const claude = new ClaudeAdapter().argv(brief, opts);
  assert.equal(claude.cmd, 'claude');
  assert.equal(claude.args[0], '-p');
  assert.equal(claude.args[1], renderBrief(brief, 'claude'), 'the rendered brief is the positional arg right after -p');
  assert.ok(claude.args[1].includes(brief.verification.command));
  assert.ok(claude.args.includes('--permission-mode'));
  assert.ok(claude.args.includes('bypassPermissions'));

  const glm = new GlmAdapter().argv(brief, opts);
  assert.equal(glm.cmd, 'claude');
  assert.equal(glm.args[0], '-p');
  assert.equal(glm.args[1], renderBrief(brief, 'claude'));
  assert.ok(glm.args[1].includes(brief.verification.command));
  assert.ok(glm.args.includes('--permission-mode'));
  assert.ok(glm.args.includes('bypassPermissions'));

  assert.equal(new ClaudeAdapter().argv(brief, { ...opts, permissionMode: 'acceptEdits' }).args.at(-1), 'acceptEdits');
});

test('GlmAdapter.card() reports harness "glm-via-claude" and concurrencyCeiling 1 despite extending ClaudeAdapter', () => {
  const card = new GlmAdapter().card();
  assert.equal(card.harness, 'glm-via-claude');
  assert.equal(card.concurrencyCeiling, 1);
});

// ============================================================
// verbs map — red workers-trust#6, pinned by D11
// ============================================================

// D11 as amended by SC8 (spec/phase10/system-completion.md): D11's steer-native fact belongs to
// the codex SESSION surface and is pinned there (CodexAppServerCli's own suite). The legacy
// subprocess tier below implements ONLY spawn — SubprocessAdapterBase stubs prompt/interrupt/
// approve/answer/kill as not-implemented — so its card may not claim otherwise, and the pre-D1
// `ask` key is retired for the canonical approve/answer.
test('D11 as amended by SC8: CodexAdapter (legacy subprocess) card().verbs is the canonical 8-key map claiming only what the tier implements', () => {
  const verbs = new CodexAdapter().card().verbs;
  assert.deepEqual(verbs, {
    spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'unsupported',
    approve: 'unsupported', answer: 'unsupported', kill: 'unsupported', pause: 'unsupported',
  });
});

test('ClaudeAdapter.card().verbs pins the exact SC8-honest map (legacy tier: only spawn is implemented)', () => {
  const verbs = new ClaudeAdapter().card().verbs;
  assert.deepEqual(verbs, {
    spawn: 'native', prompt: 'unsupported', steer: 'unsupported', interrupt: 'unsupported',
    approve: 'unsupported', answer: 'unsupported', kill: 'unsupported', pause: 'unsupported',
  });
});
