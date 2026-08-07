// Issue #80 red suite: the folded TG3-window contract v1.1
// (contract: docs/reference/evidence/tg3-window-2026-08-07/tg3-window-contract.md;
// fold: contract-fold.md — B1/B2/B3 blockers; red-team: contract-redteam.md).
//
// D1 the window is evidence-gated, never longer (candidate (a) — a bigger window — is rejected
// by construction). D2 the turn-start dispatch receipt (`resource.provider_call
// {phase: 'requested', callId}`, emitted AT the dispatch point) answers the steering cycle —
// requested OR completed phase, validity-gated, per-seat, honest naming, anti-gaming (once per
// record, the FINAL still demands the diff). D3 the honest-stall discriminator is "no start-class
// evidence": `_expireSteeringCycle` re-checks the evidence fold at fire time (B1) and only a fold
// EMPTY of start-class identity runs the full final; the expiry is receipted for #55-class
// debuggability (`{windowMs, startEvidenceObserved, answerClasses}` on the `steered` receipt and
// the `turn.settled {basis:'steering_expired'}` payload). D4 the paused-only guard is preserved;
// the #67 REARM_KINDS fold (which excludes `resource.provider_call`) is a depending-on-#67 row.
//
// Red-first: every RED row fails at a NAMED stage against the PRE-implementation tree and goes
// green on the v1.1 implementation ONLY; every PIN row is green today AND green under the correct
// implementation, but fails a plausible WRONG one (the pin list names what each pin kills). Idioms:
// trust-gate-steering-red.test.mjs (the TG3 cycle harness) + workflow-as-data-red.test.mjs (the
// target-state row idiom — a depending-on row fails at its named stage via a first-assertion
// `assert.ok(...)` on an invented export, so the file LOADs but the row fails).
//
// Hermetic: mock adapters, tmp dirs, test.after cleanup, no network. Real timers drive the window
// exactly as production does (progressNudgeWindowMs is a deployment knob; the tests use 25ms +
// sleep(60) to cross it). NUL discipline: application.mjs and coordination-store.mjs are never
// read whole; the static rows read only the NUL-free sources (coordinator.mjs, codex-appserver.mjs,
// cli-adapters.mjs, claude-session.mjs). The providerGovernance deployment profile is observe-mode
// so provider calls are validity-tracked (`_observeLogicalProviderCall`) without strict binding.
//
// ===========================================================================
// ROW INVENTORY (the split at the bottom was measured against the PRE-implementation tree)
// ===========================================================================
//
// §A Evidence-answer classes (TW-01, TW-02)
//   TW-01  a valid `requested`- and a valid `completed`-phase provider call for the seat inside
//          the armed window each settle the cycle (`turn.settled {basis:'steering_answered'}`,
//          task → working, ZERO gate events). (RED: stage[provider-call-answer-missing])
//   TW-02  the turn-start dispatch receipt is emitted at the dispatch point — codex and cli emit
//          `resource.provider_call {phase:'requested'}` at turn/start dispatch; the atomic claude
//          pipe emits none (turn_started is synchronous with dispatch); a staged slow-start adapter
//          shows the receipt arriving before `turn_started`. (RED:
//          stage[dispatch-receipt-emission-missing])
//
// §B Expiry disposition (TW-03, TW-04, TW-04b, TW-05)
//   TW-03  a queued start never expires the window — a `requested` provider call at minute 4 of
//          the window (no turn_started, no content) settles CONSTRUCTIVELY at expiry: task
//          working, ZERO gate events, ZERO `steered` receipts. (RED: stage[queued-start-expires])
//   TW-04  the honest stall still evaluates — an EMPTY fold expiry runs the full final exactly as
//          today with `steered: {nudgeId, answered:false}` durable on the gate error event.
//          (PIN — today's T7b behavior)
//   TW-04b the genuine expiry is receipted for #55-class debuggability — the `steered` receipt
//          and the `turn.settled {basis:'steering_expired'}` payload carry the fold
//          `{windowMs, startEvidenceObserved:false, answerClasses:[]}`. (RED:
//          stage[steered-fold-missing])
//   TW-05  a D2-gate defect never kills a healthy worker (B1) — the expiry re-checks the fold,
//          finds a start-class identity, settles CONSTRUCTIVELY (task → working, zero gate events)
//          and receipts `steering.evidence_gate_defect` carrying the fold
//          (`startEvidenceObserved:true`, `answerClasses:['provider_call']`). (RED:
//          stage[evidence-gate-defect-missing])
//
// §C Shipped pins + once-per-record (TW-06, TW-07, TW-08a, TW-08b)
//   TW-06  `turn_started` remains a first-class answer — a resumed turn inside the window settles
//          the cycle, zero gate events. (PIN)
//   TW-07  the nudge never self-answers — the policy nudge's own delivery (`control.nudge`,
//          actor 'policy') and the buffering adapter's ACCEPTANCE never settle the cycle; the
//          window expires with `steered: {answered:false}`. (PIN)
//   TW-08a once-per-record bound (existing classes) — the first qualifying answer settles; later
//          evidence (provider calls, content) never re-arms; a NEW pause record gets its OWN
//          single cycle; and the FINAL still demands the real diff. (PIN)
//   TW-08b multiple provider calls answer exactly once (the first) — no re-answer, no re-arm.
//          (RED: stage[provider-call-answers-once])
//
// §D The watchdog surface is untouched (TW-09a, TW-09b)
//   TW-09a the shipped half — `_armWatchdog`'s working-only refusal (a blocked worker is never
//          stall-declared) and `_observeWatchdogEvent`'s own provider-call tracking (a valid
//          provider call is recorded in the handle's providerTurn) are byte-unchanged. (PIN)
//   TW-09b the depending-on-#67 half — the #67 REARM_KINDS closed set (frozen, ACTUAL-sorted,
//          excludes `resource.provider_call`) is asserted byte-unchanged against the #67 v1.1
//          contract text; verified when #67 folds. (RED: stage[depending-on-#67: rearm-kinds-missing])
//
// §E No-clock control-law row + discrimination pins (TW-10, TW-disc-invalid, TW-disc-digest,
// TW-disc-scope)
//   TW-10  the queued-start answer is EVIDENCE, never a window extension — the steering answer
//          set carries the provider_call class, the window default stays byte-unchanged, and no
//          per-route latency knob or expiry re-arm loop appears. (RED:
//          stage[answer-not-evidence])
//   TW-disc-invalid an invalid provider call (empty callId, phase outside the closed set) is
//          telemetry noise, never an answer — the honest stall fires. (PIN)
//   TW-disc-digest  the TG6 distinct-digest class holds — a distinct content digest answers and
//          credits content-IDENTITY; a replay never re-answers or re-arms; the FINAL still
//          demands the diff. (PIN)
//   TW-disc-scope   a provider call from ANOTHER worker never reaches the seat's cycle — the seat
//          still honest-stalls, the other worker is untouched. (PIN)
//
// ===========================================================================
// INVENTED SURFACES (names + exact observable signatures the implementation must land)
// ===========================================================================
//
// 1. `_steeringEvidenceQualifies` provider_call class — a valid `requested`/`completed`-phase
//    provider call for the seat inside the armed window answers (coordinator.mjs; absent at HEAD).
// 2. `_observeSteeringCycle` is called for `resource.provider_call` events (a call site beside the
//    existing :12053/:12454 sites; absent at HEAD).
// 3. `record.steering.observedEvidence` — the answer-class evidence fold on the in-memory pause
//    record, appended at each evidence evaluation; the provider_call class records its PHASE
//    identity (`requested` vs `completed`). (Absent at HEAD; TW-05 injects it to stage the B1
//    defect.)
// 4. `steered` receipt gain `{windowMs, startEvidenceObserved, answerClasses}` on the gate
//    error-event payload (:13206) AND the `turn.settled {basis:'steering_expired'}` payload.
//    (Absent at HEAD — the receipt is `{nudgeId, answered:false}` only.)
// 5. `steering.evidence_gate_defect` — a NEW named error-event receipt (kind 'error',
//    payload.code 'steering.evidence_gate_defect') on the B1 constructive settle, carrying the
//    fold. (Absent at HEAD.)
// 6. Adapter dispatch emission — codex (`codex-appserver.mjs`, at the turn/start dispatch ~:997,
//    before the await) and cli (`cli-adapters.mjs`, at its exec/turn dispatch) emit
//    `resource.provider_call {phase:'requested', callId}`; the atomic claude pipe
//    (`claude-session.mjs`) emits NO requested phase. (All three emit `completed` only at HEAD.)
// 7. `coordinator.mjs` REARM_KINDS — the #67 closed set, frozen, ACTUAL-sorted, excluding
//    `resource.provider_call`. (Absent at HEAD; depending-on-#67.)
//
// ===========================================================================
// VERIFIED SPLIT (recorded after finalization — two consecutive runs from the repo root)
// ===========================================================================
//
// `node --test impl/test/tg3-window-red.test.mjs` from the repo root, twice (stable):
//   run 1 → tests 16 · pass 8 · fail 8
//   run 2 → tests 16 · pass 8 · fail 8
// The 8 passes are exactly the PIN rows (TW-04, TW-06, TW-07, TW-08a, TW-09a, TW-disc-invalid,
// TW-disc-digest, TW-disc-scope); the 8 failures are the red rows, each failing at its named stage.

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
// literal, asserted byte-unchanged and excluding the #80 provider_call answer class (TW-09b).
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

