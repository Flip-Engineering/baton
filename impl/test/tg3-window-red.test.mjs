// Issue #80 TG3-window suite, REVISED 2026-09-12 — the autonomous-orchestrator ownership rule.
//
// WHAT THIS FILE USED TO PIN (now retired, with the reason). The v1.2 contract made the
// un-driven pause self-driving: `_admitPauseRecord` armed ONE bounded policy steering cycle —
// a provenance-marked progress nudge ("baton-progress-check: …"), an armed window, an answer
// set (`turn_started`, provider calls, distinct scratchpad/capability digests, resolved
// interactions), and an expiry that ran the full final evaluation when nothing answered.
//
// Live counter-example (native-completion-loop, a real native Claude self-build): a worker
// completed its change with a `pausable` card; the arm-time nudge BEGAN the next turn for the
// atomic pipe; that `turn_started` answered the cycle; the completed turn then armed another
// cycle. The policy renewed its own work for 570 provider turns while the model kept reporting
// "Complete, no remaining work" — the window could never expire because the policy's own prompt
// always answered it first, so no verdict ever landed. Any correction that keeps the coordinator
// prompt-driven also keeps mixing two authorities ("the worker is alive" vs "the work is done")
// inside a timer, and cannot be made honest by better evidence classes, bigger windows, or
// period heuristics.
//
// THE REVISED RULE. The pause seam has exactly ONE disposition: park. `_admitPauseRecord` mints
// the durable `turn.paused` record, projects it on `pausedTurns()`, and returns — no policy
// nudge, no window, no expiry verdict, no gate dispatch. A paused task is decided ONLY by an
// explicit caller act:
//   * `claim_turn` — runs the existing trust gate / verifier against a fresh capture (the
//     autonomous orchestrator's completion claim; no steering receipt, no expiry receipt);
//   * `nudge_turn` — a real fresh turn on the SAME task (a continuation, not a checkpoint
//     verdict);
//   * `wait_turn` — a receipt that leaves the record claimable.
// Driven and un-driven runs are therefore identical, and the coordinator never invents
// completion authority: native turn completion alone mints no claim, and no clock, count, or
// prose ever decides a paused task.
//
// Rows below pin the revised contract. The retired mechanics are asserted ABSENT by name so the
// self-driving cycle cannot quietly return. `REARM_KINDS` (the #67 stall-watchdog fold) and the
// stall seam's own window knob survive untouched — they are a different, evidence-gated surface.
//
// Harness: mock adapter (a `pausable` card that accepts prompts but begins no turns), fake
// worktrees, real timers over the 25ms `progressNudgeWindowMs` knob (asserted inert for the
// pause seam), hermetic tmp dirs, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import * as coordinatorNs from '../src/coordinator.mjs';

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-tw-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// A valid terminal usage seal for the governed deployment — the MockAdapter governance card
// declares usage native, so every turn_completed must carry a seal whose tokens/usd are
// 'unavailable' (nothing reported, no counter). Without providerGovernance the seal is ignored.
const UNAVAILABLE_USAGE_SEAL = Object.freeze({
  counterId: null, tokenMetric: null, tokens: 'unavailable', usd: 'unavailable',
});

// The #67 v1.1 closed re-arm set (stall-watchdog-contract.md §B1) — the frozen ACTUAL-sorted
// literal. #67 folded, so this is now SHIPPED and consumed by the stall seam (`_armStallCycle` /
// `_observeStallSeam`); the retired pause cycle must not have re-used or grown it.
const REARM_KINDS_SORTED = Object.freeze([
  'approval.resolved', 'decision.settled', 'lifecycle.turn_started', 'question.answered',
]);

function makeBrief(overrides = {}) {
  return {
    goal: 'produce an in-scope diff after legitimate multi-turn work',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: ['repository_edit'],
    ...overrides,
  };
}

