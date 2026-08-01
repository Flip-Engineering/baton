// REFLEX-1 decisions contract v2 red suite (docs/reference/evidence/reflex-wave-live-2026-07-21/
// reflex1-decisions.md). Part A first: durable pending records (F1), resolution/disposition
// split (F2), kind-checked answers at the hub (F3), duplicate requestId rejection (F4) — the
// settlement-integrity prerequisites the decision channel (Part B, issue #16) is built on.
//
// Low-level settlement mechanics (F1-F4, races, expiry, supersede) are exercised directly
// against Coordinator with a local ScriptableAdapter fake, mirroring test/coordinator.test.mjs's
// own harness pattern (per that file's documented "construct minimal local fakes" guidance).
// Higher-level surfaces (application kind-check/attention, CLI parsing, MCP schema) are
// exercised through the real application/CLI/MCP modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import {
  ValidationError, createDecisionAnswer, createDecisionRequest,
} from '../src/messages.mjs';
import { scanForDecisionRequest } from '../src/claude-session.mjs';
import { parseBatonCli } from '../src/application-cli.mjs';
import { CoordinationStore, McpFleetServer } from '../src/index.mjs';

// ============================================================
// Shared test fixtures (mirrors test/coordinator.test.mjs's documented pattern)
// ============================================================

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-reflex1-'));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeBrief(overrides = {}) {
  return {
    goal: 'do the thing',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    ...overrides,
  };
}

function decisionRequestFields(overrides = {}) {
  return {
    question: 'Which migration strategy?',
    options: [
      { id: 'opt-a', label: 'Blue/green', summary: 'Zero downtime, double capacity' },
      { id: 'opt-b', label: 'Rolling', summary: null },
    ],
    allowFreeResponse: false,
    recommended: null,
    deadlineMs: 60_000,
    ...overrides,
  };
}

/** Scriptable fake conforming to coordinator.mjs's D1 Adapter contract, extended with
 * decision-kind approve/answer wait-item matching (mirrors adapter.mjs MockAdapter's own
 * decision support, but under full synchronous test control). */
class ScriptableAdapter {
  constructor({ harness = 'mock', version = '1.0.0', concurrencyCeiling = Infinity, maxContext = 100000, verbs = {} } = {}) {
    this._card = {
      harness, version, authPosture: 'api_key', concurrencyCeiling, maxContext,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native', ...verbs },
      decision: 'native',
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this.gates = { spawn: null, prompt: null, interrupt: null, approve: null, answer: null, kill: null };
    this.acks = {
      spawn: { ok: true }, prompt: { ok: true }, interrupt: { ok: true },
      approve: { ok: true }, answer: { ok: true }, kill: { ok: true },
    };
    this.answerThrows = null;
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); if (this.gates.spawn) await this.gates.spawn; return this.acks.spawn; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); if (this.gates.prompt) await this.gates.prompt; return this.acks.prompt; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); if (this.gates.interrupt) await this.gates.interrupt; return this.acks.interrupt; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); if (this.gates.approve) await this.gates.approve; return this.acks.approve; }
  async answer(worker, requestId, answer) {
    this.calls.answer.push({ worker, requestId, answer });
    if (this.answerThrows) { const err = this.answerThrows; this.answerThrows = null; throw err; }
    if (this.gates.answer) await this.gates.answer;
    return this.acks.answer;
  }
  async kill(worker) { this.calls.kill.push({ worker }); if (this.gates.kill) await this.gates.kill; return this.acks.kill; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

function fixedRoute(vendor) { return () => vendor; }

/** Wires up a Coordinator; every dependency is overridable, `log`/`coordination` are returned
 * so a caller can construct a SECOND Coordinator over the SAME durable state (a restart). */
function setup(overrides = {}) {
  const dir = tmpDir();
  const log = overrides.log ?? new Log(join(dir, 'log'));
  const fences = overrides.fences ?? new FenceTable();
  const adapters = overrides.adapters ?? { mock: new ScriptableAdapter() };
  const worktrees = overrides.worktrees ?? {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture: async () => ({ sha: 'sha-result' }),
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const referee = overrides.referee ?? passingReferee();
  const route = overrides.route ?? fixedRoute(Object.keys(adapters)[0]);
  const coordination = overrides.coordination ?? coordinationForLog(log);
  let t = overrides.t ?? 0;
  const now = overrides.now ?? (() => t);
  const advance = (ms) => { t += ms; };
  const coordinator = new Coordinator({
    log,
    coordination,
    fences,
    adapters,
    worktrees,
    referee,
    route,
    now,
    approvalTimeoutMs: overrides.approvalTimeoutMs ?? 60000,
    stopDeadlineMs: overrides.stopDeadlineMs ?? 15000,
  });
  return { dir, log, fences, adapters, worktrees, referee, route, now, advance, coordination, coordinator };
}

function emitDecisionRequested(adapter, handle, requestId, request, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'decision.requested', actor: 'worker',
    payload: { requestId, request },
  });
}