// The governed ScriptableAdapter — the trust-gate-steering card plus the modelSelection and
// governance sub-card every real adapter carries, so the observe-mode providerGovernance policy
// resolves the exact route {mock, mock-model, low} and provider calls are validity-tracked.
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
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

// The observe-mode providerGovernance deployment profile — mode 'observe' so provider calls are
// validity-tracked (`_observeLogicalProviderCall`) with no strict binding, no pre-effect seal.
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
    progressNudgeWindowMs: 25, // the TG3 bounded window — small for determinism
    // The observe-mode providerGovernance deployment profile validates provider calls
    // (`_observeLogicalProviderCall`) without strict binding. `governed: false` rows skip the
    // deployment profile entirely — a governed worker completing TWO checkpoint turns reuses the
    // spawn-sealed providerTurn and would hit usage_seal_duplicate on the second turn (a real
    // HEAD governance behavior orthogonal to the TG3 window), so the once-per-record row stages
    // its second record without the seal requirement.
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

function emitBlockingQuestion(adapter, handle, requestId) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId, question: 'blocking question', blocking: true },
  });
}

const gateCodes = ['forbidden_effect_observed', 'worker_path_scope_violation', 'required_effect_absent'];
const gateEvents = (coordinator, workerId) =>
  coordinator._log.read(workerId).filter((event) => gateCodes.includes(event.payload?.code));