// The governed ScriptableAdapter — the `pausable` card plus the modelSelection and governance
// sub-cards every real adapter carries. `prompt` records the call and begins NO turn (the
// buffering shape), so "no automatic prompt" is directly observable. `kill` confirms the
// two-phase stop the way a real adapter does.
class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'default', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], configuredEffort: 'low', serviceTier: null,
      },
      governance: {
        usage: { tokens: 'native', usd: 'native', tokenMetric: 'mock-token', terminalSeal: 'native' },
        providerCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        toolCalls: { observation: 'unavailable', enforcement: 'unavailable' },
        maxWireFrameBytes: 1024 * 1024,
      },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) {
    this.calls.approve.push({ worker, requestId, decision, payload });
    return { ok: true };
  }
  async answer(worker, requestId, answer) {
    this.calls.answer.push({ worker, requestId, answer });
    return { ok: true };
  }
  async kill(worker) {
    this.calls.kill.push({ worker });
    queueMicrotask(() => this.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'kill.confirmed', actor: 'policy', payload: {},
    }));
    return { ok: true, terminal: true };
  }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

// The observe-mode providerGovernance deployment profile — mode 'observe' so provider calls are
// validity-tracked without strict binding, exactly as the real deployment runs.
const OBSERVE_POLICY = {
  schemaVersion: 1,
  maxWireFrameBytes: 4 * 1024 * 1024,
  maxProviderCallsPerTurn: 1000,
  maxToolCallsPerTurn: 1000,
  routes: [{
    harness: 'mock', model: 'mock-model', effort: 'low',
    terminalReserve: { tokens: 0, usd: 0 }, mode: 'observe',
  }],
};

function setup({ capture, adapter, governed = true, coordinatorOpts = {} }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const coordination = coordinationForLog(log);
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log,
    coordination,
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25, // the knob the pause seam must NOT use
    providerGovernance: governed ? OBSERVE_POLICY : undefined,
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees };
}

async function flush(times = 40) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });
const withDiff = async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['in-scope.txt'] });

function emitTurnCompleted(adapter, handle, turnEpoch = 1, output = 'mid-workflow checkpoint') {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output, usageSeal: UNAVAILABLE_USAGE_SEAL },
  });
}

function emitTurnStarted(adapter, handle, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_started', actor: 'worker',
    payload: {},
  });
}

function emitProviderCall(adapter, handle, callId, phase) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'resource.provider_call', actor: 'worker',
    payload: { callId, phase, threadId: `thread-${handle.id}`, turnId: `turn-${handle.id}-1` },
  });
}

function emitScratchWrite(adapter, handle, key, text) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'scratchpad.write', actor: 'worker',
    payload: { entry: { kind: 'note', text }, expectedFence: 'current', idempotencyKey: key },
  });
}

function emitContentMessage(adapter, handle, text) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'content.message', actor: 'worker',
    payload: { text },
  });
}

const gateCodes = ['forbidden_effect_observed', 'worker_path_scope_violation', 'required_effect_absent'];
const gateEvents = (coordinator, workerId) =>
  coordinator._log.read(workerId).filter((event) => gateCodes.includes(event.payload?.code));
const settledWith = (coordinator, workerId, basis) =>
  coordinator._log.read(workerId).find((event) => event.kind === 'turn.settled' && event.payload?.basis === basis);
const verifyRuns = (coordinator, workerId) =>
  coordinator._log.read(workerId).filter((event) => event.kind === 'verify.reverified').length;
const nudgePrompts = (adapter) =>
  adapter.calls.prompt.filter((call) => /baton-progress-check|report your progress/.test(String(call.content)));

/** Stage one parked, un-driven checkpoint on a `pausable` card. */
async function parked({ adapter, capture, governed = true }) {
  const kit = setup({ adapter, capture, governed });
  const handle = await kit.coordinator.spawn('mock', makeBrief());
  const task = kit.coordinator._tasks.get(handle.taskId);
  emitTurnCompleted(adapter, handle);
  await flush();
  const rows = kit.coordinator.pausedTurns({ taskId: task.id });
  return { ...kit, handle, task, row: rows[0] ?? null };
}

// ===========================================================================
// §A — The revised disposition: park visibly, decide nothing automatically
// ===========================================================================

