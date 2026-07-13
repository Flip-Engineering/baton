// grok-acp.test.mjs — TDD-RED tests for the Grok Build ACP SESSION adapter
// (spec/phase9/grok-acp-adapter.md, contracts GA1..GA20). Drives the REAL adapter
// (src/grok-acp.mjs) against test/fixtures/fake-grok-acp.mjs — a protocol-level double of
// `grok agent stdio` speaking the pinned ACP wire (JSON-RPC 2.0 WITH `jsonrpc`, [live]-shaped
// initialize/auth frames, long-lived session/prompt whose response IS the turn terminal,
// session/cancel as a response-less notification, session/request_permission options).
// Zero model quota: no real `grok` binary is ever spawned (versionProbe injected; cmd/args
// point at the fake). Run with bare `node --test` from impl/ (node 25).
//
// Every test asserts an EFFECT observed through the public D1 Adapter surface (Acks + the
// onEvent stream), not internal state — black-box conformance against the spec.
//
// ⛔ Live-smoke gate (spec §0 / docs/23): green here does NOT make the adapter "done" — the
// fake mirrors [acp-spec]+[doc] claims for everything model-side, which is exactly the circular-
// validation trap phase 8.1 documented. The post-auth smoke checklist in the spec is mandatory
// before card() verbs marked native are trusted against the real binary.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GrokAcpCli } from '../src/grok-acp.mjs';
import { assertIsAdapter } from '../src/adapter.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-grok-acp.mjs');

function makeBrief(goal = 'implement the thing') {
  return {
    goal,
    constraints: [],
    pathScope: ['src/**'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 10000, usd: 1, wallMin: 5 },
  };
}

function makeAdapter(extra = {}) {
  return new GrokAcpCli({
    cmd: process.execPath,
    // '--serve' is the fixture's discovery-guard sentinel (phase8 R1): without it the fixture
    // exits inert so bare `node --test` discovery never hangs on it.
    args: [FIXTURE, '--serve'],
    env: extra.env,
    requestTimeoutMs: extra.requestTimeoutMs ?? 2000,
    stopDeadlineMs: extra.stopDeadlineMs,
    ceiling: 4,
    maxContext: extra.maxContext,
    maxEventPayloadBytes: extra.maxEventPayloadBytes,
    versionProbe: extra.versionProbe ?? (() => 'fake-grok/0.1.216-test'),
  });
}

function freshWorktree() {
  return mkdtempSync(join(tmpdir(), 'grok-acp-'));
}

