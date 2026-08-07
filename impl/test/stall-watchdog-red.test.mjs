// Issue #67 red suite: the folded stall-watchdog contract v1.1
// (contract: docs/reference/evidence/stall-watchdog-2026-08-07/stall-watchdog-contract.md;
// fold: contract-fold.md — 9 blockers; red-team: contract-redteam.md;
// fold-2: suite-fold-2-brief.md + suite-fold-2.md — the 7 blue-team findings F1-F7).
//
// D1 decouples the stall budget from the wall budget (a separately-frozen DEFAULT_WATCHDOG
// strictly smaller than DEFAULT_BUDGET.wallMin * 60_000, admission refusal
// watchdog_stall_exceeds_wall, byte-stable runtime disclosure). D2 closes the re-arm set to
// four worker-observable kinds (approval.resolved, decision.settled, lifecycle.turn_started,
// question.answered — the frozen ACTUAL-sorted literal), kills the any-event re-arm, and adds
// the in-flight-turn liveness gate (blk-5: no bound fires on elapsed time without an evidence
// check). D3 gives a null-deadline blocking question a bounded deployment default entering the
// EXISTING _sweepDeadlines (escalate, never reap, never close; operator ack/claim extends; a
// late answer still lands). D4 is the kill ladder (escalate → claim/nudge → reap, receipted,
// never mid-turn, per-stall-LIFETIME dedup).
//
// Red-first: every RED row fails at a NAMED stage against the PRE-implementation tree and goes
// green on the v1.1 implementation ONLY; every PIN row is green today AND green under the
// correct implementation, but fails a plausible WRONG one (the pin list names what each pin
// kills). Harness idiom mirrors test/issue10-waiting-vocabulary-red.test.mjs (ScriptableAdapter
// coordinator harness + createDriver/BatonApplication harness). Hermetic: mock adapters, tmp
// dirs, test.after cleanup, no network, no NUL-bearing file reads. Real timers drive the
// watchdog exactly as production does; test-side Date.now() is harness timeouts only (SUITE LAW:
// no row asserts a wall-clock behavior of the fleet).
//
// ===========================================================================
// ROW INVENTORY (the split at the bottom was measured against the PRE-implementation tree)
// ===========================================================================
//
// §A D1 — decoupling + admission + disclosure (SW-01, SW-11, SW-12)
//   A1  DEFAULT_WATCHDOG  a separately-frozen deployment constant: stallMs = 20 min,
//       blockingInteractionTimeoutMs = 20 min, stallAction 'escalate', strictly smaller than
//       the wall (DEFAULT_BUDGET.wallMin * 60_000 = 480 min). (RED:
//       stage[DEFAULT_WATCHDOG-missing])
//   A2  ≥wall   createDriver({watchdog:{stallMs:500*60_000}}) refuses
//       watchdog_stall_exceeds_wall at the deployment seam. (RED:
//       stage[stall-exceeds-wall-admission-missing])
//   A3  ≤0      createDriver({watchdog:{stallMs:0}}) refuses the same code. (RED:
//       stage[stall-nonpositive-admission-missing])
//   A4  non-int createDriver({watchdog:{stallMs:1.5}}) refuses the same code. (RED:
//       stage[stall-noninteger-admission-missing])
//   A5  disclosure  the run status surface carries watchdog {stallMs, basis
//       'no_progress_evidence', rearmKinds [ACTUAL-sorted]} — readable at runtime, not
//       comment-only. (RED: stage[watchdog-config-disclosure-missing])
//
// §B D2 — closed re-arm set + feed + actor policy (SW-03, SW-04, SW-05)
//   B1  REARM_KINDS  the frozen four-kind ACTUAL-sorted literal. (RED: stage[rearm-kinds-missing])
//   B2  chatty-idler  a stream of scratchpad notes (the MAX_SCRATCHPAD_WORKER_ENTRIES farm
//       class) buys zero re-arms — the stall fires despite the notes. (RED:
//       stage[chatty-idler-rearms])
//   B3  any-event-killed  a stream of the REAL provider-activity events — resource.provider_call,
//       content.message, resource.tokens, content.tool_call (exitCode 0 — never the loop-fired
//       exitCode≠0 shape) and content.file_edit — never re-arms; the stall fires. (RED:
//       stage[any-event-rearm-killed]) [F3: the pre-fold costume events were shallow-greenable —
//       an impl that special-cased the exact costume kinds could pass; the real event classes
//       must all be inert]
//   B4  resolutions-re-arm  a worker-stream resolution stream (question.answered) never stalls —
//       the closed set keeps the resolution kinds live. 10× event-margin on the stall window
//       (stallMs 300 / 30ms interval / ~900ms hold) so the row cannot pass on the #7 wall-clock
//       class. (PIN: kills an impl that drops the resolutions from the set) [F7]
//   B5  orchestrator-silence  a steer/nudge stream never re-arms a worker liveness — the stall
//       fires on schedule. (PIN: kills an impl that re-adds orchestrator kinds to the set — the
//       self-dealing loop stays closed)
//
// §C control-law line (blk-5 — no bound fires on elapsed time without an evidence check)
//   C1  turnInFlight-flag  a lifecycle.turn_started sets handle.turnInFlight — the per-handle
//       liveness marker. (RED: stage[in-flight-turn-gate-missing])
//   C2  in-flight-silence  a turn in flight with ZERO events for >stallMs is never declared
//       stalled — the 25-minute-compile-reap class dies. (RED: stage[in-flight-liveness-missing])
//   C3  slow-but-productive  a long in-flight turn with provider activity is never declared
//       stalled. 10× event-margin on the stall window (stallMs 300 / ~900ms hold) so the row
//       cannot pass on the #7 wall-clock class. (PIN: kills an impl that removes the in-flight
//       gate — the #55 regression) [F7]
//   C4  turn-settles  a turn that COMPLETES clears handle.turnInFlight — the zombie mirror-image
//       of the in-flight bug (a completed turn leaving the flag set would freeze liveness and
//       blind the watchdog forever). Both terminals asserted: the completed-turn path and the
//       crash-path. (RED: stage[in-flight-turn-clear-missing]) [F2]
//
// §D D3 — blocked-status escape (SW-06, SW-07, SW-08)
//   D1  null-deadline-sweep  a blocking question with deadlineAt null gets the bounded
//       DEFAULT_WATCHDOG.blockingInteractionTimeoutMs entering _sweepDeadlines; on expiry it
//       escalates (releases to working, interaction_expired reason, question.expired receipt,
//       disposition 'escalated'). (RED: stage[null-deadline-sweep-missing])
//   D2  ack-extension  the orchestrator-side claim/ack surface (coordinator.claimInteraction)
//       marks the pending interaction acknowledged-in-review; an acked interaction extends its
//       effective deadline and is skipped by the sweep. (RED:
//       stage[interaction-ack-extension-missing])
//   D3  blocked-honest  a blocked worker reads waitingOn null + blockedInteraction
//       {kind:'answer_question'}, task.status 'input_required', handle.status 'blocked'. (PIN:
//       the landed #10 vocabulary — blk-3 re-spec)
//   D4  blocked-never-killed  _armWatchdog's non-'working' refusal is retained — a blocked
//       worker is never stall-declared. (PIN: the G3 guard)
//   D5  escalation-not-a-close  an escalated blocking question stays answerable — a late
//       operator answer lands, never already_resolved. (PIN: kills the destructive
//       _expireDecision-close wrong impl)
//
// §E D4 — kill ladder (SW-02, SW-09, SW-10)
//   E1  basis  health.stall_suspected carries basis 'no_progress_evidence' — the honest claim
//       is no-evidence, never "too slow". (RED: stage[stall-basis-missing])
//   E2  escalate-first  the stall_declared attention reason lands; the stall action 'escalate'
//       never directly stops the worker. (RED: stage[stall-declared-reason-missing])
//   E3  stall-seam-cycle  a claimed stall (control.steer / control.nudge) arms the stall-seam
//       cycle — reap is last. (RED: stage[stall-seam-cycle-missing])
//   E4  claim-then-idle  a scratchpad note inside the claimed window does NOT clear the stall —
//       the stall-seam cycle answers only on a D2 REARM kind. (RED:
//       stage[stall-seam-answer-set-missing])
//   E5  lifetime-dedup  the stall-seam cycle's digest set lives on the stall LIFETIME
//       (handle.stallSeamDigestSet), not per-cycle — and it is EMPTY at declaration (a fresh
//       lifetime starts with no answered identities) and is cleared ONLY by _clearStall.
//       (RED: stage[stall-lifetime-dedup-missing]) [F5: the pre-fold row asserted shape only —
//       an empty-but-wrong-shaped set could pass; the content assertions (Set type, size 0,
//       _clearStall exists) close it]
//   E6  reap-receipts  a claimed stall whose window expires with turnInFlight === false reaps:
//       preserve-first (worktree.progress_unchanged / progress_checkpointed receipt), THEN the
//       stop receipt, THEN adapter.kill — never the reverse. (RED:
//       stage[stall-seam-cycle-missing] + stage[stall-reap-receipt-missing]) [F4-1: the pre-fold
//       rows asserted the seam EXISTS but none drove the ladder to reap; the preserve-first
//       ordering was unasserted anywhere. The never-mid-turn-reap half is unreachable by
//       construction (a mid-turn worker's cycle is answered by the turn_started REARM) — see
//       suite-fold-2.md §F4]
//   E7  stall-clear  the ONLY escape that clears the stall flag is _clearStall, called by a
//       qualifying D2 re-arm inside the claimed window — the deadlocked ladder (never clear on
//       progress) dies here. (RED: stage[stall-clear-missing]) [F4-2]
//   E8  whose-stall  a working-but-turnless worker silences into provider_stalled on the status
//       view (waitingOn.kind === 'provider_stalled', detail {workerId, action}), and a later
//       worker-actor REARM event clears it (the G9 projection). (PIN: kills an impl that severs
//       event→projection — the orchestrator would read a silently quiet worker instead of the
//       whose-stall surface) [F6]
// ===========================================================================
// INVENTED SURFACES (names + exact observable signatures the implementation must land)
// ===========================================================================
//
// 1. application-deployment.mjs DEFAULT_WATCHDOG — a new, separately-frozen deployment constant
//    {stallMs: 20*60_000, blockingInteractionTimeoutMs: 20*60_000, loopThreshold: 3,
//    loopAction: 'interrupt', stallAction: 'escalate'}; nothing in DEFAULT_BUDGET feeds it;
//    the createDriver watchdog override is { ...DEFAULT_WATCHDOG }.
// 2. coordinator.mjs REARM_KINDS — the frozen closed set of exactly the four kinds
//    ['approval.resolved','decision.settled','lifecycle.turn_started','question.answered']
//    (ACTUAL sorted order; the literal IS its own [...set].sort() result).
// 3. createDriver watchdog admission — a watchdog.stallMs ≥ the node wall timeoutMs
//    (DEFAULT_BUDGET.wallMin * 60_000), or non-positive/non-integer, refuses at the deployment
//    seam with the typed refusal 'watchdog_stall_exceeds_wall' (no silent fallback; the same
//    check re-runs at _armWatchdog for defense-in-depth).
// 4. RunView.status watchdog field — {stallMs, basis: 'no_progress_evidence',
//    rearmKinds: [ACTUAL-sorted]}, byte-stable, readable on the deployment/run status surface.
// 5. handle.turnInFlight — per-handle liveness marker, set true on lifecycle.turn_started,
//    cleared at the turn-terminal seam (turn_completed AND the crash terminal), never at a
//    non-terminal event; gates the D1 timer and rung-3 reap. [F2: the mirror-image is that a
//    settled turn MUST clear it — the zombie flag would hold liveness forever]
// 6. coordinator._armStallCycle(handle, task, {nudgeId, controlId}) — the stall-seam seam armed
//    on control.steer / control.nudge; record {kind:'stall_seam', ..., answered:false,
//    basis:'no_progress_evidence', lifetime}; working-compatible expiry on
//    _progressNudgeWindowMs ?? 300_000.
// 7. handle.stallSeamDigestSet — the per-stall-LIFETIME digest Set, EMPTY at declaration,
//    cleared ONLY by _clearStall on a qualifying D2 re-arm inside the window.
// 8. coordinator.claimInteraction(requestId, {actor}) — the claim_turn-shape ack on the pending
//    interaction / attention reason; an acknowledged interaction extends its effective deadline
//    by blockingInteractionTimeoutMs and is skipped by the sweep.
// 9. _sweepDeadlines question branch — a blocking question record with deadlineAt null gets
//    effectiveDeadlineAt = record.deadlineAt ?? record.mintedAt + blockingInteractionTimeoutMs
//    (record gains mintedAt at mint); on expiry mint interaction_expired, release to working,
//    receipt question.expired {resolution:{disposition:'escalated'}}; record stays pending.
// 10. coordinator._clearStall(handle) — the stall flag + digest-set escape hatch, called ONLY by
//    a qualifying D2 re-arm inside the claimed window; NOT called by any other event. [F4-2,
//    F5]
//
// ===========================================================================
// PIN LIST (green today, green under the correct impl; the wrong impl each kills)
// ===========================================================================
//
// - B4 resolutions re-arm — kills an impl that drops the resolution kinds from REARM_KINDS.
// - B5 orchestrator silence — kills an impl that re-adds control.steer/control.nudge to
//   REARM_KINDS (the self-dealing loop stays closed).
// - C3 slow-but-productive — kills an impl that removes the in-flight-turn liveness gate
//   (the #55 regression / the 25-minute-compile-reap class).
// - D3 blocked-honest — the landed #10 vocabulary: waitingOn null + blockedInteraction.
// - D4 blocked-never-killed — the G3 non-'working' refusal is retained.
// - D5 escalation-not-a-close — a late answer lands, never already_resolved.
// - E8 whose-stall — kills an impl that severs health.stall_suspected → the status view's
//   provider_stalled projection (the orchestrator would read a silently quiet worker instead of
//   the whose-stall surface). [F6]
//
// ===========================================================================
// VERIFIED SPLIT — recorded against the PRE-implementation tree on 2026-08-07
// (node --test impl/test/stall-watchdog-red.test.mjs, repo root):
//
//   27 tests — 20 RED rows FAIL, 7 PINs PASS.
//   RED rows: each fails at its NAMED stage (the inventory above); none fails at a PIN
//   assertion or a fixture error. PINs PASS: B4, B5, C3, D3, D4, D5, E8.
//   Stable across two consecutive runs: run 1 = 20 fail / 7 pass (19.8s);
//   run 2 = 20 fail / 7 pass (18.1s).
// ===========================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { BatonApplication, createDriver } from '../src/index.mjs';