test('TW-R1: an un-driven pausable checkpoint PARKS — durable record, visible projection, zero automatic prompts, zero verdicts', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, row } = await parked({ adapter, capture: noDiff });

  const entries = coordinator._log.read(handle.id);
  const pausedEntry = entries.find((event) => event.kind === 'turn.paused');
  assert.ok(pausedEntry, 'turn.paused is appended to the per-worker log');
  assert.equal(pausedEntry.actor, 'worker');
  assert.deepEqual(Object.keys(pausedEntry.payload).sort(),
    ['changedPathsDigest', 'origin', 'taskId', 'turnEpoch'],
    'the durable pause payload keeps its four-field contract');
  assert.equal(task.status, 'paused', 'the task parks in the `paused` state');
  assert.ok(row, 'the checkpoint is visible to the orchestrator on pausedTurns()');
  assert.equal(row.state, 'pending');
  assert.equal(row.consumer, null);
  assert.equal(row.workerId, handle.id);
  assert.equal(row.taskId, task.id);

  // NOTHING is automatic: the seam must not prompt the worker, settle the pause, or evaluate
  // the claim. The record carries no armed window at all (`steering` is absent by construction).
  assert.equal(adapter.calls.prompt.length, 0, 'no policy prompt is ever sent at a checkpoint');
  assert.equal(nudgePrompts(adapter).length, 0, 'no progress-nudge text exists on the pause seam');
  assert.equal(settledWith(coordinator, handle.id, 'steering_answered'), undefined, 'no automatic settle');
  assert.equal(settledWith(coordinator, handle.id, 'steering_expired'), undefined, 'no expiry settle');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'the trust gate/verifier is NOT dispatched');
  assert.equal(coordinator._pausedTurns.get(row.pauseId).steering, undefined,
    'the record has no armed window — parking is not a cycle');
  assert.equal(adapter.calls.kill.length, 0, 'nothing is killed');
});

test('TW-R2: no automatic prompt under ANY elapsed time — the pause seam uses no clock', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, row } = await parked({ adapter, capture: noDiff });

  await sleep(150); // six windows of the 25ms knob
  await flush();
  assert.equal(adapter.calls.prompt.length, 0, 'no prompt after six windows');
  assert.equal(settledWith(coordinator, handle.id, 'steering_expired'), undefined, 'no expiry ever fires');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'no timed verdict');
  assert.equal(task.status, 'paused', 'the checkpoint is still parked');
  assert.equal(coordinator._pausedTurns.get(row.pauseId)?.state, 'pending', 'the record is still claimable');
  assert.equal(adapter.calls.kill.length, 0, 'elapsed time kills nothing');
});

test('TW-R3: worker wire activity is not a claim — provider calls, content, and turn boundaries decide nothing', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, row } = await parked({ adapter, capture: noDiff });

  // Every class the retired cycle used to read as an "answer" or as liveness.
  emitProviderCall(adapter, handle, 'twr3-requested', 'requested');
  emitProviderCall(adapter, handle, 'twr3-completed', 'completed');
  emitContentMessage(adapter, handle, 'still working on it');
  emitScratchWrite(adapter, handle, 'twr3-note', 'a distinct note');
  emitTurnStarted(adapter, handle, 2);
  await flush();
  await sleep(75);
  await flush();

  assert.equal(adapter.calls.prompt.length, 0, 'no class of worker evidence mints a policy prompt');
  assert.equal(gateEvents(coordinator, handle.id).length, 0, 'no class of worker evidence mints a verdict');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'the verifier is never invoked by wire noise');
  assert.equal(coordinator._pausedTurns.get(row.pauseId)?.state, 'pending',
    'the checkpoint survives the worker\'s own activity — only an explicit act decides it');
  assert.equal(adapter.calls.kill.length, 0, 'no kill');
});

// ===========================================================================
// §B — Explicit authority: claim_turn runs the real verifier
// ===========================================================================