function collect(adapter) {
  const events = [];
  adapter.onEvent((e) => events.push(e));
  return events;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function until(events, predicate, { timeoutMs = 3000, intervalMs = 15 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.find(predicate);
    if (found) return found;
    if (Date.now() >= deadline) {
      throw new Error(`until(): predicate not satisfied within ${timeoutMs}ms; saw kinds: [${events.map((e) => e.kind).join(', ')}]`);
    }
    await delay(intervalMs);
  }
}

async function never(events, predicate, { forMs = 150 } = {}) {
  await delay(forMs);
  assert.equal(events.some(predicate), false, `expected predicate to NOT be satisfied within ${forMs}ms; saw kinds: [${events.map((e) => e.kind).join(', ')}]`);
}

async function cleanup(adapter, worker) {
  try { await adapter.kill(worker); } catch { /* already dead */ }
  await delay(30);
}

const TERMINAL_KINDS = ['lifecycle.turn_completed', 'lifecycle.crashed', 'control.interrupt_confirmed', 'control.steer'];

// ---------------------------------------------------------------------------
// GA4 / construction & conformance
// ---------------------------------------------------------------------------

test('GA4/D1: GrokAcpCli conforms to the session Adapter interface (card/spawn/prompt/interrupt/approve/answer/kill/onEvent)', () => {
  const adapter = makeAdapter();
  assert.doesNotThrow(() => assertIsAdapter(adapter));
});

test('GA3: constructing without requestTimeoutMs or stopDeadlineMs throws — no invented timeout constant', () => {
  assert.throws(
    () => new GrokAcpCli({ cmd: process.execPath, args: [FIXTURE] }),
    /requestTimeoutMs|stopDeadlineMs/,
  );
});

test('GA3: stopDeadlineMs alone (mirroring the Coordinator option name) is sufficient', () => {
  assert.doesNotThrow(() => new GrokAcpCli({ cmd: process.execPath, args: [FIXTURE], stopDeadlineMs: 15000 }));
});

test('GA14/GA15: card() reports harness grok, injected version, steer:emulated, answer:unsupported, and the live-derived 500K default maxContext', () => {
  const adapter = makeAdapter({ versionProbe: () => 'grok 0.1.216-fake' });
  const card = adapter.card();
  assert.equal(card.harness, 'grok');
  assert.equal(card.version, 'grok 0.1.216-fake');
  assert.equal(card.maxContext, 500000, 'default maxContext is the live handshake totalContextTokens, not an invented number');
  assert.equal(card.verbs.spawn, 'native');
  assert.equal(card.verbs.prompt, 'native');
  assert.equal(card.verbs.steer, 'emulated', 'the wire genuinely lacks steer — declared, never silent');
  assert.equal(card.verbs.interrupt, 'native');
  assert.equal(card.verbs.approve, 'native');
  assert.equal(card.verbs.answer, 'unsupported', 'ACP has no ask-user primitive — a named gap, not an emulation');
  assert.equal(card.verbs.kill, 'native');
  assert.equal(card.verbs.pause, 'unsupported');
});

test('GA15: the default version probe describes the injected executable, not a different bare grok on PATH', () => {
  const adapter = new GrokAcpCli({ cmd: process.execPath, requestTimeoutMs: 100 });
  assert.equal(adapter.card().version, process.version);
});

// ---------------------------------------------------------------------------
// GA6: spawn = initialize -> session/new -> first prompt dispatch; natural completion
// ---------------------------------------------------------------------------

test('GA6: spawn() acks ok:true and drives lifecycle.spawned -> turn_started -> content.message chunks -> lifecycle.turn_completed', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    const ack = await adapter.spawn(worker, makeBrief('say hello'), { worktree: freshWorktree() });
    assert.equal(ack.ok, true);
    const spawned = await until(events, (e) => e.kind === 'lifecycle.spawned');
    assert.equal(typeof spawned.payload.sessionId, 'string');
    await until(events, (e) => e.kind === 'lifecycle.turn_started');
    const msg = await until(events, (e) => e.kind === 'content.message');
    assert.equal(msg.payload.chunked, true, 'ACP messages arrive as chunks and pass through individually (GA19)');
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.worker, worker);
    assert.equal(terminal.payload.result.status, 'completed');
    assert.equal(terminal.payload.stopReason, 'end_turn');
    assert.equal(typeof terminal.payload.sessionId, 'string');
    assert.equal(typeof terminal.payload.turnId, 'string', 'ACP has no wire turn id — the adapter mints one (GA6)');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA16: exactly one terminal event fires per turn', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    await delay(100);
    const terminals = events.filter((e) => TERMINAL_KINDS.includes(e.kind));
    assert.equal(terminals.length, 1);
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA19: a tool_call session/update maps to content.tool_call', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    const tc = await until(events, (e) => e.kind === 'content.tool_call');
    assert.equal(typeof tc.payload.toolCallId, 'string');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA19: oversized provider tool telemetry is digest-bounded before authoritative logging', async () => {
  const adapter = makeAdapter({ maxEventPayloadBytes: 2048 });
  const events = collect(adapter); const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:LARGE_TOOL_OUTPUT'), { worktree: freshWorktree() });
    const tc = await until(events, (e) => e.kind === 'content.tool_call');
    assert.equal(tc.payload.sessionUpdate, 'tool_call_update'); assert.equal(tc.payload.status, 'completed');
    assert.equal(tc.payload.wireEvidence.truncated, true); assert.equal(tc.payload.wireEvidence.originalBytes > 128 * 1024, true);
    assert.match(tc.payload.wireEvidence.sha256, /^[a-f0-9]{64}$/); assert.equal(Buffer.byteLength(JSON.stringify(tc.payload)) < 4096, true);
    const edit = await until(events, (e) => e.kind === 'content.file_edit');
    assert.deepEqual(edit.payload.paths, ['/fake/huge.txt']); assert.equal(edit.payload.diffs.truncated, true);
  } finally { await cleanup(adapter, worker); }
});