// Namespace imports for the invented surfaces (SUITE LAW): the rows must fail at a NAMED stage,
// so each invented export is probed through its namespace and the FIRST assertion on it is an
// `assert.ok(...)` — never a shape assertion that `Object.isFrozen(undefined) === true` could
// spuriously satisfy.
import * as deploymentNs from '../src/application-deployment.mjs';
import * as coordinatorNs from '../src/coordinator.mjs';

const REPO_ID = 'repo-stall-watchdog';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const REARM_KINDS_SORTED = Object.freeze([
  'approval.resolved', 'decision.settled', 'lifecycle.turn_started', 'question.answered',
]);
const WALL_MIN_MS = 480 * 60_000; // DEFAULT_BUDGET.wallMin * 60_000 (G1) — the node wall the stall budget must stay strictly under
const WAVE_OWNER = Object.freeze({ principalId: 'wave-owner', sessionId: 'wave-owner-session', actor: 'orchestrator' });

// ---------------------------------------------------------------------------
// Shared constants / fixtures (issue10 idiom)
// ---------------------------------------------------------------------------

function principal(id) {
  return Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-stall-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'stall@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Stall Watchdog Test'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536, requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID,
  definitionOfDone: ['the change is verified'], constraints: [], risk: 'low',
  goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'], verification, routes: [ROUTE], capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

// ---------------------------------------------------------------------------
// Coordinator harness (ScriptableAdapter + fake worktrees — trust-gate idiom)
// ---------------------------------------------------------------------------

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-stall-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

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

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
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

function setup({ adapter, worktreesOverrides = {}, coordinatorOpts = {} }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const coordination = coordinationForLog(log);
  const baseWorktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture: async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] }),
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const worktrees = { ...baseWorktrees, ...worktreesOverrides };
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
    progressNudgeWindowMs: 25,
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees, coordination };
}