const nudgeCount = (adapter) =>
  adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:')).length;
const settledWith = (coordinator, workerId, basis) =>
  coordinator._log.read(workerId).find((event) => event.kind === 'turn.settled' && event.payload?.basis === basis);

// ===========================================================================
// §A — Evidence-answer classes
// ===========================================================================

test('TW-01 (RED, stage[provider-call-answer-missing]): a valid requested-phase and a valid completed-phase provider call for the seat each settle the steering cycle', async () => {
  for (const phase of ['requested', 'completed']) {
    const adapter = new ScriptableAdapter();
    const { coordinator } = setup({ adapter, capture: noDiff });
    const handle = await coordinator.spawn('mock', makeBrief());
    emitTurnCompleted(adapter, handle);
    await flush(40);
    emitProviderCall(adapter, handle, `tw1-${phase}`, phase);
    await flush(40);
    await sleep(60); // cross the window — the call must have answered in time
    await flush(40);
    const task = coordinator._tasks.get(handle.taskId);
    assert.equal(task.status, 'working',
      `stage[provider-call-answer-missing]: a valid ${phase}-phase provider call for the seat inside the armed window settles the cycle — task → working (got ${task.status})`);
    const settled = settledWith(coordinator, handle.id, 'steering_answered');
    assert.ok(settled,
      `stage[provider-call-answer-missing]: the ${phase} call settles with turn.settled {basis:'steering_answered'}`);
    assert.equal(gateEvents(coordinator, handle.id).length, 0,
      `stage[provider-call-answer-missing]: an answered cycle produces ZERO gate verdict events`);
    assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0,
      `stage[provider-call-answer-missing]: the pause record is consumed by the answer`);
    assert.equal(adapter.calls.kill.length, 0,
      `stage[provider-call-answer-missing]: the healthy worker is never killed`);
  }
});