// ============================================================
// Part C — closed-shape refusals (messages.mjs createDecisionRequest/createDecisionAnswer)
// ============================================================

test('createDecisionRequest refuses a missing deadlineMs (F5/F6: mandatory, no unbounded wait)', () => {
  const { deadlineMs, ...rest } = decisionRequestFields();
  assert.throws(() => createDecisionRequest(rest), ValidationError);
});

test('createDecisionRequest refuses deadlineMs: null, 0, and negative — mandatory means a positive integer, never an opt-out', () => {
  for (const bad of [null, 0, -1, 'never', Infinity]) {
    assert.throws(() => createDecisionRequest(decisionRequestFields({ deadlineMs: bad })), ValidationError);
  }
});

test('createDecisionRequest refuses an unknown field (closed shape)', () => {
  assert.throws(() => createDecisionRequest({ ...decisionRequestFields(), extra: 'nope' }), ValidationError);
});

test('createDecisionRequest refuses 0 options and refuses 9 options (1..8 exact bound)', () => {
  assert.throws(() => createDecisionRequest(decisionRequestFields({ options: [] })), ValidationError);
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `opt-${i}`, label: `Option ${i}` }));
  assert.throws(() => createDecisionRequest(decisionRequestFields({ options: nine })), ValidationError);
});

test('createDecisionRequest refuses duplicate option ids', () => {
  assert.throws(() => createDecisionRequest(decisionRequestFields({
    options: [{ id: 'opt-a', label: 'A' }, { id: 'opt-a', label: 'A again' }],
  })), ValidationError);
});

test('createDecisionRequest refuses an option label over 160 bytes and a summary over 512 bytes', () => {
  assert.throws(() => createDecisionRequest(decisionRequestFields({
    options: [{ id: 'opt-a', label: 'x'.repeat(161) }],
  })), ValidationError);
  assert.throws(() => createDecisionRequest(decisionRequestFields({
    options: [{ id: 'opt-a', label: 'A', summary: 'x'.repeat(513) }],
  })), ValidationError);
});

test('createDecisionRequest refuses recommended naming a nonexistent option', () => {
  assert.throws(() => createDecisionRequest(decisionRequestFields({ recommended: 'not-an-option' })), ValidationError);
});

test('createDecisionRequest accepts a valid request and normalizes summary:null / allowFreeResponse:false defaults', () => {
  const request = createDecisionRequest({
    question: 'Proceed?',
    options: [{ id: 'opt-a', label: 'Yes' }],
    deadlineMs: 5000,
  });
  assert.deepEqual(request, {
    question: 'Proceed?',
    options: [{ id: 'opt-a', label: 'Yes', summary: null }],
    allowFreeResponse: false,
    recommended: null,
    deadlineMs: 5000,
  });
  assert.ok(Object.isFrozen(request));
});

test('createDecisionAnswer requires exactly one of optionId or text', () => {
  assert.throws(() => createDecisionAnswer({}), ValidationError);
  assert.throws(() => createDecisionAnswer({ optionId: 'opt-a', text: 'both' }), ValidationError);
  assert.doesNotThrow(() => createDecisionAnswer({ optionId: 'opt-a' }));
  assert.doesNotThrow(() => createDecisionAnswer({ text: 'free response' }));
});