async function flush(times = 40) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function emitTurnStarted(adapter, handle, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_started', actor: 'worker',
    payload: {},
  });
}

function emitTurnCompleted(adapter, handle, workerResult, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: workerResult,
  });
}

function emitScratchWrite(adapter, handle, key, text) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'scratchpad.write', actor: 'worker',
    payload: { entry: { kind: 'note', text }, expectedFence: 'current', idempotencyKey: key },
  });
}

function emitQuestionAsked(adapter, handle, requestId, question, blocking) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId, question, blocking },
  });
}

function emitContentMessage(adapter, handle, text) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'content.message', actor: 'worker',
    payload: { text },
  });
}

function emitProviderCall(adapter, handle, callId) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'resource.provider_call', actor: 'worker',
    payload: { callId, phase: 'started', threadId: `thread-${handle.id}`, turnId: `turn-${handle.id}-1` },
  });
}

// Poll the worker's ledger for health.stall_suspected; returns the event or null after timeoutMs.
// Test-side Date.now() is a harness timeout, never an assertion on the fleet's wall clock.
async function findStall(coordinator, workerId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = coordinator._log.read(workerId);
    const s = events.find((e) => e.kind === 'health.stall_suspected');
    if (s) return s;
    if (Date.now() > deadline) return null;
    await sleep(15);
  }
}
async function stallSuspicion(coordinator, handle) {
  return findStall(coordinator, handle.id, 2000);
}

// ---------------------------------------------------------------------------
// Application harness (createDriver + BatonApplication — issue10 idiom)
// ---------------------------------------------------------------------------

function markerAdapter(scenariosByMarker, { concurrencyCeiling } = {}) {
  const value = new MockAdapter({
    harness: 'mock',
    ...(concurrencyCeiling ? { concurrencyCeiling } : {}),
    scenario: scenariosByMarker.default ?? { outcome: 'completed' },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'stall-watchdog-test', refreshedAt: null,
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  value.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return value;
}

// The F6 whose-stall subject: a worker that NEVER auto-enters a turn. The spawn ack lands (and
// the driver's worktree ownership handshake completes through `worktreeReady`), but no
// `lifecycle.turn_started` is ever emitted — so the watchdog fires on silence at HEAD AND under
// the correct impl (the in-flight-turn gate protects only a worker whose flag is SET; a turnless
// working worker is the honest provider_stalled subject).
function silentWorkerAdapter() {
  const adapter = new ScriptableAdapter();
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'stall-watchdog-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = async (worker, brief, options) => {
    if (options?.worktreeReady) await options.worktreeReady;
    return nativeSpawn(worker, brief, options);
  };
  return adapter;
}

function harnessApp(t, adapter, createOpts = {}) {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-stall-log-'));
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir, adapters: { mock: adapter },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
    ...createOpts,
  });
  const application = new BatonApplication({
    driver, repoId: REPO_ID,
    profiles: { standard: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principal('shutdown')); } catch { /* best-effort teardown */ }
    try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, driver };
}

async function until(check, label, timeoutMs = 20_000, pollMs = 30) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function waitForBlockedAnswerQuestion(application, runId, owner) {
  return until(async () => {
    const view = await application.status(runId, owner);
    return view.blockedInteraction?.kind === 'answer_question' ? view : null;
  }, 'run never surfaced a pending answer_question blockedInteraction');
}