test('TW-02 (RED, stage[dispatch-receipt-emission-missing]): the turn-start dispatch receipt is emitted at the dispatch point — before turn_started', async () => {
  // (a) Static: the native/emulated adapters emit a requested-phase provider_call at the turn-start
  // dispatch; the atomic claude pipe emits none (turn_started is synchronous with dispatch).
  const codex = readFileSync(new URL('../src/codex-appserver.mjs', import.meta.url), 'utf8');
  const cli = readFileSync(new URL('../src/cli-adapters.mjs', import.meta.url), 'utf8');
  const claude = readFileSync(new URL('../src/claude-session.mjs', import.meta.url), 'utf8');
  // codex emits via `_emit(session, 'resource.provider_call', { … })` — the third-arg object.
  assert.match(codex, /resource\.provider_call\s*,\s*\{[^{}]*phase\s*:\s*['"]requested['"]/u,
    'stage[dispatch-receipt-emission-missing]: codex must emit resource.provider_call {phase: requested} at the turn/start dispatch (before the await resolves)');
  // cli emits via `{ … kind: 'resource.provider_call', payload: { … } }` — the payload field.
  assert.match(cli, /resource\.provider_call[\s\S]{0,250}?(?:payload\s*:\s*\{[^{}]*phase\s*:\s*['"]requested['"]|,\s*\{[^{}]*phase\s*:\s*['"]requested['"])/u,
    'stage[dispatch-receipt-emission-missing]: cli must emit resource.provider_call {phase: requested} at its exec/turn dispatch');
  // The atomic claude pipe needs NO requested-phase emission — turn_started answers at frame write.
  assert.doesNotMatch(claude, /resource\.provider_call\s*,\s*\{[^{}]*phase\s*:\s*['"]requested['"]/u,
    'the atomic claude pipe emits no requested-phase provider_call (turn_started is synchronous with dispatch)');
  // (b) Dynamic: a staged slow-start adapter shows the receipt arriving BEFORE turn_started.
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  emitProviderCall(adapter, handle, 'tw2-dispatch', 'requested');
  emitTurnStarted(adapter, handle, 2);
  await flush(40);
  await sleep(60);
  await flush(40);
  const events = coordinator._log.read(handle.id);
  const dispatchIdx = events.findIndex((event) => event.kind === 'resource.provider_call'
    && event.payload?.phase === 'requested');
  const startedIdx = events.findIndex((event) => event.kind === 'lifecycle.turn_started'
    && event.turnEpoch === 2);
  assert.ok(dispatchIdx >= 0 && startedIdx >= 0 && dispatchIdx < startedIdx,
    'stage[dispatch-receipt-emission-missing]: the dispatch receipt arrives before turn_started in the wire order');
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed',
    'stage[dispatch-receipt-emission-missing]: a worker whose dispatch receipt precedes turn_started is not killed — the receipt is real dispatch evidence');
});

// ===========================================================================
// §B — Expiry disposition
// ===========================================================================

test('TW-03 (RED, stage[queued-start-expires]): a queued start never expires the window — a requested provider call at minute 4 settles constructively at expiry', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  await sleep(15); // minute 4 of the 25ms window — the provider accepted the call, turn still queued
  emitProviderCall(adapter, handle, 'tw3-queued', 'requested');
  await flush(40);
  await sleep(60); // the window elapses
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'working',
    `stage[queued-start-expires]: a provider-queued healthy-slow worker is never final-evaluated as unanswered by a clock alone — task → working (got ${task.status})`);
  assert.equal(gateEvents(coordinator, handle.id).length, 0,
    'stage[queued-start-expires]: ZERO gate verdict events — the queued start is not an honest stall');
  assert.equal(coordinator._log.read(handle.id)
    .filter((event) => event.kind === 'error' && event.payload?.steered).length, 0,
    'stage[queued-start-expires]: ZERO steered receipts — the cycle was answered, never expired-unanswered');
  assert.equal(adapter.calls.kill.length, 0,
    'stage[queued-start-expires]: the queued-start worker is never killed');
});

test('TW-04 (PIN): the honest stall still evaluates — an empty-fold expiry runs the full final exactly as today with the steering receipt durable', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  assert.notEqual(coordinator._tasks.get(handle.taskId).status, 'failed',
    'mid-window the worker is ALIVE — the verdict waits for the window');
  await sleep(60); // window expiry, nothing answered
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed', 'an unanswered empty-fold expiry produces today\'s full final evaluation');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent, 'the gate\'s verdict event exists (kind error, code required_effect_absent)');
  const steered = verdictEvent?.payload?.steered ?? null;
  assert.ok(steered, 'the verdict carries the steering receipt');
  assert.ok(String(steered.nudgeId).startsWith('baton-progress-check:'),
    'the steering receipt names the armed nudge');
  assert.equal(steered.answered, false,
    'the steering receipt is durable on the verdict (steered.answered === false)');
});

test('TW-04b (RED, stage[steered-fold-missing]): the genuine expiry is receipted for #55-class debuggability — the fold rides the steered receipt and the steering_expired payload', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  await sleep(60);
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed', 'the honest-stall expiry is the staging');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  const steered = verdictEvent?.payload?.steered ?? null;
  assert.ok(steered,
    'stage[steered-fold-missing]: the gate error event carries the steered receipt');
  assert.equal(steered.windowMs, 25,
    'stage[steered-fold-missing]: the steered receipt carries the windowMs of the armed cycle');
  assert.equal(steered.startEvidenceObserved, false,
    'stage[steered-fold-missing]: the fold reports no start-class evidence was observed (the honest stall)');
  assert.ok(Array.isArray(steered.answerClasses),
    'stage[steered-fold-missing]: the fold reports the observed answer classes (empty here)');
  const expired = coordinator._log.read(handle.id).find((event) => event.kind === 'turn.settled'
    && event.payload?.basis === 'steering_expired');
  assert.ok(expired, 'the steering_expired settle exists');
  const fold = expired?.payload ?? {};
  assert.equal(fold.windowMs, 25,
    'stage[steered-fold-missing]: the steering_expired payload carries the same windowMs fold');
  assert.equal(fold.startEvidenceObserved, false,
    'stage[steered-fold-missing]: the steering_expired payload carries the same startEvidenceObserved');
});