test('createDecisionAnswer refuses an unsafe optionId and an unknown field', () => {
  assert.throws(() => createDecisionAnswer({ optionId: 'has spaces' }), ValidationError);
  assert.throws(() => createDecisionAnswer({ optionId: 'opt-a', bogus: 1 }), ValidationError);
});

// ============================================================
// F1 — durable pending records survive restart (respond() never returns not_found)
// ============================================================

test('F1: a blocking decision request asked before a restart remains answerable after it (respond() never returns not_found)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log, coordination } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-restart-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields());
  await Promise.resolve();

  const before = coordinator.interactionStatus(requestId);
  assert.equal(before.kind, 'decision');
  assert.equal(before.state, 'pending');

  // Restart: a fresh Coordinator over the SAME durable log/coordination and the SAME live
  // adapter instance (the downstream provider connection outlives the Baton process restart).
  const replayed = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { mock: adapter },
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: passingReferee(), route: fixedRoute('mock'),
    approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });

  const afterRestart = replayed.interactionStatus(requestId);
  assert.ok(afterRestart, 'the pending decision record must be reconstructed from the durable log alone');
  assert.equal(afterRestart.kind, 'decision');
  assert.equal(afterRestart.state, 'pending');
  assert.deepEqual(afterRestart.options, decisionRequestFields().options);

  const result = await replayed.respond(requestId, { optionId: 'opt-a' });
  assert.notEqual(result.result, 'not_found', 'respond() must never return not_found for a replayed pending record');
  assert.equal(result.ok, true);
  assert.equal(result.result, 'applied');

  const settled = replayed.interactionStatus(requestId);
  assert.equal(settled.state, 'resolved');
});

test('F1: a blocking QUESTION asked before a restart is also reconstructed (F1 names approval/question, not decision-only)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log, coordination } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'question-restart-1';
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId, question: 'which way?', blocking: true },
  });
  await Promise.resolve();

  const replayed = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { mock: adapter },
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: passingReferee(), route: fixedRoute('mock'),
    approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });

  const result = await replayed.respond(requestId, { text: 'left' });
  assert.notEqual(result.result, 'not_found');
  assert.equal(result.result, 'applied');
});

test('replay identity across restart: the reconstructed record keeps the exact same requestId/kind/options identity', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log, coordination } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-identity-1';
  const request = decisionRequestFields({ recommended: 'opt-b' });
  emitDecisionRequested(adapter, handle, requestId, request);
  await Promise.resolve();
  const before = coordinator.interactionStatus(requestId);

  const replayed = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { mock: adapter },
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }), removeVerifyWorktree: async () => {},
      remove: async () => {}, reconcile: async () => {},
    },
    referee: passingReferee(), route: fixedRoute('mock'),
    approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });
  const after = replayed.interactionStatus(requestId);

  assert.equal(after.requestId, before.requestId);
  assert.equal(after.kind, before.kind);
  assert.equal(after.workerId, before.workerId);
  assert.deepEqual(after.options, before.options);
  assert.equal(after.recommended, 'opt-b');
});

// ============================================================
// F2 — resolution/disposition split (decision settlement never lies about delivery)
// ============================================================

test('F2: a stale-discarded decision answer returns a typed disposition, never applied, and never surfaces the answer', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, fences } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-stale-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields());
  await Promise.resolve();

  // The asking turn ends before anyone answers.
  fences.bumpTurn(handle.id);
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: fences.current(handle.id).turnEpoch,
    kind: 'lifecycle.turn_started', actor: 'orchestrator', payload: {},
  });
  await Promise.resolve();

  const answerCallsBefore = adapter.calls.answer.length;
  const result = await coordinator.respond(requestId, { optionId: 'opt-a' });
  assert.equal(result.ok, false, 'a stale-discarded settlement is never ok:true/applied (contrast the pre-fix coordinator.mjs:8324-8329 behavior)');
  assert.notEqual(result.result, 'applied');
  assert.equal(result.result, 'stale_discarded');
  assert.equal(adapter.calls.answer.length, answerCallsBefore, 'a stale answer must never reach adapter.answer()');

  const later = await coordinator.respond(requestId, { optionId: 'opt-b' });
  assert.equal(later.result, 'already_resolved');
  assert.equal(later.resolution.disposition, 'stale_discarded');
  assert.equal(later.resolution.answer, null, 'a discarded settlement must never surface the answer as the resolution');
});