// createDriver admission seam: build a valid driver config, attempt the create, release the
// writer lease on success, and return the refusal error (null when the driver constructs).
function admissionRefusal(overrides = {}) {
  const repo = repository();
  const logDir = tmpDir();
  dirs.push(repo, logDir);
  let driver = null;
  let error = null;
  try {
    driver = createDriver({
      repoRoot: repo, repoId: REPO_ID, logDir,
      adapters: { mock: new MockAdapter({ scenario: { outcome: 'completed' } }) },
      goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
      stopDeadlineMs: 2_000,
      ...overrides,
    });
  } catch (err) {
    error = err;
  }
  if (driver) {
    try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ }
  }
  return error;
}

// ===========================================================================
// §A — D1: decoupling, admission, disclosure (SW-01, SW-11, SW-12)
// ===========================================================================

test('A1 SW-01 (RED): DEFAULT_WATCHDOG is a separately-frozen deployment constant strictly smaller than the wall', () => {
  assert.ok(deploymentNs.DEFAULT_WATCHDOG,
    'stage[DEFAULT_WATCHDOG-missing]: the deployment must export the new separately-frozen DEFAULT_WATCHDOG (application-deployment.mjs, replacing the :1920 wall-derived override)');
  assert.ok(Object.isFrozen(deploymentNs.DEFAULT_WATCHDOG),
    'stage[DEFAULT_WATCHDOG-missing]: DEFAULT_WATCHDOG is frozen — frozen separately from DEFAULT_BUDGET, nothing in the wall feeds it');
  assert.equal(deploymentNs.DEFAULT_WATCHDOG.stallMs, 20 * 60_000,
    'stage[DEFAULT_WATCHDOG-missing]: stallMs = 20 min — the wave-driver\'s provider-stall outer backstop, one coherent stall vocabulary');
  assert.equal(deploymentNs.DEFAULT_WATCHDOG.blockingInteractionTimeoutMs, 20 * 60_000,
    'stage[DEFAULT_WATCHDOG-missing]: blockingInteractionTimeoutMs = 20 min — the null-deadline default for blocking interactions (D3)');
  assert.equal(deploymentNs.DEFAULT_WATCHDOG.stallAction, 'escalate',
    'stage[DEFAULT_WATCHDOG-missing]: the stall action is escalate, never a direct stop (D4 rung 1)');
  assert.ok(deploymentNs.DEFAULT_WATCHDOG.stallMs < WALL_MIN_MS,
    'the stall budget (20 min) is strictly smaller than the wall budget (480 min) — the bound can actually fire before the wall ends');
});

test('A2 SW-11 (RED): a stallMs at/above the node wall refuses at admission with watchdog_stall_exceeds_wall', () => {
  const error = admissionRefusal({ watchdog: { stallMs: 500 * 60_000 } });
  assert.ok(error,
    'stage[stall-exceeds-wall-admission-missing]: a misconfigured watchdog.stallMs >= the wall timeoutMs must refuse at the deployment seam (today the driver constructs and the bound can never fire)');
  assert.equal(error?.code, 'watchdog_stall_exceeds_wall',
    'stage[stall-exceeds-wall-admission-missing]: the typed refusal code — no silent fallback');
});

test('A3 SW-11 (RED): a non-positive stallMs refuses at admission with watchdog_stall_exceeds_wall', () => {
  const error = admissionRefusal({ watchdog: { stallMs: 0 } }); // A3 pins this value as a typed refusal
  assert.ok(error,
    'stage[stall-nonpositive-admission-missing]: a watchdog.stallMs of 0 (never-armed watchdog) must refuse at the deployment seam');
  assert.equal(error?.code, 'watchdog_stall_exceeds_wall',
    'stage[stall-nonpositive-admission-missing]: the typed refusal code');
});

test('A4 SW-11 (RED): a non-integer stallMs refuses at admission with watchdog_stall_exceeds_wall', () => {
  const error = admissionRefusal({ watchdog: { stallMs: 1.5 } });
  assert.ok(error,
    'stage[stall-noninteger-admission-missing]: a fractional watchdog.stallMs must refuse at the deployment seam — the window is measured in whole milliseconds');
  assert.equal(error?.code, 'watchdog_stall_exceeds_wall',
    'stage[stall-noninteger-admission-missing]: the typed refusal code');
});

test('A5 SW-12 (RED): the resolved watchdog config is disclosed byte-stable on the run status surface', async (t) => {
  const adapter = markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 2500 }] },
  });
  const { application } = harnessApp(t, adapter, { watchdog: { stallMs: 60, stallAction: 'escalate' } });
  const owner = principal('owner');
  const started = await application.start({ objective: 'SW-12 (marker:slow): disclosure', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const view = await application.status(started.runId, owner);
  assert.ok(view.watchdog,
    'stage[watchdog-config-disclosure-missing]: the run status must disclose the resolved watchdog config at runtime — not source-comment-only');
  assert.equal(view.watchdog.basis, 'no_progress_evidence',
    'stage[watchdog-config-disclosure-missing]: the honest basis — the knob measures no-progress evidence, never speed');
  assert.deepEqual(view.watchdog.rearmKinds, [...REARM_KINDS_SORTED],
    'stage[watchdog-config-disclosure-missing]: the closed REARM set in ACTUAL sorted order');
  assert.ok(Number.isSafeInteger(view.watchdog.stallMs) && view.watchdog.stallMs > 0,
    'stage[watchdog-config-disclosure-missing]: the resolved stall window');
});

// ===========================================================================
// §B — D2: closed re-arm set + feed + actor policy (SW-03, SW-04, SW-05)
// ===========================================================================

test('B1 SW-04 (RED): REARM_KINDS is the frozen closed four-kind set in ACTUAL sorted order', () => {
  assert.ok(coordinatorNs.REARM_KINDS,
    'stage[rearm-kinds-missing]: the closed re-arm set must be exported from the coordinator');
  assert.ok(Object.isFrozen(coordinatorNs.REARM_KINDS),
    'stage[rearm-kinds-missing]: the set is frozen — closed, never grown silently');
  const values = [...coordinatorNs.REARM_KINDS];
  assert.deepEqual(values, [...REARM_KINDS_SORTED],
    'stage[rearm-kinds-missing]: exactly the four closed kinds — a turn boundary and the three resolution kinds, nothing else');
  assert.ok(values.every((k) => typeof k === 'string' && k.length > 0),
    'every kind is a non-empty string');
});