test('TW-05 (RED, stage[evidence-gate-defect-missing]): a D2-gate defect never kills a healthy worker — the expiry re-check finds start evidence and settles constructively with a named defect receipt', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId, 'the pause record pends with an armed cycle');
  // B1 defect stage: a valid provider_call was OBSERVED in-window and appended to the fold, yet
  // the cycle was never consumed (the D2 consume-path defect). At HEAD there is no fold and no
  // fire-time re-check — the expiry runs the full final and kills the worker.
  const record = coordinator._pausedTurns.get(pauseId);
  record.steering.observedEvidence = [{ kind: 'provider_call', phase: 'requested', callId: 'tw5-call' }];
  await sleep(60);
  await flush(40);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'working',
    `stage[evidence-gate-defect-missing]: the expiry re-check finds the start-class identity and settles CONSTRUCTIVELY — task → working (got ${coordinator._tasks.get(handle.taskId).status})`);
  assert.equal(gateEvents(coordinator, handle.id).length, 0,
    'stage[evidence-gate-defect-missing]: ZERO gate verdict events — the defect never kills');
  const defect = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'steering.evidence_gate_defect');
  assert.ok(defect,
    'stage[evidence-gate-defect-missing]: the constructive settle receipts a named steering.evidence_gate_defect error event');
  assert.equal(defect.payload?.startEvidenceObserved, true,
    'stage[evidence-gate-defect-missing]: the defect receipt carries the fold — start evidence WAS observed');
  assert.ok((defect.payload?.answerClasses ?? []).includes('provider_call'),
    'stage[evidence-gate-defect-missing]: the defect receipt carries the fold — the provider_call class is named');
  const settled = settledWith(coordinator, handle.id, 'steering_answered');
  assert.ok(settled && settled.payload?.via === 'evidence_gate_defect',
    'stage[evidence-gate-defect-missing]: the constructive settle is turn.settled {basis: steering_answered, via: evidence_gate_defect}');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0,
    'stage[evidence-gate-defect-missing]: the pause record is consumed by the constructive settle');
});

// ===========================================================================
// §C — Shipped pins + once-per-record
// ===========================================================================

test('TW-06 (PIN): turn_started remains a first-class answer — a resumed turn inside the window settles the cycle, zero gate events', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  emitTurnStarted(adapter, handle, 2);
  await flush(40);
  await sleep(60);
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed');
  assert.notEqual(task.status, 'completed', 'the checkpoint itself is never accepted');
  assert.ok(['working', 'paused'].includes(task.status),
    `the answered cycle settles back to work, never a verdict (got ${task.status})`);
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0, 'the pause record is consumed by the answer');
  assert.equal(gateEvents(coordinator, handle.id).length, 0);
  assert.equal(adapter.calls.kill.length, 0);
});

test('TW-07 (PIN): the nudge never self-answers — the delivered control.nudge and the buffering adapter\'s acceptance never settle the cycle', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  // The buffering-kind adapter ACCEPTED the nudge (mode 'nudge', provenance-marked) but never
  // starts a turn — for the claude pipe the nudge IS a turn start when idle, so this stage is
  // impossible there; the ScriptableAdapter is the codex-like buffering shape.
  const nudges = adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:'));
  assert.equal(nudges.length, 1, 'the cycle armed and delivered exactly one policy nudge');
  assert.equal(nudges[0].mode, 'nudge', 'the nudge rides the control lane (mode nudge)');
  const controlReceipt = coordinator._log.read(handle.id).find((event) => event.kind === 'control.nudge'
    && event.actor === 'policy');
  assert.ok(controlReceipt, 'the control.nudge receipt exists (actor policy)');
  await sleep(60); // window expiry — the nudge and its acceptance are NOT answers
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed',
    'the nudge delivery and the adapter\'s acceptance never settle the cycle — the honest stall evaluates');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  const steered = verdictEvent?.payload?.steered ?? null;
  assert.ok(steered && steered.answered === false,
    'the cycle expires with steered.answered === false — the nudge is not in the answer set');
});

