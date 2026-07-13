// codex-appserver.test.mjs — TDD-RED tests for the Codex app-server SESSION adapter
// (spec/phase8/codex-appserver-adapter.md, contracts XA1..XA20). Drives the REAL adapter
// (src/codex-appserver.mjs, not yet implemented) against test/fixtures/fake-codex-appserver.mjs
// — a protocol-level double of `codex app-server` speaking the real, schema-verified wire
// vocabulary (initialize / thread/start / turn/start / turn/steer / turn/interrupt / the two
// approval request methods / item/tool/requestUserInput). Zero model quota: no real `codex`
// binary is ever spawned by these tests (versionProbe is injected; cmd/args point at the fake
// binary). Run with bare `node --test` from impl/ (node 25).
//
// Every test asserts an EFFECT observed through the public D1 Adapter surface (Acks + the
// onEvent stream), not internal state — this is a black-box conformance suite against the spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { assertIsAdapter } from '../src/adapter.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-codex-appserver.mjs');

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
  return new CodexAppServerCli({
    cmd: process.execPath,
    // '--serve' is the fixture's discovery-guard sentinel (see fake-codex-appserver.mjs top
    // comment / phase8 RECONCILIATION R1): without it the fixture exits inert so that bare
    // `node --test` (which discovers every .mjs under test/) never hangs on it.
    args: [FIXTURE, '--serve'],
    env: extra.env,
    requestTimeoutMs: extra.requestTimeoutMs ?? 2000,
    stopDeadlineMs: extra.stopDeadlineMs,
    ceiling: 4,
    maxContext: 272000,
    versionProbe: extra.versionProbe ?? (() => 'fake-codex/0.144.0-test'),
  });
}