test('B2 SW-05 (RED): a scratchpad-note stream (the chatty-idler farm class) buys zero re-arms — the stall fires despite the notes', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  // 128 one-char notes is the MAX_SCRATCHPAD_WORKER_ENTRIES farm cap (coordination-store.mjs:496);
  // this test exercises the class continuously — notes every 30ms for 400ms ≫ the 60ms window.
  let n = 0;
  const stop = setInterval(() => { n += 1; emitScratchWrite(adapter, handle, `note-${n}`, 'x'); }, 30);
  let suspicion;
  try {
    suspicion = await findStall(coordinator, handle.id, 400);
  } finally {
    clearInterval(stop);
  }
  assert.ok(suspicion,
    'stage[chatty-idler-rearms]: a one-char scratchpad note is not progress evidence — the stall must fire despite the note stream');
});

test('B3 SW-03 (RED): a heartbeat/tokens/provider-call stream never re-arms — the any-event re-arm is killed', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  // F3: the any-event stream carries the REAL work-evidence events the D2 fold removes —
  // content.tool_call (a tool call proves the worker is doing something) and an in-scope
  // content.file_edit (an edit proves progress). The evidence costume must fail: an impl that
  // keeps the any-event re-arm but restricts it to "real work" events passes the old stream.
  // The tool_call carries exitCode: 0 (the loopThreshold detector stays quiet) and the file_edit
  // is in-scope (pathScope ['.'] → the scope-orientation branch continues, no scope_violation).
  let n = 0;
  const stop = setInterval(() => {
    n += 1;
    if (n % 5 === 1) emitProviderCall(adapter, handle, `call-${n}`);
    else if (n % 5 === 2) emitContentMessage(adapter, handle, `heartbeat-${n}`);
    else if (n % 5 === 3) adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'resource.tokens', actor: 'worker',
      payload: { usage: { inputTokens: 1, outputTokens: 1 } },
    });
    else if (n % 5 === 4) adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'content.tool_call', actor: 'worker',
      payload: { command: 'git status', status: 'completed', exitCode: 0, callId: `b3:tc-${n}`, threadId: `thread-${handle.id}`, turnId: `turn-${handle.id}-1` },
    });
    else adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'content.file_edit', actor: 'worker',
      payload: { path: 'out.txt' },
    });
  }, 30);
  let suspicion;
  try {
    suspicion = await findStall(coordinator, handle.id, 400);
  } finally {
    clearInterval(stop);
  }
  assert.ok(suspicion,
    'stage[any-event-rearm-killed]: heartbeats/provider-calls/tokens are not in the closed set — the stall fires on schedule');
});

test('B4 (PIN): a worker-stream resolution stream never stalls — the closed set keeps the resolution kinds live', async () => {
  const adapter = new ScriptableAdapter();
  // F7: the must-not-stall margin is re-based off event ordering, never a 2× wall margin (the
  // #7 load-flake class). stallMs 300 with a 30ms interval is a 10× margin; the ~900ms hold
  // spans three full windows. Under load a busy CI can gap the interval — a 10× margin makes
  // the watchdog staying behind the stream the overwhelming outcome while keeping real timers.
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 300, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  let n = 0;
  const stop = setInterval(() => {
    n += 1;
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.answered', actor: 'worker',
      payload: { requestId: `b4:q${n}`, answer: 'x' },
    });
  }, 30);
  let suspicion;
  try {
    suspicion = await findStall(coordinator, handle.id, 900);
  } finally {
    clearInterval(stop);
  }
  assert.equal(suspicion, null,
    'a worker resolving on the worker observation stream re-arms (the closed set keeps the resolutions live)');
});

test('B5 (PIN): an orchestrator steer/nudge stream never re-arms a worker liveness — the stall fires on schedule', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  let n = 0;
  const stop = setInterval(() => {
    n += 1;
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1,
      kind: n % 2 ? 'control.steer' : 'control.nudge', actor: 'orchestrator',
      payload: { message: `claim-${n}` },
    });
  }, 30);
  let suspicion;
  try {
    suspicion = await findStall(coordinator, handle.id, 400);
  } finally {
    clearInterval(stop);
  }
  assert.ok(suspicion,
    'orchestrator/policy kinds never re-arm a worker liveness — the self-dealing loop stays closed');
});

// ===========================================================================
// §C — control-law line (blk-5: no bound fires on elapsed time without an evidence check)
// ===========================================================================

test('C1 (RED): a lifecycle.turn_started sets handle.turnInFlight — the per-handle liveness marker', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnStarted(adapter, handle);
  await flush(60);
  const raw = coordinator._workers.get(handle.id);
  assert.equal(raw.turnInFlight, true,
    'stage[in-flight-turn-gate-missing]: a turn in flight is the turn system\'s own progress unit — the liveness marker must exist');
});

test('C2 (RED): a turn in flight with ZERO events for >stallMs is never declared stalled', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnStarted(adapter, handle);
  // Silence for 400ms ≫ 60ms: the timer fires but the in-flight gate re-arms WITHOUT declaring.
  const suspicion = await findStall(coordinator, handle.id, 400);
  assert.equal(suspicion, null,
    'stage[in-flight-liveness-missing]: a 20-minute compile is not a stall — no bound fires on elapsed time without an evidence check');
});

test('C3 (PIN): a slow-but-productive worker — a long in-flight turn with provider activity — is never declared stalled', async () => {
  const adapter = new ScriptableAdapter();
  // F7: same 10× margin re-base as B4 — stallMs 300 / 30ms interval / ~900ms hold.
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 300, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnStarted(adapter, handle);
  let n = 0;
  const stop = setInterval(() => { n += 1; emitProviderCall(adapter, handle, `call-${n}`); }, 30);
  let suspicion;
  try {
    suspicion = await findStall(coordinator, handle.id, 900);
  } finally {
    clearInterval(stop);
  }
  assert.equal(suspicion, null,
    'a slow-but-productive worker is never declared stalled (the in-flight gate + activity hold)');
});