test('TW-08a (PIN): once-per-record bound — the first qualifying answer settles; later evidence never re-arms; a NEW record gets its own single cycle; and the FINAL still demands the diff', async () => {
  const adapter = new ScriptableAdapter();
  // Non-governed: the row's second checkpoint turn needs a fresh providerTurn to seal, which only
  // a nudge/continuation admission provides at HEAD — a governed multi-turn concern orthogonal to
  // the once-per-record bound (see setup's `governed` note).
  const { coordinator } = setup({ adapter, capture: noDiff, governed: false });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle, 1);
  await flush(40);
  assert.equal(nudgeCount(adapter), 1, 'the first record arms exactly one cycle');
  // Non-answer evidence while the cycle pends.
  emitProviderCall(adapter, handle, 'tw8a-a', 'requested');
  emitContentMessage(adapter, handle, 'micro-progress chatter');
  await flush(40);
  // The answer (turn_started) settles the FIRST cycle; the provider call above either stayed
  // non-answering (HEAD) or the first call answered (implementation) — either way exactly one
  // settle, no re-arm.
  emitTurnStarted(adapter, handle, 2);
  await flush(40);
  emitProviderCall(adapter, handle, 'tw8a-b', 'completed');
  emitContentMessage(adapter, handle, 'more chatter');
  await flush(40);
  assert.equal(nudgeCount(adapter), 1, 'post-answer evidence never re-arms the settled record');
  assert.equal(settledWith(coordinator, handle.id, 'steering_answered') !== undefined, true,
    'the first qualifying answer settled exactly once');
  assert.equal(coordinator.pausedTurns({ taskId: coordinator._tasks.get(handle.taskId).id }).length, 0,
    'the answered record is consumed');
  // A NEW record arms a NEW single cycle.
  emitTurnCompleted(adapter, handle, 2, 'second checkpoint');
  await flush(40);
  assert.equal(nudgeCount(adapter), 2, 'the second RECORD gets its own single cycle — no re-arm, no third nudge');
  // The FINAL still demands the real in-scope diff: cycle 2 expires empty and the full final
  // evaluation fails required_effect_absent — a dispatch receipt cannot buy a content-floor pass.
  await sleep(60);
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed', 'the FINAL still demands the real diff — the answered checkpoint never waives the gate');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent, 'the anti-gaming bound holds: the diff-free final fails required_effect_absent');
  assert.ok(verdictEvent.payload?.steered?.answered === false,
    'the second record expired unanswered with the steering receipt — one unanswered cycle precedes the final');
});

test('TW-08b (RED, stage[provider-call-answers-once]): a worker emitting multiple provider calls answers exactly once — the first; no re-answer, no re-arm', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  assert.equal(nudgeCount(adapter), 1, 'the record arms exactly one cycle');
  emitProviderCall(adapter, handle, 'tw8b-1', 'requested');
  emitProviderCall(adapter, handle, 'tw8b-1', 'completed');
  emitProviderCall(adapter, handle, 'tw8b-2', 'requested');
  await flush(40);
  await sleep(60);
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'working',
    `stage[provider-call-answers-once]: the first provider call answers the cycle — task → working (got ${task.status})`);
  const settles = coordinator._log.read(handle.id).filter((event) => event.kind === 'turn.settled'
    && event.payload?.basis === 'steering_answered');
  assert.equal(settles.length, 1,
    'stage[provider-call-answers-once]: multiple provider calls answer EXACTLY once — the first settle consumes the record');
  assert.equal(nudgeCount(adapter), 1,
    'stage[provider-call-answers-once]: no second cycle arms for the same record');
  assert.equal(coordinator.pausedTurns({ taskId: task.id }).length, 0,
    'stage[provider-call-answers-once]: the record is consumed by the single answer');
  assert.equal(gateEvents(coordinator, handle.id).length, 0,
    'stage[provider-call-answers-once]: the answered record produces no gate verdict');
});

// ===========================================================================
// §D — The watchdog surface is untouched
// ===========================================================================