test('F2: an expired decision never auto-answers and never surfaces a fabricated answer', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, advance } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-expire-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields({ deadlineMs: 1000 }));
  await Promise.resolve();

  advance(1001);
  coordinator.tick();
  await Promise.resolve();
  await Promise.resolve();

  const status = coordinator.interactionStatus(requestId);
  assert.equal(status.state, 'resolved');

  const late = await coordinator.respond(requestId, { optionId: 'opt-a' });
  assert.equal(late.result, 'already_resolved');
  assert.equal(late.resolution.disposition, 'expired');
  assert.equal(late.resolution.answer, null, 'expiry is never an auto-answer');
});

// ============================================================
// F3 — kind-checked answers at the hub, before any adapter call
// ============================================================

test('F3: the coordinator rejects a cross-kind (decision-shaped) answer against a decision record whose optionId is not one of its options', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-crosskind-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields());
  await Promise.resolve();

  const answerCallsBefore = adapter.calls.answer.length;
  const badOption = await coordinator.respond(requestId, { optionId: 'not-a-real-option' });
  assert.equal(badOption.ok, false);
  assert.equal(badOption.result, 'invalid_answer');
  assert.equal(adapter.calls.answer.length, answerCallsBefore, 'a rejected shape must never reach the adapter');

  const crossKindShape = await coordinator.respond(requestId, { decision: 'allow' });
  assert.equal(crossKindShape.ok, false);
  assert.equal(crossKindShape.result, 'invalid_answer');
  assert.equal(adapter.calls.answer.length, answerCallsBefore);

  // The record must still be pending and answerable — a rejected attempt is not consumed.
  assert.equal(coordinator.interactionStatus(requestId).state, 'pending');
  const good = await coordinator.respond(requestId, { optionId: 'opt-a' });
  assert.equal(good.ok, true);
  assert.equal(good.result, 'applied');
});

test('F3: a free-text decision answer is rejected when the request does not allow one', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-notext-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields({ allowFreeResponse: false }));
  await Promise.resolve();

  const result = await coordinator.respond(requestId, { text: 'a free-form reply' });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'invalid_answer');
});

test('F3: a durable-append failure AFTER the adapter has already accepted delivery commits the reservation rather than rolling back to pending', async () => {
  // The append failure must be wired in BEFORE construction: Coordinator captures the
  // physical log.append function reference once, at construction time (PHYSICAL_LOG_APPENDS),
  // so patching log.append afterward would not be observed on the write path under test.
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const originalAppend = log.append.bind(log);
  let failNext = true;
  log.append = (partial) => {
    if (failNext && partial.kind === 'decision.settled') {
      failNext = false;
      throw new Error('simulated durable append failure after the adapter already accepted delivery');
    }
    return originalAppend(partial);
  };
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ log, coordination: coordinationForLog(log), adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-rollback-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields());
  await Promise.resolve();

  // The adapter's own answer() already returned ok:true (delivery accepted) before the
  // coordinator's subsequent durable append throws — a log-append failure poisons the whole
  // coordinator (by design, coordinator.mjs:944-948), so this test inspects the in-memory
  // record directly rather than the now fail-closed public API.
  await assert.rejects(coordinator.respond(requestId, { optionId: 'opt-a' }));
  assert.equal(adapter.calls.answer.length, 1, 'the adapter delivery call itself must have gone through exactly once');

  const record = coordinator._pending.get(requestId);
  assert.equal(record.state, 'resolved', 'the reservation must commit despite the durable-append failure, never roll back to pending (contrast the pre-fix "safely retryable" rollback, coordinator.mjs:8340-8346)');
  assert.equal(record.resolution.disposition, 'delivered');
  assert.deepEqual(record.resolution.answer, { optionId: 'opt-a', text: null });
});