test('TW-R4: claim_turn runs the existing verifier and completes an in-scope claim', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, row } = await parked({ adapter, capture: withDiff });
  assert.equal(task.status, 'paused');

  const claimed = await coordinator.claimTurn(row.pauseId, { actor: 'orchestrator' });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.result, 'claimed');
  assert.equal(claimed.outcome, 'completed', 'the live gate accepts the in-scope diff');
  assert.equal(task.status, 'completed');
  assert.ok(settledWith(coordinator, handle.id, 'claim'), 'the act is durable as turn.settled {basis: claim}');
  assert.equal(verifyRuns(coordinator, handle.id), 1, 'the existing verifier ran exactly once');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0, 'the record is consumed');
  const gate = coordinator._log.read(handle.id).find((event) => event.kind === 'error' && event.payload?.phase === 'trust_gate');
  assert.equal(gate, undefined, 'an accepted claim writes no gate-failure event');
  assert.equal(adapter.calls.prompt.length, 0, 'the claim needed no policy prompt');
});

test('TW-R5: claim_turn on a diffless checkpoint fails the gate — the verifier still demands the effect', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, row } = await parked({ adapter, capture: noDiff });

  const claimed = await coordinator.claimTurn(row.pauseId, { actor: 'orchestrator' });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.outcome, 'failed', 'the diffless claim is refused by the authoritative gate');
  assert.equal(task.status, 'failed');
  const verdict = gateEvents(coordinator, handle.id).find((event) => event.payload?.code === 'required_effect_absent');
  assert.ok(verdict, 'the gate verdict names required_effect_absent');
  assert.equal(verdict.payload?.steered, undefined,
    'the retired steering receipt no longer exists on a claim verdict');
  assert.equal(verifyRuns(coordinator, handle.id), 0,
    'the refusal lands in the gate\'s required-effect phase — the referee never runs (no verify receipt)');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0, 'the record is consumed');
});

// ===========================================================================
// §C — Explicit continuation: nudge_turn and wait_turn
// ===========================================================================

test('TW-R6: nudge_turn is a real continuation — fresh turn on the SAME task, and its completion re-parks', async () => {
  const adapter = new ScriptableAdapter();
  // Non-governed: the continuation's completion is a SECOND checkpoint turn, and a governed
  // worker would reuse the spawn-sealed providerTurn (a separate HEAD governance concern).
  const { coordinator, handle, task, row } = await parked({ adapter, capture: noDiff, governed: false });

  const nudged = await coordinator.nudgeTurn(row.pauseId, 'continue with the remaining plan', { actor: 'orchestrator' });
  assert.equal(nudged.ok, true);
  assert.equal(nudged.result, 'nudged');
  assert.equal(task.status, 'working', 'the continuation unparks the same task');
  assert.ok(nudged.turnEpoch > row.turnEpoch, 'a fresh turn was admitted (fence/turn advanced)');
  assert.ok(settledWith(coordinator, handle.id, 'nudge'), 'durable turn.settled {basis: nudge}');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0, 'the act consumed the record');
  assert.equal(adapter.calls.prompt.length, 1, 'the one delivery is the caller\'s nudge, never a policy prompt');
  assert.equal(nudgePrompts(adapter).length, 0, 'the caller\'s text is not a policy progress nudge');

  // The continuation completing is an ordinary new checkpoint: it PARKS again, with no prompt.
  emitTurnCompleted(adapter, handle, nudged.turnEpoch, 'second checkpoint');
  await flush();
  assert.equal(task.status, 'paused', 'the continuation\'s completion parks as a new checkpoint');
  const rows = coordinator.pausedTurns({ taskId: task.id });
  assert.equal(rows.length, 1, 'exactly one fresh record');
  assert.equal(adapter.calls.prompt.length, 1, 'parking a checkpoint sends no prompt — the loop is impossible');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'and dispatches no verdict');
});