test('TW-09a (PIN): the shipped watchdog half — _armWatchdog\'s working-only refusal and _observeWatchdogEvent\'s provider-call tracking are byte-unchanged', async () => {
  // (a1) Working-only refusal: a blocked worker is never stall-declared.
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  await flush(40);
  emitBlockingQuestion(adapter, handle, 'tw9a-q');
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'input_required', 'the blocking question parked the task');
  assert.equal(coordinator._workers.get(handle.id).status, 'blocked', 'the handle is blocked');
  await sleep(150); // well past the 60ms stall window
  await flush(40);
  assert.equal(coordinator._log.read(handle.id).filter((event) => event.kind === 'health.stall_suspected').length, 0,
    'the shipped working-only refusal holds: a blocked worker is never stall-declared');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'input_required',
    'the blocked worker is untouched by the watchdog');

  // (a2) _observeWatchdogEvent's own provider-call tracking: a valid provider call rides the
  // watchdog observation into the handle's providerTurn — this consumer stays independent of the
  // steering-cycle answer surface.
  const adapter2 = new ScriptableAdapter();
  const { coordinator: c2 } = setup({ adapter: adapter2, capture: noDiff });
  const handle2 = await c2.spawn('mock', makeBrief());
  await flush(40);
  emitProviderCall(adapter2, handle2, 'tw9a-track', 'requested');
  await flush(40);
  const h2 = c2._workers.get(handle2.id);
  assert.equal(h2.providerTurn?.providerCallIds.has('tw9a-track'), true,
    'the shipped _observeWatchdogEvent provider-call tracking is intact');
});

test('TW-09b (RED, stage[depending-on-#67: rearm-kinds-missing]): the #67 REARM_KINDS fold is the frozen closed set — ACTUAL-sorted, excluding resource.provider_call (target-state row)', () => {
  assert.ok(coordinatorNs.REARM_KINDS,
    'stage[depending-on-#67: rearm-kinds-missing]: the closed re-arm set must be exported from the coordinator (verified when #67 folds)');
  assert.ok(Object.isFrozen(coordinatorNs.REARM_KINDS),
    'stage[depending-on-#67: rearm-kinds-missing]: the #67 set is frozen — closed, never grown silently');
  const values = [...coordinatorNs.REARM_KINDS];
  assert.deepEqual(values, [...REARM_KINDS_SORTED],
    'stage[depending-on-#67: rearm-kinds-missing]: exactly the four closed kinds in ACTUAL sorted order — nothing added, nothing dropped');
  assert.ok(!values.includes('resource.provider_call'),
    'stage[depending-on-#67: rearm-kinds-missing]: the #80 provider_call answer class is NOT a watchdog re-arm kind — the two surfaces stay separate');
});

// ===========================================================================
// §E — No-clock control-law row + discrimination pins
// ===========================================================================

test('TW-10 (RED, stage[answer-not-evidence]): the queued-start answer is evidence, never a window extension — no clock is added anywhere', () => {
  const src = readFileSync(new URL('../src/coordinator.mjs', import.meta.url), 'utf8');
  const evStart = src.indexOf('_steeringEvidenceQualifies(record, evidence) {');
  assert.ok(evStart >= 0, 'the steering evidence evaluator exists');
  const evTail = src.indexOf('_observeSteeringCycle(handle, evidence) {', evStart);
  const evidenceFn = src.slice(evStart, evTail > 0 ? evTail : evStart + 6000);
  assert.match(evidenceFn, /provider_call/u,
    'stage[answer-not-evidence]: the steering answer set must carry the provider_call evidence class (D2) — the queued-start answer is EVIDENCE (a provider call), never a bigger window');
  assert.match(src, /_progressNudgeWindowMs[\s\S]{0,120}?300_000/u,
    'the window default is byte-unchanged — candidate (a) per-route latency scaling is rejected by construction');
  assert.doesNotMatch(src, /windowMsByRoute|latencyScale|perRouteWindow/u,
    'no per-route latency knob appears anywhere in the coordinator');
  assert.doesNotMatch(src, /_expireSteeringCycle[\s\S]{0,400}?_setTimeout/u,
    'the expiry never re-arms a fresh window — the one-shot bound is the count, not a clock');
});