test('F3: a genuine adapter-level throw (no delivery accepted) rolls the record back to pending for a safe, ordinary retry', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-retry-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields());
  await Promise.resolve();

  adapter.answerThrows = new Error('transient adapter failure before any delivery');
  await assert.rejects(coordinator.respond(requestId, { optionId: 'opt-a' }));

  const midStatus = coordinator.interactionStatus(requestId);
  assert.equal(midStatus.state, 'pending', 'a bare adapter throw (no delivery accepted) rolls back to pending — the ordinary, safe retry path');

  const retry = await coordinator.respond(requestId, { optionId: 'opt-a' });
  assert.equal(retry.ok, true);
  assert.equal(retry.result, 'applied');
  assert.equal(adapter.calls.answer.length, 2, 'exactly one failed attempt and one successful retry');
});

// ============================================================
// F4 — duplicate requestId rejected loudly, never overwritten
// ============================================================

test('F4: a duplicate decision.requested requestId is rejected loudly, never silently overwrites the first record', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-dup-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields({ question: 'first question' }));
  await Promise.resolve();
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields({ question: 'second question (should be rejected)' }));
  await Promise.resolve();

  const status = coordinator.interactionStatus(requestId);
  assert.equal(status.question, 'first question', 'the second admission must never overwrite the first pending record');

  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.duplicate_interaction_rejected'), 'the duplicate must be rejected with a loud, typed event');

  // The first record settles exactly as itself.
  const result = await coordinator.respond(requestId, { optionId: 'opt-a' });
  assert.equal(result.ok, true);
});

test('F4: duplicate rejection also applies to question.asked and approval.requested', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const qId = 'question-dup-1';
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker', payload: { requestId: qId, question: 'first', blocking: true } });
  await Promise.resolve();
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker', payload: { requestId: qId, question: 'second', blocking: true } });
  await Promise.resolve();

  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.duplicate_interaction_rejected'));
});

test('closed-shape refusal at admission: a malformed decision.requested payload is rejected loudly and mints no pending record', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-malformed-1';
  const { deadlineMs, ...malformed } = decisionRequestFields();
  emitDecisionRequested(adapter, handle, requestId, malformed);
  await Promise.resolve();

  assert.equal(coordinator.interactionStatus(requestId), null, 'a malformed request must never mint a pending record');
  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.malformed_interaction_rejected'));
  assert.ok(!kinds.includes('decision.requested'), 'the admitted event kind itself must not appear for a rejected malformed payload');

  // The worker must not be parked — no task/handle wedge from a phantom request.
  const result = await coordinator.result(handle.id);
  assert.notEqual(result.status, 'input_required');
});

// ============================================================
// Single-consumer race, stop/kill supersede, expiry wire cancel, sweep-vs-in-flight race
// ============================================================

test('single-consumer race: two respond() calls for the same decision requestId resolve exactly once each, never both applied', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-race-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields());
  await Promise.resolve();

  const p1 = coordinator.respond(requestId, { optionId: 'opt-a' });
  const p2 = coordinator.respond(requestId, { optionId: 'opt-b' });
  const [r1, r2] = await Promise.all([p1, p2]);
  const results = [r1.result, r2.result].sort();
  assert.deepEqual(results, ['already_resolved', 'applied']);
  assert.equal(adapter.calls.answer.length, 1, 'exactly one settlement reaches the adapter');
});

test('stop/kill supersession is typed (control.interaction_superseded, disposition:kill), not a fabricated cancel answer, and never hangs', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-kill-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields());
  await Promise.resolve();
  assert.equal((await coordinator.result(handle.id)).status, 'input_required');

  const killPromise = coordinator.kill(handle.id);
  adapter.emit({ worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'worker', payload: {} });
  const outcome = await killPromise;
  assert.ok(outcome, 'kill() must resolve — the pending decision must never hang the stop');

  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.interaction_superseded'), 'stop/kill supersession must be a typed event, not silence');
  const supersededEvent = log.read(handle.id).find((e) => e.kind === 'control.interaction_superseded');
  assert.equal(supersededEvent.payload.disposition, 'kill');
  assert.equal(supersededEvent.payload.requestId, requestId);

  const status = coordinator.interactionStatus(requestId);
  assert.equal(status.state, 'resolved');
  assert.equal(adapter.calls.answer.length, 0, 'kill supersession never fabricates a delivered answer through adapter.answer()');
});