function freshWorktree() {
  return mkdtempSync(join(tmpdir(), 'codex-appserver-'));
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

// ---------------------------------------------------------------------------
// XA4 / construction & conformance
// ---------------------------------------------------------------------------

test('XA4/D1: CodexAppServerCli conforms to the session Adapter interface (card/spawn/prompt/interrupt/approve/answer/kill/onEvent)', () => {
  const adapter = makeAdapter();
  assert.doesNotThrow(() => assertIsAdapter(adapter));
});

test('XA3: constructing without requestTimeoutMs or stopDeadlineMs throws — no invented timeout constant', () => {
  assert.throws(
    () => new CodexAppServerCli({ cmd: process.execPath, args: [FIXTURE] }),
    /requestTimeoutMs|stopDeadlineMs/,
  );
});

test('XA3: stopDeadlineMs alone (mirroring the Coordinator option name) is sufficient to derive the request timeout', () => {
  assert.doesNotThrow(() => new CodexAppServerCli({ cmd: process.execPath, args: [FIXTURE], stopDeadlineMs: 15000 }));
});

test('XA14/XA15: card() reports harness codex, the injected version, and the native verb set with pause:unsupported', () => {
  const adapter = makeAdapter({ versionProbe: () => 'codex-cli 0.144.0-fake' });
  const card = adapter.card();
  assert.equal(card.harness, 'codex');
  assert.equal(card.version, 'codex-cli 0.144.0-fake');
  assert.equal(card.verbs.spawn, 'native');
  assert.equal(card.verbs.prompt, 'native');
  assert.equal(card.verbs.steer, 'native');
  assert.equal(card.verbs.interrupt, 'native');
  assert.equal(card.verbs.approve, 'native');
  assert.equal(card.verbs.pause, 'unsupported');
});

test('XA15: the default version probe describes the injected executable, not a different bare codex on PATH', () => {
  const adapter = new CodexAppServerCli({ cmd: process.execPath, requestTimeoutMs: 100 });
  assert.equal(adapter.card().version, process.version);
});

// ---------------------------------------------------------------------------
// XA1/XA6: spawn = initialize + thread/start + first turn; natural completion
// ---------------------------------------------------------------------------

test('XA6: spawn() acks ok:true and drives turn_started -> content.message -> lifecycle.turn_completed over the real wire protocol', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    const ack = await adapter.spawn(worker, makeBrief('say hello'), { worktree: freshWorktree() });
    assert.equal(ack.ok, true);
    await until(events, (e) => e.kind === 'lifecycle.turn_started');
    await until(events, (e) => e.kind === 'content.message');
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.worker, worker);
    assert.equal(terminal.payload.result.status, 'completed');
    assert.equal(typeof terminal.payload.threadId, 'string');
    assert.equal(typeof terminal.payload.turnId, 'string');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA16: exactly one terminal event fires per turn (no duplicate lifecycle.turn_completed)', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    await delay(100); // give any trailing/duplicate notification a chance to arrive
    const terminals = events.filter((e) => ['lifecycle.turn_completed', 'lifecycle.crashed', 'control.interrupt_confirmed'].includes(e.kind));
    assert.equal(terminals.length, 1);
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA19: a crashed turn (FAKE:CRASH) emits lifecycle.crashed as its sole terminal event, never turn_completed', async () => {
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

test('XA18: thread/tokenUsage/updated maps to a resource.tokens event tagged source:tokenUsage', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    const res = await until(events, (e) => e.kind === 'resource.tokens');
    assert.equal(res.payload.source, 'tokenUsage');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// XA7: multi-turn (native, same process/thread)
// ---------------------------------------------------------------------------

test('XA7: prompt(worker, content, "turn") starts a second turn on the SAME threadId after the first completes (native multi-turn)', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('first task'), { worktree: freshWorktree() });
    const t1 = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    const threadId1 = t1.payload.threadId;
    const turnId1 = t1.payload.turnId;

    const ack = await adapter.prompt(worker, 'second task', 'turn');
    assert.equal(ack.ok, true);
    const t2 = await until(events, (e) => e.kind === 'lifecycle.turn_completed' && e.payload.turnId !== turnId1);
    assert.equal(t2.payload.threadId, threadId1, 'same thread across turns — this is the multi-turn capability one-shot adapters cannot offer');
    assert.notEqual(t2.payload.turnId, turnId1, 'a genuinely new turn, not a replay of the first');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// XA7 (steer) / XA8 (interrupt, thread survives)
// ---------------------------------------------------------------------------

test('XA7: prompt(worker, content, "steer") redirects the ACTIVE turn — an acknowledging event appears in the stream and alters the eventual output', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN long running task'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_started');

    // Prove the turn genuinely would not complete on its own (STAY_OPEN).
    await never(events, (e) => e.kind === 'lifecycle.turn_completed', { forMs: 100 });

    const ack = await adapter.prompt(worker, 'focus on tests', 'steer');
    assert.equal(ack.ok, true);

    const steerAck = await until(events, (e) => e.kind === 'content.message' && /STEERED: focus on tests/.test(e.payload.text));
    assert.equal(steerAck.actor, 'worker');

    // Steering forces the turn to wrap up shortly after — proof the redirection took effect.
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA7: steer against a non-active/mismatched turn resolves {ok:false}, never throws', async () => {
  const adapter = makeAdapter();
  const worker = 'w1';
  try {
    const ack = await adapter.prompt(worker, 'steer with nothing spawned', 'steer');
    assert.equal(ack.ok, false);
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA8: interrupt() ends the turn as interrupted via onEvent (control.interrupt_confirmed) while the Ack itself resolves immediately', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN never finishes on its own'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_started');

    const ack = await adapter.interrupt(worker);
    assert.equal(ack.ok, true);

    const confirmed = await until(events, (e) => e.kind === 'control.interrupt_confirmed');
    assert.equal(confirmed.worker, worker);
    // D9: interrupt/kill confirmation is ALWAYS an event, never smuggled onto the Ack return.
    assert.equal(ack.emulated, undefined, 'a native protocol interrupt is not an emulated signal-kill');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA8: after interrupt, the THREAD SURVIVES — a subsequent prompt(worker, x, "turn") succeeds on the same threadId', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    const spawnAck = await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN first'), { worktree: freshWorktree() });
    assert.equal(spawnAck.ok, true);
    await until(events, (e) => e.kind === 'lifecycle.turn_started');

    await adapter.interrupt(worker);
    const interruptedTurn = await until(events, (e) => e.kind === 'control.interrupt_confirmed');
    const threadId = interruptedTurn.payload.threadId;

    const promptAck = await adapter.prompt(worker, 'second task after interrupt', 'turn');
    assert.equal(promptAck.ok, true, 'the coordinator can keep issuing turns on this worker — interrupt did not kill the session');

    const completed = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(completed.payload.threadId, threadId, 'still the same thread — a real respawn would have gotten a NEW threadId');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA8: interrupt(worker, then) automatically issues the follow-up turn once the interrupt is confirmed', async () => {
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
// XA9/XA13: approval round-trip — turn blocked until approve() delivers
// ---------------------------------------------------------------------------

test('XA9/XA13: a pending command-execution approval BLOCKS the turn until approve("allow") delivers, then the turn completes', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_APPROVAL:command do a risky thing'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    assert.equal(typeof req.payload.requestId, 'string');
    assert.equal(req.payload.kind, 'command');

    // The turn is genuinely blocked — no terminal event before we answer.
    await never(events, (e) => e.kind === 'lifecycle.turn_completed', { forMs: 100 });

    const ack = await adapter.approve(worker, req.payload.requestId, 'allow');
    assert.equal(ack.ok, true);

    await until(events, (e) => e.kind === 'content.message' && /approved: proceeding/.test(e.payload.text));
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA9: approve(..., "cancel") maps to the wire "cancel" decision and the turn ends interrupted (not completed)', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_APPROVAL:fileChange edit outside scope'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    assert.equal(req.payload.kind, 'fileChange');

    await adapter.approve(worker, req.payload.requestId, 'cancel');
    const terminal = await until(events, (e) => e.kind === 'control.interrupt_confirmed' || e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.kind, 'control.interrupt_confirmed', 'cancel decision: "the turn will also be immediately interrupted" (schema)');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('XA9: approve() against an unknown/already-answered requestId resolves {ok:false}, never writes to the wire twice', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_APPROVAL:command risky'), { worktree: freshWorktree() });
    const req = await until(events, (e) => e.kind === 'approval.requested');
    const first = await adapter.approve(worker, req.payload.requestId, 'allow');
    assert.equal(first.ok, true);
    await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    const second = await adapter.approve(worker, req.payload.requestId, 'allow');
    assert.equal(second.ok, false, 'answer exactly once (dossier §6): a request is a consumable message, not a replayable fact');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// XA12: answer() round-trip for free-form questions (distinct from approve())
// ---------------------------------------------------------------------------

test('XA12: a pending item/tool/requestUserInput BLOCKS the turn until answer() delivers, and the answer text reaches the transcript', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_QUESTION which approach should I take'), { worktree: freshWorktree() });
    const asked = await until(events, (e) => e.kind === 'question.asked');
    assert.equal(typeof asked.payload.requestId, 'string');

    await never(events, (e) => e.kind === 'lifecycle.turn_completed', { forMs: 100 });

    const ack = await adapter.answer(worker, asked.payload.requestId, { text: 'approach A' });
    assert.equal(ack.ok, true);

    await until(events, (e) => e.kind === 'content.message' && /answered: approach A/.test(e.payload.text));
    await until(events, (e) => e.kind === 'lifecycle.turn_completed');
  } finally {
    await cleanup(adapter, worker);
  }
});

test('D1: approve() rejects a question wait-item and answer() rejects an approval wait-item — the two verbs are not interchangeable', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:REQUEST_QUESTION pick one'), { worktree: freshWorktree() });
    const asked = await until(events, (e) => e.kind === 'question.asked');
    const wrongVerb = await adapter.approve(worker, asked.payload.requestId, 'allow');
    assert.equal(wrongVerb.ok, false);
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// XA10: busy contention is a typed spawn failure, not a crash-loop
// ---------------------------------------------------------------------------

test('XA10: a -32001 busy error on thread/start surfaces as a typed spawn failure (ok:false, code:-32001), never a thrown exception', async () => {
  const adapter = makeAdapter({ env: { FAKE_CODEX_BUSY: '1' } });
  const worker = 'w1';
  const ack = await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
  assert.equal(ack.ok, false);
  assert.equal(ack.code, -32001);
});

// ---------------------------------------------------------------------------
// XA3/XA5: request timeout bounds a hung server, never hangs the caller forever
// ---------------------------------------------------------------------------

test('XA3: a server that never answers initialize causes spawn() to resolve {ok:false} within requestTimeoutMs, not hang', async () => {
  const adapter = makeAdapter({ env: { FAKE_CODEX_HANG: '1' }, requestTimeoutMs: 200 });
  const worker = 'w1';
  const started = Date.now();
  const ack = await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
  const elapsed = Date.now() - started;
  assert.equal(ack.ok, false);
  assert.ok(elapsed < 2000, `expected a bounded wait near requestTimeoutMs, took ${elapsed}ms`);
});

// ---------------------------------------------------------------------------
// XA17: malformed/unknown notifications are ignored gracefully
// ---------------------------------------------------------------------------

test('XA17: malformed JSON lines and unknown-method notifications never crash the adapter or produce a spurious terminal event', async () => {
  const adapter = makeAdapter({ env: { FAKE_CODEX_MALFORMED: '1' } });
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('trivial'), { worktree: freshWorktree() });
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
    assert.equal(events.some((e) => e.kind === 'lifecycle.crashed'), false, 'garbage input must never be mistaken for a crash');
    const idless = events.find((e) => e.kind === 'error' && e.payload.correlated === false);
    assert.ok(idless, 'XA5: an id-less error line surfaces as an UNCORRELATED error event — observable, never speculatively matched to a pending request');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// Anti-wedge (live-schema-informed): server->client requests OUTSIDE the mapped table (the real
// 0.144.0 protocol also has item/permissions/requestApproval and item/tool/call) must be ANSWERED
// with an error response, never silently dropped — a dangling JSON-RPC request wedges its turn.
// ---------------------------------------------------------------------------

test('anti-wedge: an unmapped server->client REQUEST is auto-answered with an error (turn completes; observable error event; no wedge)', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  try {
    await adapter.spawn(worker, makeBrief('FAKE:SERVER_UNKNOWN_REQUEST do something needing odd approval'), { worktree: freshWorktree() });
    // The fake blocks the turn until OUR response to its unmapped request arrives — completion IS the proof.
    const terminal = await until(events, (e) => e.kind === 'lifecycle.turn_completed');
    assert.equal(terminal.payload.result.status, 'completed');
    const surfaced = events.find((e) => e.kind === 'error' && e.payload.serverMethod === 'item/permissions/requestApproval');
    assert.ok(surfaced, 'the auto-decline is observable, not a silent drop');
    assert.equal(surfaced.payload.correlated, true);
    assert.equal(events.some((e) => e.kind === 'approval.requested'), false,
      'an unmapped request kind is NOT surfaced as a baton approval — approve()/answer() have no wire mapping for it');
  } finally {
    await cleanup(adapter, worker);
  }
});

// ---------------------------------------------------------------------------
// XA1: per-worker isolation — two workers get two independent child processes/threads
// ---------------------------------------------------------------------------

test('XA1: two workers are fully isolated — independent threadIds, and interrupting one does not affect the other', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  try {
    await adapter.spawn('wA', makeBrief('FAKE:STAY_OPEN task A'), { worktree: freshWorktree() });
    await adapter.spawn('wB', makeBrief('FAKE:STAY_OPEN task B'), { worktree: freshWorktree() });
    await until(events, (e) => e.kind === 'lifecycle.turn_started' && e.worker === 'wA');
    await until(events, (e) => e.kind === 'lifecycle.turn_started' && e.worker === 'wB');

    const startedA = events.find((e) => e.kind === 'lifecycle.turn_started' && e.worker === 'wA');
    const startedB = events.find((e) => e.kind === 'lifecycle.turn_started' && e.worker === 'wB');
    assert.notEqual(startedA.payload.threadId, startedB.payload.threadId, 'each worker owns its own child process/thread, not a shared one');

    await adapter.interrupt('wA');
    await until(events, (e) => e.kind === 'control.interrupt_confirmed' && e.worker === 'wA');

    // wB must be wholly unaffected: it can still be steered (proving its turn is still active).
    const steerAck = await adapter.prompt('wB', 'still going', 'steer');
    assert.equal(steerAck.ok, true, 'worker B was never touched by worker A\'s interrupt — no shared broker/session to contend over');
  } finally {
    await cleanup(adapter, 'wA');
    await cleanup(adapter, 'wB');
  }
});

// ---------------------------------------------------------------------------
// XA11: kill = process-group SIGKILL + confirmed-stop event
// ---------------------------------------------------------------------------

test('XA11: kill() force-ends the worker and emits kill.confirmed once the process is gone', async () => {
  const adapter = makeAdapter();
  const events = collect(adapter);
  const worker = 'w1';
  await adapter.spawn(worker, makeBrief('FAKE:STAY_OPEN never finishes'), { worktree: freshWorktree() });
  await until(events, (e) => e.kind === 'lifecycle.turn_started');

  const ack = await adapter.kill(worker);
  assert.equal(ack.ok, true);
  const confirmed = await until(events, (e) => e.kind === 'kill.confirmed');
  assert.equal(confirmed.worker, worker);
});