test('C4 (RED): a turn that settles clears turnInFlight — the zombie mirror of the stall bug dies here', async () => {
  // F2: the suite only ever observed turn_started (C1/C2/C3) — never the turn-terminal clear
  // path. A wrong impl that sets turnInFlight = true on turn_started and NEVER clears it passes
  // C1/C2/C3 (a zombie turn holding liveness forever) and makes rung-3 reap impossible. This row
  // pins the clear at the turn-terminal seam. progressNudgeWindowMs is widened so the pausable
  // card's pause-hold steering cycle never expires mid-row (it would otherwise run the trust
  // gate and terminalize the task — orthogonal to the flag-clear being pinned).
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({
    adapter,
    coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' }, progressNudgeWindowMs: 60_000 },
  });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitTurnStarted(adapter, handle);
  await flush(40);
  emitTurnCompleted(adapter, handle, { status: 'completed', summary: 'done', changes: [] });
  await flush(60);
  const raw = coordinator._workers.get(handle.id);
  assert.equal(raw.turnInFlight, false,
    'stage[in-flight-turn-clear-missing]: lifecycle.turn_completed clears turnInFlight — a zombie flag would hold liveness forever');

  // The crash terminal clears it too (D2/blk-5 pins the crash/exit paths).
  const crashAdapter = new ScriptableAdapter();
  const { coordinator: crashCoordinator } = setup({
    adapter: crashAdapter,
    coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' }, progressNudgeWindowMs: 60_000 },
  });
  const crashHandle = await crashCoordinator.spawn('mock', makeBrief());
  emitTurnStarted(crashAdapter, crashHandle);
  await flush(40);
  crashAdapter.emit({
    worker: crashHandle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.crashed', actor: 'worker',
    payload: { code: 'provider_crashed' },
  });
  await flush(60);
  const crashed = crashCoordinator._workers.get(crashHandle.id);
  assert.equal(crashed.turnInFlight, false,
    'stage[in-flight-turn-clear-missing]: the lifecycle.crashed terminal clears turnInFlight too');
});

// ===========================================================================
// §D — D3: blocked-status escape (SW-06, SW-07, SW-08)
// ===========================================================================

test('D1 SW-08 (RED): a null-deadline blocking question gets a bounded default; expiry escalates, releases, never closes', async () => {
  const clock = { now: 0 };
  const adapter = new ScriptableAdapter();
  // F1 fixture contract: a VALID positive stallMs — never 0 (A3 brands stallMs:0 a typed
  // refusal at the deployment seam). The sweep is driven through the injected now()/tick() seam;
  // the worker is blocked the whole window, so _armWatchdog's non-'working' refusal keeps the
  // watchdog silent regardless of the value. stallAction 'escalate' is the contract's D1 action —
  // never 'none' (an invented value outside the action vocabulary, removed per F1).
  const { coordinator } = setup({
    adapter,
    coordinatorOpts: { now: () => clock.now, watchdog: { stallMs: 100, blockingInteractionTimeoutMs: 60, stallAction: 'escalate' } },
  });
  const handle = await coordinator.spawn('mock', makeBrief());
  const requestId = 'd1:blocking-question';
  emitQuestionAsked(adapter, handle, requestId, 'approve this?', true);
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.equal(task.status, 'input_required', 'PIN: the blocking question parks the task');
  const raw = coordinator._workers.get(handle.id);
  assert.equal(raw.status, 'blocked', 'PIN: the worker is blocked');

  clock.now = 100; // well past the effective deadline (0 + 60)
  coordinator.tick();

  assert.equal(raw.status, 'working',
    'stage[null-deadline-sweep-missing]: on expiry the worker is released to working — never reaped, never closed');
  assert.equal(task.status, 'working',
    'stage[null-deadline-sweep-missing]: the task returns to working');
  const expired = coordinator._log.read(handle.id).find((e) => e.kind === 'question.expired');
  assert.ok(expired,
    'stage[null-deadline-sweep-missing]: the escalation is receipted as question.expired');
  assert.equal(expired.payload?.resolution?.disposition, 'escalated',
    'stage[null-deadline-sweep-missing]: disposition escalated — never a fabricated answer, never a close');
  const page = await coordinator.attentionFollow(
    { scope: { runId: task.runId }, targets: ['interaction_expired'] }, WAVE_OWNER);
  assert.ok(page.reasons.some((r) => r.kind === 'interaction_expired'),
    'stage[null-deadline-sweep-missing]: the interaction_expired attention reason lands in the orchestrator inbox');
});

test('D2 SW-08 (RED): an operator-acked interaction extends its effective deadline and is skipped by the sweep', async () => {
  const clock = { now: 0 };
  const adapter = new ScriptableAdapter();
  // F1 fixture contract: a VALID positive stallMs — never 0 (A3 brands stallMs:0 a typed
  // refusal at the deployment seam). The sweep is driven through the injected now()/tick() seam;
  // the worker is blocked the whole window, so _armWatchdog's non-'working' refusal keeps the
  // watchdog silent regardless of the value. stallAction 'escalate' is the contract's D1 action —
  // never 'none' (an invented value outside the action vocabulary, removed per F1).
  const { coordinator } = setup({
    adapter,
    coordinatorOpts: { now: () => clock.now, watchdog: { stallMs: 100, blockingInteractionTimeoutMs: 60, stallAction: 'escalate' } },
  });
  const handle = await coordinator.spawn('mock', makeBrief());
  const requestId = 'd2:ack-question';
  emitQuestionAsked(adapter, handle, requestId, 'approve this?', true);
  await flush(60);
  const raw = coordinator._workers.get(handle.id);
  assert.equal(raw.status, 'blocked', 'PIN: the worker is blocked');

  assert.equal(typeof coordinator.claimInteraction, 'function',
    'stage[interaction-ack-extension-missing]: the claim/ack surface (claim_turn-shape) must exist on the pending interaction');
  const ack = await coordinator.claimInteraction(requestId, { actor: 'orchestrator' });
  assert.equal(ack.ok, true,
    'stage[interaction-ack-extension-missing]: the ack is accepted');

  clock.now = 100; // past the ORIGINAL effective deadline (0 + 60)
  coordinator.tick();
  clock.now = 100 + 60 + 1; // past the original deadline PLUS the extension
  coordinator.tick();
  assert.equal(raw.status, 'blocked',
    'an acknowledged interaction is skipped by the sweep — a legitimate >window operator review is never preempted');
});