// ---------------------------------------------------------------------------
// GA18: terminal mapping — crash (error response) and refusal (routable signal)
// ---------------------------------------------------------------------------

test('GA18: a prompt that resolves as a JSON-RPC ERROR (FAKE:CRASH) emits lifecycle.crashed as its sole terminal, never turn_completed', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:CRASH please fail'), { worktree: freshWorktree() });
    const crash = await until(events, (e) => e.kind === 'lifecycle.crashed');
    assert.match(crash.payload.error, /boom/);
    await delay(60);
    assert.equal(events.some((e) => e.kind === 'lifecycle.turn_completed'), false);
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA18: stopReason "refusal" maps to lifecycle.crashed with payload.stopReason:"refusal" — the router-visible refusal signal', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REFUSAL do something it declines'), { worktree: freshWorktree() });
    const crash = await until(events, (e) => e.kind === 'lifecycle.crashed');
    assert.equal(crash.payload.stopReason, 'refusal');
    await delay(60);
    assert.equal(events.some((e) => e.kind === 'lifecycle.turn_completed'), false);
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// GA7: multi-turn (native, same session), one-prompt-at-a-time, nudge buffering
// ---------------------------------------------------------------------------

test('GA7: prompt(worker, content, "turn") runs a second turn on the SAME sessionId (native multi-turn)', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('first task'), { worktree: freshWorktree() });
    const t1 = await until(events, (e) => e.kind === 'lifecycle.turn_completed');

    const ack = await adapter.prompt(worker, 'second task', 'turn');
    assert.equal(ack.ok, true);
    const t2 = await until(events, (e) => e.kind === 'lifecycle.turn_completed' && e.payload.turnId !== t1.payload.turnId);
    assert.equal(t2.payload.sessionId, t1.payload.sessionId, 'same ACP session across turns — the multi-turn capability one-shot adapters cannot offer');
    assert.notEqual(t2.payload.turnId, t1.payload.turnId);
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA7: prompt(..., "turn") while a turn is ACTIVE resolves {ok:false} — ACP baseline is one prompt turn at a time', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN long task'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_started');
    const ack = await adapter.prompt(worker, 'a concurrent turn', 'turn');
    assert.equal(ack.ok, false, 'mid-turn session/prompt is protocol-undefined until the post-auth probe (spec smoke item 4)');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA7: prompt(..., "nudge") buffers with emulated:true and is prepended to the next turn', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('first'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_completed');

    const nudgeAck = await adapter.prompt(worker, 'remember the deadline', 'nudge');
    assert.equal(nudgeAck.ok, true);
    assert.equal(nudgeAck.emulated, true, 'no queue-for-next-turn primitive on this wire — flagged, never silent');

    await adapter.prompt(worker, 'second task', 'turn');
    // The fake echoes the full prompt text back in its completion message.
    const done = await until(events, (e) => e.kind === 'content.message' && /done:.*remember the deadline/s.test(e.payload.text));
    assert.match(done.payload.text, /second task/);
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// GA13: steer emulation — cancel-then-reprompt, NO phantom interrupt events
// ---------------------------------------------------------------------------