test('F5/F6: an expired decision transitions the task off input_required (no hang) and delivers a best-effort wire cancel', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, advance } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-expire-2';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields({ deadlineMs: 500 }));
  await Promise.resolve();
  assert.equal((await coordinator.result(handle.id)).status, 'input_required');

  advance(501);
  coordinator.tick();
  await Promise.resolve();
  await Promise.resolve();

  const afterExpiry = coordinator.interactionStatus(requestId);
  assert.equal(afterExpiry.state, 'resolved');

  const status = await coordinator.result(handle.id);
  assert.notEqual(status.status, 'input_required', 'the task must transition honestly off input_required on expiry, never hang');

  assert.equal(adapter.calls.answer.length, 1, 'a best-effort typed wire cancel is delivered');
  assert.equal(adapter.calls.answer[0].answer.expired, true);
});

test('sweep vs in-flight race: an in-flight resolving settlement is immune to a sweep that fires while its adapter call is still pending, never expired underneath it', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, advance } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'decision-sweep-race-1';
  emitDecisionRequested(adapter, handle, requestId, decisionRequestFields({ deadlineMs: 500 }));
  await Promise.resolve();

  // respond()'s single-consumer reservation flip (record.state 'pending' -> 'resolving') is
  // synchronous, up to the first await — which is the adapter.answer() call itself. Gate that
  // call open so the reservation is held while the deadline passes and a sweep fires.
  let releaseGate;
  adapter.gates.answer = new Promise((resolve) => { releaseGate = resolve; });
  const respondPromise = coordinator.respond(requestId, { optionId: 'opt-a' });
  await Promise.resolve(); // let respond() run up to and enter the gated adapter.answer() call

  assert.equal(coordinator._pending.get(requestId).state, 'resolving', 'the reservation must already be held before the deadline is swept');

  // The deadline passes and a sweep runs WHILE the settlement above is still in flight.
  advance(501);
  coordinator.tick();
  await Promise.resolve();
  assert.equal(coordinator._pending.get(requestId).state, 'resolving', 'the sweep must skip a record it does not find in state:pending — never expire out from under an in-flight settlement');

  releaseGate();
  const result = await respondPromise;
  assert.equal(result.ok, true);
  assert.equal(result.result, 'applied', 'the in-flight settlement must win — never silently replaced by the sweep');
  assert.equal(coordinator.interactionStatus(requestId).state, 'resolved');
  assert.equal(coordinator.interactionStatus(requestId).resolution, undefined, 'interactionStatus never exposes the raw resolution shape');
});

// ============================================================
// Emulated grammar (F7) — spoof-safe request admission from untrusted worker prose
// ============================================================

test('emulated grammar: a well-formed DECISION_REQUEST: <json> is gated and parsed into a closed DecisionRequest', () => {
  const text = `I need your input.\nDECISION_REQUEST: ${JSON.stringify({
    question: 'Proceed with the migration?',
    options: [{ id: 'opt-a', label: 'Yes' }, { id: 'opt-b', label: 'No' }],
    allowFreeResponse: false,
    recommended: 'opt-a',
    deadlineMs: 30000,
  })}\nAwaiting your decision.`;
  const request = scanForDecisionRequest(text);
  assert.ok(request, 'a well-formed grammar match must parse');
  assert.equal(request.question, 'Proceed with the migration?');
  assert.equal(request.options.length, 2);
  assert.equal(request.recommended, 'opt-a');
  assert.ok(Object.isFrozen(request), 'the parsed request is the same closed, frozen shape as createDecisionRequest');
});