test('D3 SW-06 (PIN): a blocked worker reads honest null + blockedInteraction — never a waiting kind', async (t) => {
  const adapter = markerAdapter({
    q: { outcome: 'completed', edits: [], ask: { kind: 'question', question: 'which way?', blocking: true } },
  });
  const { application, driver } = harnessApp(t, adapter);
  const owner = principal('owner');
  const started = await application.start({ objective: 'SW-06 (marker:q): block on a question', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const view = await waitForBlockedAnswerQuestion(application, started.runId, owner);
  assert.equal(view.blockedInteraction.kind, 'answer_question',
    'the honest surface is blockedInteraction.answer_question (the landed #10 vocabulary)');
  assert.equal(view.waitingOn, null,
    'a blocked member reads honest null — blocked is never a waiting kind');
  const worker = driver.coordinator.list().find((h) => h.taskId != null);
  assert.ok(worker, 'the worker handle is readable');
  assert.equal(worker.status, 'blocked', 'handle.status = blocked');
  const task = driver.coordinator._tasks.get(worker.taskId);
  assert.equal(task.status, 'input_required', 'task.status = input_required');
});

test('D4 SW-07 (PIN): a blocked worker is never stall-declared — the G3 non-working refusal is retained', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  emitQuestionAsked(adapter, handle, 'd4:blocking', 'approve this?', true);
  await flush(60);
  const raw = coordinator._workers.get(handle.id);
  assert.equal(raw.status, 'blocked', 'PIN: the worker is blocked');
  const suspicion = await findStall(coordinator, handle.id, 250);
  assert.equal(suspicion, null,
    'a blocked worker is never stall-declared — the orchestrator owns the stall');
});

test('D5 SW-08 (PIN): an escalated blocking question stays answerable — a late operator answer lands, never already_resolved', async () => {
  const clock = { now: 0 };
  const adapter = new ScriptableAdapter();
  // F1 fixture contract: a VALID positive stallMs — never 0 (A3 brands stallMs:0 a typed
  // refusal at the deployment seam). The sweep is driven through the injected now()/tick() seam;
  // the worker is blocked the whole window, so _armWatchdog's non-'working' refusal keeps the
  // watchdog silent regardless of the value. stallAction 'escalate' is the contract's D1 action —
  // never 'none' (an invented value outside the action vocabulary, removed per F1).
  const { coordinator } = setup({
    adapter,
    coordinatorOpts: { now: () => clock.now, watchdog: { stallMs: 100, blockingInteractionTimeoutMs: 60, stallAction: 'escalate' } },
  });
  const handle = await coordinator.spawn('mock', makeBrief());
  const requestId = 'd5:late-answer';
  emitQuestionAsked(adapter, handle, requestId, 'approve this?', true);
  await flush(60);
  clock.now = 1000; // long past any effective deadline
  coordinator.tick(); // the sweep (once landed) escalates but must NOT close the record
  const late = await coordinator.respond(requestId, { text: 'do it' });
  assert.equal(late.ok, true,
    'a late operator answer lands after escalation — the record stays pending/answerable, never already_resolved');
  const raw = coordinator._workers.get(handle.id);
  assert.equal(raw.status, 'working', 'the answered worker resumes working');
});

// ===========================================================================
// §E — D4: the kill ladder (SW-02, SW-09, SW-10)
// ===========================================================================

test('E1 SW-02 (RED): the stall declaration names its basis — no_progress_evidence, never "too slow"', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  const suspicion = await stallSuspicion(coordinator, handle);
  assert.ok(suspicion, 'PIN: the stall window fires on silence');
  assert.equal(suspicion.payload?.basis, 'no_progress_evidence',
    'stage[stall-basis-missing]: the honest claim is "no evidence of progress", never "too slow"');
});

test('E2 SW-09 (RED): the ladder escalates first — the stall_declared reason lands, never a direct stop', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  const suspicion = await stallSuspicion(coordinator, handle);
  assert.ok(suspicion, 'PIN: the stall window fires');
  const task = coordinator._tasks.get(handle.taskId);
  const page = await coordinator.attentionFollow(
    { scope: { runId: task.runId }, targets: ['stall_declared'] }, WAVE_OWNER);
  assert.ok(page.reasons.some((r) => r.kind === 'stall_declared'),
    'stage[stall-declared-reason-missing]: rung 1 mints the stall_declared attention reason into the orchestrator inbox');
  assert.equal(coordinator._workers.get(handle.id).status, 'working',
    'escalate is not a stop — the worker is never directly killed');
  assert.equal(adapter.calls.kill.length, 0, 'no kill was issued');
});

test('E3 SW-10 (RED): a claimed stall (steer/nudge) arms the stall-seam cycle — reap is last', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  await stallSuspicion(coordinator, handle);
  // The orchestrator claims the stall by steering (control.steer / control.nudge arm the seam).
  try {
    await coordinator.send(handle.id, 'resume after review', 'steer',
      { actor: 'orchestrator', controlId: `control:${'a'.repeat(64)}` });
  } catch { /* the steer may be refused — the seam is what this row pins */ }
  assert.equal(typeof coordinator._armStallCycle, 'function',
    'stage[stall-seam-cycle-missing]: a claim (control.steer / control.nudge) must arm the stall-seam cycle');
});

test('E4 SW-10 (RED): claim-then-idle dies — a scratchpad note inside the claimed window does NOT clear the stall', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  await stallSuspicion(coordinator, handle);
  try {
    await coordinator.send(handle.id, 'resume after review', 'steer',
      { actor: 'orchestrator', controlId: `control:${'b'.repeat(64)}` });
  } catch { /* the steer may be refused — the seam is what this row pins */ }
  assert.equal(typeof coordinator._armStallCycle, 'function',
    'stage[stall-seam-answer-set-missing]: the stall-seam cycle must exist to be answered');
  const raw = coordinator._workers.get(handle.id);
  emitScratchWrite(adapter, handle, 'e4-note', 'one saved note');
  await flush(40);
  assert.ok(raw.watchdogActions?.has('stall'),
    'a scratchpad note never clears the stall — the ladder is not reset by TG2 evidence');
});

test('E5 SW-10 (RED): the stall-seam cycle dedups per-stall LIFETIME — handle.stallSeamDigestSet lives on the stall, not the cycle', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  await stallSuspicion(coordinator, handle);
  const raw = coordinator._workers.get(handle.id);
  // F5: E5 was existence-only — any impl could add an unused `stallSeamDigestSet = new Set()`.
  // The per-stall-LIFETIME dedup *semantics* (blk-4: one reused digest cannot answer successive
  // cycles) are pinned by (a) the empty-at-declaration content and (b) the ONLY clear path being
  // `_clearStall` on a qualifying D2 re-arm (the E7 row drives that path live). The two-cycle
  // discriminator itself is NOT implementable per the contract: _clearStall clears the digest
  // set, so a fresh stall lifetime legitimately accepts the same digest again (v1.2 note).
  assert.ok(raw.stallSeamDigestSet instanceof Set,
    'stage[stall-lifetime-dedup-missing]: the per-stall-LIFETIME digest set must live on the handle (cleared only by _clearStall on a qualifying D2 re-arm)');
  assert.equal(raw.stallSeamDigestSet.size, 0,
    'stage[stall-lifetime-dedup-missing]: the digest set is EMPTY at declaration — a fresh stall lifetime starts with no answered identities');
  assert.equal(typeof coordinator._clearStall, 'function',
    'stage[stall-lifetime-dedup-missing]: the only path that clears the digest set is _clearStall on a qualifying D2 re-arm inside the claimed window');
});