test('TW-R7: wait_turn is a receipt — the record stays claimable and a later claim succeeds', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, row } = await parked({ adapter, capture: withDiff });

  const waited = coordinator.waitTurn(row.pauseId, { actor: 'orchestrator' });
  assert.equal(waited.ok, true);
  assert.equal(waited.result, 'wait_noted');
  assert.equal(waited.state, 'pending');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 1, 'waiting never consumes the record');
  assert.equal(task.status, 'paused');

  const claimed = await coordinator.claimTurn(row.pauseId, { actor: 'orchestrator' });
  assert.equal(claimed.ok, true, 'wait -> claim succeeds on the SAME record');
  assert.equal(claimed.outcome, 'completed');
  assert.equal(coordinator._log.read(handle.id)
    .filter((event) => event.kind === 'turn.wait_noted' && event.payload?.pauseId === row.pauseId).length, 1,
  'the wait act is durably receipted');
});

// ===========================================================================
// §D — The unchanged spine, cancellation, and the retired code
// ===========================================================================

test('TW-R8: a `claim`-carded turn (the default) is untouched — it reaches the trust gate byte-identically', async () => {
  const adapter = new ScriptableAdapter();
  adapter._card = { ...adapter._card, turnCompletion: 'claim' };
  const { coordinator } = setup({ adapter, capture: withDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);

  emitTurnCompleted(adapter, handle, 1, 'final claim');
  await flush();
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0, 'no pause record for a claim card');
  assert.equal(task.status, 'completed', 'the claim goes straight through the gate');
  assert.equal(verifyRuns(coordinator, handle.id), 1);
  assert.equal(adapter.calls.prompt.length, 0, 'no prompt');
});

test('TW-R9: cancellation — a parked checkpoint is not resurrected by a late completion', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, row } = await parked({ adapter, capture: withDiff });
  assert.equal(task.status, 'paused');

  await coordinator.stopRunTargets([handle.id], 'orchestrator');
  assert.equal(task.status, 'cancelled', 'the explicit stop closes the parked task');

  emitTurnCompleted(adapter, handle, 2, 'late frame');
  await flush();
  assert.equal(task.status, 'cancelled', 'a late completion cannot reopen a cancelled task');
  const rows = coordinator.pausedTurns({ taskId: task.id });
  assert.deepEqual(rows.map((entry) => entry.pauseId), [row.pauseId],
    'the late frame mints no NEW checkpoint — only the pre-stop record is still projected');
  assert.equal(adapter.calls.prompt.length, 0, 'no prompt after the stop');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'the verifier never evaluates a cancelled task');
});

test('TW-R10 (static): the retired self-driving cycle cannot quietly return, and the stall seam is untouched', () => {
  const src = readFileSync(new URL('../src/coordinator.mjs', import.meta.url), 'utf8');
  for (const retired of [
    'baton-progress-check', '_buildProgressNudge', '_armSteeringCycle', '_observeSteeringCycle',
    '_steeringEvidenceQualifies', '_settleSteeringCycle', '_expireSteeringCycle', '_clearSteeringTimer',
  ]) {
    assert.equal(src.includes(retired), false,
      `the pause seam must not carry the retired policy cycle (found \`${retired}\`)`);
  }
  assert.doesNotMatch(src, /_armSteeringCycle[\s\S]{0,200}?control\.nudge|control\.nudge[\s\S]{0,200}?_armSteeringCycle/u,
    'no arm-time control.nudge lane survives');
  // The #67 stall fold is a DIFFERENT surface and is untouched: frozen, ACTUAL-sorted, and it
  // still excludes resource.provider_call.
  assert.ok(Object.isFrozen(coordinatorNs.REARM_KINDS), 'REARM_KINDS stays frozen');
  assert.deepEqual([...coordinatorNs.REARM_KINDS], [...REARM_KINDS_SORTED],
    'exactly the four closed kinds in ACTUAL sorted order');
  assert.equal([...coordinatorNs.REARM_KINDS].includes('resource.provider_call'), false,
    'the stall fold never grew a provider-call kind');
  // The window knob survives ONLY for the stall seam (D4 rung 2).
  assert.match(src, /_progressNudgeWindowMs[\s\S]{0,400}?_armStallCycle|_armStallCycle[\s\S]{0,400}?_progressNudgeWindowMs/u,
    'the bounded window knob now belongs to the stall seam');
});