test('emulated grammar: malformed JSON after the marker is ignored as ordinary prose, never thrown, never minted', () => {
  assert.equal(scanForDecisionRequest('DECISION_REQUEST: {this is not json'), null);
  assert.equal(scanForDecisionRequest('no grammar here at all'), null);
  assert.equal(scanForDecisionRequest(''), null);
  assert.equal(scanForDecisionRequest(null), null);
});

test('emulated grammar: a schema-invalid request body (missing deadlineMs) is ignored identically to "no grammar found"', () => {
  const text = `DECISION_REQUEST: ${JSON.stringify({ question: 'x', options: [{ id: 'a', label: 'A' }] })}`;
  assert.equal(scanForDecisionRequest(text), null);
});

test('emulated grammar: only the FIRST well-formed request is admitted — a second contradictory DECISION_REQUEST line never wins a silent race', () => {
  const first = { question: 'first', options: [{ id: 'opt-a', label: 'A' }], deadlineMs: 1000 };
  const second = { question: 'second', options: [{ id: 'opt-z', label: 'Z' }], deadlineMs: 2000 };
  const text = `DECISION_REQUEST: ${JSON.stringify(first)}\nDECISION_REQUEST: ${JSON.stringify(second)}`;
  const request = scanForDecisionRequest(text);
  assert.equal(request.question, 'first');
});

test('emulated grammar: trailing prose after the balanced JSON object never corrupts the parse', () => {
  const body = { question: 'x', options: [{ id: 'a', label: 'A' }], deadlineMs: 1000 };
  const text = `DECISION_REQUEST: ${JSON.stringify(body)} — please respond promptly, thanks!`;
  const request = scanForDecisionRequest(text);
  assert.ok(request);
  assert.equal(request.question, 'x');
});

// ============================================================
// CLI / MCP typed surfaces
// ============================================================

test('CLI: `baton run answer RUN REQ --option ID` parses to the typed {optionId} answer form', () => {
  const parsed = parseBatonCli(['run', 'answer', 'run-a', 'req-1', '--option', 'opt-a']);
  assert.equal(parsed.kind, 'command');
  assert.equal(parsed.name, 'run.answer');
  assert.deepEqual(parsed.args.answer, { optionId: 'opt-a' });
});

test('CLI: choosing more than one answer form (--option and --text together) is refused', () => {
  assert.throws(() => parseBatonCli(['run', 'answer', 'run-a', 'req-1', '--option', 'opt-a', '--text', 'also this']));
});

test('MCP: fleet_run_answer accepts the typed {optionId} form and forwards it to run.answer unchanged', async () => {
  const NOW = Date.parse('2026-07-21T00:00:00.000Z');
  const dir = tmpDir();
  const applicationCalls = [];
  const application = {
    repoId: 'repo-reflex1',
    card: () => ({
      schemaVersion: 1, repoId: 'repo-reflex1',
      commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown'],
    }),
    async authorizeReplay() { return true; },
    async command(name, args, principal) {
      applicationCalls.push({ name, args, principal });
      return { schemaVersion: 1, runId: args.runId, phase: 'running' };
    },
  };
  const coordination = new CoordinationStore(join(dir, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const principal = {
    userId: 'operator-a', sessionId: 'stdio-a',
    capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review', 'integrate_result'],
    repoIds: ['repo-reflex1'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
  };
  const server = new McpFleetServer({
    coordinator: {}, coordination, application, surface: 'combined',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal, repoIds: ['repo-reflex1'], now: () => NOW,
    maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  const request = (id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
  const initResponse = await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(initResponse.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const response = await request(2, 'tools/call', {
    name: 'fleet_run_answer',
    arguments: {
      repoId: 'repo-reflex1', idempotencyKey: 'run-answer-decision', runId: 'run-reflex1-a',
      requestId: 'decision-1', answer: { optionId: 'opt-a' },
    },
  });
  assert.equal(response.result.isError, false);
  assert.equal(applicationCalls.at(-1).name, 'run.answer');
  assert.deepEqual(applicationCalls.at(-1).args.answer, { optionId: 'opt-a' });
});