test('E6 SW-10 (RED): the claimed stall-seam cycle expires to a RECEIPTED reap — preserve-first, never mid-turn', async () => {
  const clock = { now: 0 };
  const adapter = new ScriptableAdapter();
  const HEX = 'a'.repeat(40);
  const { coordinator } = setup({
    adapter,
    worktreesOverrides: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: HEX }),
      capture: async () => ({ sha: HEX, baseSha: HEX, changedPaths: [] }),
      retainCheckpoint: async (sha) => ({ sha }),
      resolveCheckpoint: async (ref) => ref.sha,
    },
    coordinatorOpts: { now: () => clock.now, watchdog: { stallMs: 60, stallAction: 'escalate' } },
  });
  const handle = await coordinator.spawn('mock', makeBrief());
  await stallSuspicion(coordinator, handle);
  // F4: E3/E4/E5 only assert the seam EXISTS — none drives the ladder to reap. The rung-3
  // receipt trail (worktree.progress_unchanged / progress_checkpointed, then the stop receipt,
  // then adapter.kill) is asserted nowhere. This row drives: stall declared → steer claims
  // (arms the stall-seam cycle) → the claimed window expires unanswered with turnInFlight ===
  // false → preserve-first receipts, then the stop, then adapter.kill. The never-mid-turn-reap
  // half is unreachable by construction (a mid-turn worker's cycle is answered by the turn_started
  // REARM) — documented in suite-fold-2.md §F4.
  assert.equal(typeof coordinator._armStallCycle, 'function',
    'stage[stall-seam-cycle-missing]: a claim (control.steer / control.nudge) must arm the stall-seam cycle');
  try {
    await coordinator.send(handle.id, 'resume after review', 'steer',
      { actor: 'orchestrator', controlId: `control:${'a'.repeat(64)}` });
  } catch { /* the steer may be refused — the seam is what this row pins */ }
  clock.now = 100; // well past the claimed window (progressNudgeWindowMs 25)
  await sleep(80);
  coordinator.tick();
  const ledger = coordinator._log.read(handle.id);
  const progressIdx = ledger.findIndex((e) => e.kind === 'worktree.progress_unchanged' || e.kind === 'worktree.progress_checkpointed');
  const stopIdx = ledger.findIndex((e) => e.kind === 'kill.requested' || e.kind === 'control.interrupt_requested');
  assert.ok(progressIdx >= 0,
    'stage[stall-reap-receipt-missing]: rung-3 reap first preserves progress — a worktree.progress_unchanged / progress_checkpointed receipt must land before any stop');
  assert.ok(stopIdx > progressIdx,
    'stage[stall-reap-receipt-missing]: preserve-first ordering — the stop receipt lands AFTER the preservation receipt');
  assert.ok(adapter.calls.kill.length > 0,
    'stage[stall-reap-receipt-missing]: the reap actually stops the worker (adapter.kill)');
});

test('E7 SW-10 (RED): a qualifying D2 re-arm inside the claimed window calls _clearStall — the ladder has a reachable escape hatch', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, coordinatorOpts: { watchdog: { stallMs: 60, stallAction: 'escalate' } } });
  const handle = await coordinator.spawn('mock', makeBrief());
  await stallSuspicion(coordinator, handle);
  try {
    await coordinator.send(handle.id, 'resume after review', 'steer',
      { actor: 'orchestrator', controlId: `control:${'b'.repeat(64)}` });
  } catch { /* the steer may be refused — the seam is what this row pins */ }
  assert.equal(typeof coordinator._clearStall, 'function',
    'stage[stall-clear-missing]: the ONLY escape that clears the stall flag is _clearStall, called by a qualifying D2 re-arm inside the claimed window');
  const raw = coordinator._workers.get(handle.id);
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.answered', actor: 'worker',
    payload: { requestId: 'e7:answer', answer: 'x' },
  });
  await flush(40);
  assert.equal(raw.watchdogActions?.has('stall'), false,
    'stage[stall-clear-missing]: a qualifying D2 re-arm clears the stall flag — the deadlocked ladder (never clear on progress) dies here');
  assert.ok(raw.stallSeamDigestSet instanceof Set && raw.stallSeamDigestSet.size === 0,
    'stage[stall-clear-missing]: _clearStall clears the digest set with the flag');
  assert.equal(adapter.calls.kill.length, 0,
    'stage[stall-clear-missing]: a clear is not a reap — the worker is never stopped');
});

test('E8 SW-02 (PIN): the stalled worker reads waitingOn.provider_stalled — and a later worker-actor REARM clears it', async (t) => {
  // F6: E1 asserts the stall basis on the ledger event, but no row asserts the who's-stall
  // surface — the status view's `waitingOn: {kind: 'provider_stalled'}` projection (G9). The
  // projection exists at HEAD, so the correct impl gets it for free; this PIN kills a wrong impl
  // that severs event→projection (minting the stall outside the ledger surface the projection
  // reads) — the orchestrator would see a silently quiet worker instead of provider_stalled.
  const adapter = silentWorkerAdapter();
  const { application, driver } = harnessApp(t, adapter, { watchdog: { stallMs: 1000, stallAction: 'escalate' } });
  const owner = principal('owner');
  const started = await application.start({ objective: 'SW-02 (silent): whose-stall provider_stalled', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const wid = await until(async () => {
    const list = driver.coordinator.list().filter((h) => h.taskId != null);
    return list.length > 0 ? list[0].id : null;
  }, 'E8: the run never dispatched a worker');
  const suspicion = await findStall(driver.coordinator, wid, 4000);
  assert.ok(suspicion,
    'PIN: a turnless working worker silences into the stall — the whose-stall subject (the silent worker never enters a turn, so the in-flight gate does not protect it)');
  const view = await application.status(started.runId, owner);
  assert.equal(view.waitingOn?.kind, 'provider_stalled',
    'the whose-stall honest surface reads provider_stalled on the status view — a wrong impl that severs event→projection leaves it null');
  assert.equal(view.waitingOn.detail.workerId, wid,
    'the stalled member is exactly the working-but-turnless worker');
  assert.equal(view.waitingOn.detail.action, 'escalate',
    'the whose-stall detail names the honest action');
  // G9: after a later worker-actor REARM event the projection clears (no later worker-actor
  // event). The REARM stream (every 100ms ≪ stallMs 1000) keeps the watchdog re-armed at HEAD,
  // so the clear holds without a wall-clock race (the #7 class).
  const stop = setInterval(() => adapter.emit({
    worker: wid, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_started', actor: 'worker', payload: {},
  }), 100);
  try {
    await until(async () => {
      const v = await application.status(started.runId, owner);
      return v.waitingOn == null ? v : null;
    }, 'E8: the projection never cleared after a worker-actor REARM event', 3000);
  } finally {
    clearInterval(stop);
  }
});