test('TW-disc-invalid (PIN): an invalid provider call is telemetry noise, never an answer — the honest stall fires', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle);
  await flush(40);
  // An empty callId and a phase outside the closed LOGICAL_CALL_PHASES set — both invalid per
  // _observeLogicalProviderCall (provider_call_id_invalid / provider_call_phase_invalid).
  emitProviderCall(adapter, handle, '', 'requested');
  emitProviderCall(adapter, handle, 'tw-disc-invalid', 'started');
  await flush(40);
  await sleep(60);
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'failed',
    'an invalid provider call never answers the cycle — the honest stall still evaluates');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent?.payload?.steered?.answered === false,
    'the invalid calls were telemetry noise — the cycle expired unanswered with the steering receipt');
});

test('TW-disc-digest (PIN, TG6 compatibility): the distinct-digest class holds — a distinct content digest answers and credits content-IDENTITY; a replay never re-answers or re-arms, and the FINAL still demands the diff', async () => {
  const adapter = new ScriptableAdapter();
  // Non-governed: the row's second checkpoint turn needs a fresh providerTurn to seal, which only
  // a nudge/continuation admission provides at HEAD (same note as TW-08a).
  const { coordinator } = setup({ adapter, capture: noDiff, governed: false });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, handle, 1);
  await flush(40);
  assert.equal(nudgeCount(adapter), 1, 'the first record arms exactly one cycle');
  emitScratchWrite(adapter, handle, 'tw-digest-a', 'distinct note one');
  await flush(40);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'working',
    'a distinct content digest answers the cycle — content-identity, never a content-free write');
  assert.equal(gateEvents(coordinator, handle.id).length, 0,
    'the digest-answered cycle produces ZERO gate verdict events');
  assert.equal(settledWith(coordinator, handle.id, 'steering_answered') !== undefined, true,
    'the distinct digest settled the record exactly once');
  emitScratchWrite(adapter, handle, 'tw-digest-a', 'distinct note one'); // replay — same content digest
  emitScratchWrite(adapter, handle, 'tw-digest-b', 'distinct note two'); // a second distinct digest
  await flush(40);
  assert.equal(coordinator._log.read(handle.id)
    .filter((event) => event.kind === 'turn.settled' && event.payload?.basis === 'steering_answered').length, 1,
    'a replayed digest and a second distinct digest never double-settle the consumed record');
  assert.equal(nudgeCount(adapter), 1,
    'post-answer scratchpad evidence never re-arms the settled record');
  // A NEW record arms its own single cycle, and the FINAL still demands the real in-scope diff.
  emitTurnCompleted(adapter, handle, 2, 'second checkpoint');
  await flush(40);
  assert.equal(nudgeCount(adapter), 2, 'the second RECORD gets its own single cycle');
  await sleep(60);
  await flush(40);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed',
    'the FINAL still demands the real diff — a digest answer never buys a content-floor pass');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent, 'the diff-free final fails required_effect_absent');
});

test('TW-disc-scope (PIN): a provider call from another worker never reaches the seat\'s cycle — per-handle scoping holds', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, capture: noDiff });
  const seat = await coordinator.spawn('mock', makeBrief());
  emitTurnCompleted(adapter, seat);
  await flush(40);
  const other = await coordinator.spawn('mock', makeBrief());
  await flush(40);
  // The #47 readiness-tier shape: an isolated worker mints a valid completed-phase receipt.
  emitProviderCall(adapter, other, 'probe-call', 'completed');
  await flush(40);
  await sleep(60);
  await flush(40);
  const seatTask = coordinator._tasks.get(seat.taskId);
  const otherTask = coordinator._tasks.get(other.taskId);
  assert.equal(seatTask.status, 'failed',
    'a call from ANOTHER worker never answers the seat\'s cycle — the seat honest-stalls');
  const verdictEvent = coordinator._log.read(seat.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent?.payload?.steered?.answered === false,
    'the seat\'s cycle expired unanswered despite the other worker\'s call');
  assert.notEqual(otherTask.status, 'failed',
    'the other worker is untouched by the seat\'s pause');
});

// ===========================================================================
// VERIFIED SPLIT (measured from the repo root — `node --test impl/test/tg3-window-red.test.mjs`)
// ===========================================================================
// Run 1: tests 16 · pass 8 · fail 8
// Run 2: tests 16 · pass 8 · fail 8
// The 8 red rows fail at their named stages: TW-01 (provider-call-answer-missing), TW-02
// (dispatch-receipt-emission-missing), TW-03 (queued-start-expires), TW-04b (steered-fold-missing),
// TW-05 (evidence-gate-defect-missing), TW-08b (provider-call-answers-once), TW-09b
// (depending-on-#67: rearm-kinds-missing), TW-10 (answer-not-evidence).