test('GA13: prompt(..., "steer") acks {ok:true, emulated:true}, emits control.steer (never control.interrupt_confirmed), and the steer content runs as the next turn on the same session', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN original heading'), { worktree: freshWorktree() });
    const started = await until(events, (e) => e.kind === 'lifecycle.turn_started');

    // Prove the turn genuinely would not complete on its own.
    await never(events, (e) => TERMINAL_KINDS.includes(e.kind), { forMs: 100 });

    const ack = await adapter.prompt(worker, 'focus on the failing tests', 'steer');
    assert.equal(ack.ok, true);
    assert.equal(ack.emulated, true, 'the wire lacks steer — the emulation is declared on every Ack');

    const steered = await until(events, (e) => e.kind === 'control.steer');
    assert.equal(steered.actor, 'orchestrator');
    assert.equal(steered.payload.emulated, true);

    // The steer content runs as a NEW turn on the SAME session and completes.
    await until(events, (e) => e.kind === 'content.message' && /done:.*focus on the failing tests/s.test(e.payload.text));
    const done = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(done.payload.sessionId, started.payload.sessionId, 'steer re-prompts the SAME session — history survives natively');

    // E2's lesson enforced structurally: the emulation's internal cancel must NOT masquerade as
    // an orchestrator interrupt.
    assert.equal(events.some((e) => e.kind === 'control.interrupt_confirmed'), false, 'no phantom interrupt events from steer plumbing');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA13: steer with no active turn resolves {ok:false}, never throws', async () => {
  const adapter = makeAdapter();
  const worker = 'w1';
  try {
    const ack = await adapter.prompt(worker, 'steer into nothing', 'steer');
    assert.equal(ack.ok, false);
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// GA8: interrupt — session/cancel notification; confirmed stop is an EVENT; session survives
// ---------------------------------------------------------------------------

test('GA8: interrupt() acks immediately; control.interrupt_confirmed arrives via the cancelled prompt resolution', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN never finishes'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_started');

    const ack = await adapter.interrupt(worker);
    assert.equal(ack.ok, true);
    assert.equal(ack.emulated, undefined, 'session/cancel is the wire-native cancellation, not a signal-kill emulation');

    const confirmed = await until(events, (e) => e.kind === 'control.interrupt_confirmed');
    assert.equal(confirmed.worker, worker);
    assert.equal(confirmed.payload.result.status, 'cancelled');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA8: after interrupt, the SESSION SURVIVES — a subsequent prompt(worker, x, "turn") completes on the same sessionId', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN first'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_started');

    await adapter.interrupt(worker);
    const confirmed = await until(events, (e) => e.kind === 'control.interrupt_confirmed');
    const sessionId = confirmed.payload.sessionId;

    const promptAck = await adapter.prompt(worker, 'second task after interrupt', 'turn');
    assert.equal(promptAck.ok, true, 'interrupt ended the turn, not the session');

    const completed = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(completed.payload.sessionId, sessionId, 'still the same ACP session — a respawn would have minted a new one');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA8: interrupt(worker, then) automatically issues the follow-up turn once the interrupt is confirmed', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN first'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_started');

    await adapter.interrupt(worker, 'do the follow-up instead');
    await until(events, (e) => e.kind === 'control.interrupt_confirmed');
    const completed = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(completed.payload.result.status, 'completed');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// GA9: approve() — ACP permission options round-trip; turn blocked until delivered
// ---------------------------------------------------------------------------

test('GA9: a pending session/request_permission BLOCKS the turn until approve("allow") delivers, then the turn completes', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_PERMISSION do a risky thing'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    assert.equal(typeof req.payload.requestId, 'string');
    assert.ok(Array.isArray(req.payload.options), 'the ACP options[] are surfaced so the hub can render them');

    await never(events, (e) => TERMINAL_KINDS.includes(e.kind), { forMs: 100 });

    const ack = await adapter.approve(worker, req.payload.requestId, 'allow');
    assert.equal(ack.ok, true);

    await until(events, (e) => e.kind === 'content.message' && /approved: proceeding/.test(e.payload.text));
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA9: approve(..., "deny") selects the reject option — the agent continues and the turn completes without the tool', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_PERMISSION risky'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    await adapter.approve(worker, req.payload.requestId, 'deny');
    await until(events, (e) => e.kind === 'content.message' && /declined: skipping step/.test(e.payload.text));
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA9: approve(..., "cancel") maps to the ACP cancelled outcome and the turn ends as control.interrupt_confirmed', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_PERMISSION risky'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    await adapter.approve(worker, req.payload.requestId, 'cancel');
    const terminal = await until(events, (e) => TERMINAL_KINDS.includes(e.kind));
    assert.equal(terminal.kind, 'control.interrupt_confirmed', 'per ACP, a cancelled permission belongs to a cancelled turn');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA9: approve() against an unknown/already-answered requestId resolves {ok:false} — answer exactly once', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_PERMISSION risky'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    const first = await adapter.approve(worker, req.payload.requestId, 'allow');
    assert.equal(first.ok, true);
    await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    const second = await adapter.approve(worker, req.payload.requestId, 'allow');
    assert.equal(second.ok, false, 'a request is a consumable message, not a replayable fact');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('GA9: approval racing a closed stdin returns refused delivery without process-global EPIPE', async () => {
  const adapter = makeAdapter(); const events = collect(adapter); const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_PERMISSION risky'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    const pipe = adapter._sessions.get(worker).child.stdin;
    pipe.destroy(Object.assign(new Error('simulated closed approval pipe'), { code: 'EPIPE' }));
    await delay(10);
    const ack = await adapter.approve(worker, req.payload.requestId, 'allow');
    assert.equal(ack.ok, false); assert.match(ack.reason, /stdio closed/i);
    assert.equal(events.some((event) => event.kind === 'approval.resolved' && event.payload.requestId === req.payload.requestId), false);
  } finally { await cleanup(adapter, worker); }
});

// ---------------------------------------------------------------------------
// GA12: answer() is a named gap on this wire
// ---------------------------------------------------------------------------

test('GA12: answer() always resolves {ok:false} — ACP has no ask-user primitive (card verbs.answer is "unsupported")', async () => {
  const adapter = makeAdapter();
  const worker = 'w1';
  const ack = await adapter.answer(worker, 'any-request-id', { text: 'irrelevant' });
  assert.equal(ack.ok, false);
  assert.match(ack.reason, /unsupported|no .*primitive/i);
});

// ---------------------------------------------------------------------------
// GA10: the [live]-pinned auth gate is a typed spawn failure
// ---------------------------------------------------------------------------

test('GA10: session/new failing -32000 "Authentication required" (live-pinned shape) surfaces as {ok:false, code:-32000}, never a throw or retry loop', async () => {
  const adapter = makeAdapter({ env: { FAKE_GROK_UNAUTH: '1' } });
  const worker = 'w1';
  const ack = await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, -32000);
  assert.match(ack.reason, /Authentication required/);
});

// ---------------------------------------------------------------------------
// GA3: bounded setup RPCs — a hung initialize cannot hang spawn()
// ---------------------------------------------------------------------------

test('GA3: a server that never answers initialize causes spawn() to resolve {ok:false} within requestTimeoutMs', async () => {
  const adapter = makeAdapter({ env: { FAKE_GROK_HANG: '1' }, requestTimeoutMs: 200 });
  const worker = 'w1';
  const started = Date.now();
  const ack = await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
  const elapsed = Date.now() - started;
  assert.equal(ack.ok, false);
  assert.ok(elapsed < 2000, `expected a bounded wait near requestTimeoutMs, took ${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// GA5/GA17: garbage immunity; id-less errors surface uncorrelated
// ---------------------------------------------------------------------------

test('GA17: malformed lines, unknown notifications, and unknown sessionUpdate variants never crash the adapter or fake a terminal; an id-less error surfaces uncorrelated', async () => {
  const adapter = makeAdapter({ env: { FAKE_GROK_MALFORMED: '1' } });
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
    assert.equal(events.some((e) => e.kind === 'lifecycle.crashed'), false, 'garbage input must never be mistaken for a crash');
    const idless = events.find((e) => e.kind === 'error' && e.payload.correlated === false);
    assert.ok(idless, 'GA5: the id-less error is observable, never speculatively matched');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// Anti-wedge (X3 lesson, day one): unmapped server->client requests are ANSWERED
// ---------------------------------------------------------------------------

test('anti-wedge: an unmapped x.ai/* server->client REQUEST is auto-answered with an error (turn completes; observable error event; never surfaced as an approval)', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:SERVER_UNKNOWN_REQUEST needs client fs'), { worktree: freshWorktree() });
    // The fake blocks the turn until OUR response arrives — completion IS the proof.
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
    const surfaced = events.find((e) => e.kind === 'error' && e.payload.serverMethod === 'x.ai/fs/read_text_file');
    assert.ok(surfaced, 'the auto-decline is observable, not a silent drop');
    assert.equal(surfaced.payload.correlated, true);
    assert.equal(events.some((e) => e.kind === 'approval.requested'), false);
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// GA1: per-worker isolation
// ---------------------------------------------------------------------------

test('GA1: two workers are fully isolated — independent sessionIds; interrupting one leaves the other steerable', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  try {
    await adapter.spawn('wA', makeBrief('FAKE:STAY_OPEN task A'), { worktree: freshWorktree() });
    await adapter.spawn('wB', makeBrief('FAKE:STAY_OPEN task B'), { worktree: freshWorktree() });
    const spawnedA = await until(events, (e) => e.kind === 'lifecycle.spawned' && e.worker === 'wA');
    const spawnedB = await until(events, (e) => e.kind === 'lifecycle.spawned' && e.worker === 'wB');
    assert.notEqual(spawnedA.payload.sessionId, spawnedB.payload.sessionId, 'each worker owns its own child process/session');

    await adapter.interrupt('wA');
    await until(events, (e) => e.kind === 'control.interrupt_confirmed' && e.worker === 'wA');

    const steerAck = await adapter.prompt('wB', 'still going', 'steer');
    assert.equal(steerAck.ok, true, "worker B's turn is still active — untouched by worker A's interrupt");
  } finally {
    await cleanup(adapter, 'wA');
    await cleanup(adapter, 'wB');
  }
});

// ---------------------------------------------------------------------------
// GA11: kill = process-group SIGKILL + confirmed-stop event; no crash from a deliberate kill
// ---------------------------------------------------------------------------

test('GA11: kill() force-ends the worker and emits kill.confirmed once the process is gone — never a lifecycle.crashed for a deliberate kill', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN never finishes'), { worktree: freshWorktree() });
  await until(events, (e) => e.kind === 'lifecycle.turn_started');

  const ack = await adapter.kill(worker);
  assert.equal(ack.ok, true);
  const confirmed = await until(events, (e) => e.kind === 'kill.confirmed');
  assert.equal(confirmed.worker, worker);
  await delay(60);
  assert.equal(events.some((e) => e.kind === 'lifecycle.crashed'), false, 'a deliberate kill is not a worker crash (GA11 close-path absorption)');
});

// ---------------------------------------------------------------------------
// Live-smoke corrections F1/F2 (probes #3/#4, 2026-07-10, authenticated grok 0.1.216)
// ---------------------------------------------------------------------------

test('F1 (live-pinned): the prompt response _meta becomes a resource.tokens event and the terminal result carries budgetUsed.tokens', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    const res = await until(events, (e) => e.kind === 'resource.tokens');
    assert.equal(res.payload.source, 'promptMeta');
    assert.equal(typeof res.payload.totalTokens, 'number');
    assert.equal(typeof res.payload.outputTokens, 'number');
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.ok(terminal.payload.result.budgetUsed.tokens > 0, 'GA20 was overturned live: usage IS on the wire and must reach the result');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('F2 (live-pinned): tool_call_update (status/diff transitions) maps to content.tool_call alongside the initial tool_call', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'content.tool_call' && e.payload.sessionUpdate === 'tool_call');
    const upd = await until(events, (e) => e.kind === 'content.tool_call' && e.payload.sessionUpdate === 'tool_call_update');
    assert.equal(upd.payload.status, 'completed');
    assert.equal(upd.payload.content?.[0]?.type, 'diff');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// GA18: unexpected child death mid-turn IS a crash (the close path settles the unbounded prompt)
// ---------------------------------------------------------------------------

test('GA18: the child dying mid-turn (not killed by us) settles the pending prompt as lifecycle.crashed — the unbounded prompt request cannot dangle', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN then die'), { worktree: freshWorktree() });
    const started = await until(events, (e) => e.kind === 'lifecycle.turn_started');
    assert.ok(started);

    // Simulate an external/vendor-side death: SIGKILL the child directly, NOT via adapter.kill().
    const pid = (await until(events, (e) => e.kind === 'lifecycle.spawned')).payload.pid;
    process.kill(pid, 'SIGKILL');

    const crash = await until(events, (e) => e.kind === 'lifecycle.crashed');
    assert.match(crash.payload.error, /closed|died|exit/i);
  } finally {
    await cleanup(adapter, worker);
  }
});
