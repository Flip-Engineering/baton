// Claim-time liveness preflight red suite (contract: docs/reference/evidence/
// claim-preflight-2026-08-03/claim-preflight-contract.md v1.1 — issue #88; red-team fold:
// contract-redteam.md + contract-fold.md, same directory; blue-team fold: suite-blueteam.md
// + suite-fold.md, same directory — the two set-closure blockers folded as T18m/T18n and
// T18a/T18v below).
//
// Thirty rows over the folded decisions: CP1's insertion ordering (preflight BEFORE the
// steering-timer clear; rollback-on-throw with `resolving` always released; the swallowed-
// expiry `expiryPending` re-check); CP2's exact gate mirror (fresh capture with gate-identical
// kwargs, sessionContext baseSha derivation, in-scope filter); CP3's CLOSED counted-liveness
// set (ok:true hub receipts, governance/watchdog-observed worker content, resolved
// interactions — failed receipts, pending interactions, board.claim_result and lifecycle
// markers never count); CP4's pause-epoch window (epoch AND seq bounds); CP6's typed
// rollback-clean claimable-later refusal; CP9's honest-registry flip; CP8's wave-driver
// composition (per-pauseId claim attempts, a COUNTED corrective-nudge budget
// `refusalNudgeBudget: 2` consumed on delivery, exhaustion → record-only → the driver's
// PRE-EXISTING stall clock reaps); CP10's untouched silent-worker path.
//
// Red-first: written against the v1.1 contract BEFORE implementation. Every RED row fails
// for the named stage and goes green on the contract's implementation ONLY; every PIN row is
// green today AND green under the correct implementation, but fails a plausible WRONG one
// (the pin list below names the wrong implementation each pin kills). Coordinator harness
// mirrors test/trust-gate-steering-red.test.mjs:51-128 (ScriptableAdapter + fake worktrees);
// wave-driver harness mirrors test/bidirectional-driver-red.test.mjs:1028-1111 (the
// deterministic fake wave facade — no live providers).
//
// ===========================================================================
// ROW INVENTORY (stage named per row; the split recorded at the bottom was measured
// against the PRE-implementation tree — md5(impl/src/coordinator.mjs) 8e42ead5d5dc565bcbf84398a6ceceaa)
// ===========================================================================
//
// §A The #88 receipt restaged (stage: claim-preflight-missing)
//   T18   headline — 5 read-only tool_calls + 3 analysis messages + 1 planted FAILED
//         scratchpad receipt in epoch 1, diffless pause, driver registered: claim RETURNS
//         {ok:false, result:'claim_premature_liveness'}; worker ALIVE; record pending /
//         consumer null; ZERO claim-attributable events; concurrent re-claim not poisoned;
//         capture spy proves gate-identical kwargs; a later claim after an in-scope diff is
//         claimed → completed. (RED: today the claim gate-kills and THROWS
//         required_effect_absent.)
//   T18e  null-sha edge — capture {sha:null, baseSha:null} is diffless under the five-way
//         test's !sha || !baseSha arm → refused, never a silent pass. (RED)
//
// §B The counted set + the pause-epoch window (CP3/CP4/CP5/CP7)
//   T18w  scratchpad.write_result {ok:true} counts (hub receipt) (RED)
//   T18r  context.read_result {ok:true} counts (hub receipt) (RED)
//   T18p  resource.provider_call actor worker counts (governance accounting) (RED)
//   T18m  worker analysis content.message counts as the pause's SOLE liveness — the
//         messages-only pause refuses (blue-team BLOCKER 1: T18 plants the class beside 5
//         tool_calls, so an implementation omitting CP3.4 greened all rows; now the class
//         is load-bearing in both directions — this row plus the T18n removal control) (RED)
//   T18q  a question RESOLVED inside the window counts (resolution-gated) (RED)
//   T18a  an approval RESOLVED inside the window counts (approval.resolved as the pause's
//         SOLE liveness — blue-team BLOCKER 2 sibling row, the T18q idiom extended) (RED)
//   T18v  a decision SETTLED inside the window counts (decision.settled as the pause's
//         SOLE liveness — BLOCKER 2 sibling row; v1 decisions are always blocking and
//         deadline-bound, respond() settles in-window before the turn ends) (RED)
//   T18b  PIN — #64 control: silent diffless drivered claim dies required_effect_absent
//         (kills the "lifecycle markers count" shallow: the fixture emits turn_completed
//         and nothing else, so counting it greens a refusal here)
//   T18n  PIN — the T18m removal control: the SAME pause with the content.message events
//         REMOVED dies by the full gate (staging byte-identical to T18b's silent fixture,
//         kept as the named other half of the content.message pair; kills an
//         implementation that refuses a diffless pause regardless of liveness content)
//   T18d  PIN — stale-epoch exclusion: epoch-1 liveness never counts toward an epoch-2
//         pause (kills the whole-stream reader with no epoch restriction — the anti-stale
//         law's only pin; green today because NO preflight exists)
//   T18s  PIN — seq bound: a scratchpad receipt minted AFTER the pause (same epoch — the
//         emulated up-channel carries the worker's own epoch — seq > mintedEvent) never
//         counts (kills the epoch-only reader; a paused worker's stream CAN still grow
//         same-epoch hub receipts, so the bound is load-bearing, not decorative)
//   T18x  PIN — CP7 exclusion: a board.claim_result buys nothing (kills broadening the
//         closed set to post-memo receipt classes; the planted receipt is the ok:false
//         variant — an ok:true fixture needs the #78 grant machinery, noted in the header
//         handoff)
//   T18y  PIN — failed receipts (write stale_fence ok:false, read invalid ok:false) never
//         count (kills the ok-blind receipt counter)
//   T18z  PIN — a PENDING interaction buys nothing (kills counting unresolved interactions)
//
// §C Insertion ordering + the error path (CP1)
//   T18h  a refused claim on a cycle-armed record leaves the cycle ARMED — the timer is
//         still pending after the refusal and the ordinary expiry lands the full gate WITH
//         the steering receipt (insertion BEFORE _clearSteeringTimer; kills the memo-order
//         insertion) (RED)
//   T18g  swallowed-expiry re-check: the window fires DURING the preflight's capture await
//         (reservation guard skips, sets expiryPending) → the refuse path runs the expiry
//         synchronously after rollback → gate + receipt (kills the zombie-cycle residue) (RED)
//   T18c  preflight throw (capture_failed): the claim REJECTS with the typed code; record
//         pending / consumer null / resolvingDone released (a wedged-resolving wrong impl
//         fails the guarded second claim); the armed cycle stays armed; ZERO events; a
//         second claim with a healthy capture proceeds (RED)
//
// §D Mirror fidelity (CP2 — stage: shallow-mirror)
//   T18f  baseSha derives task.sessionContext?.baseSha ?? captured?.baseSha: capture
//         {sha === sessionContext.baseSha, baseSha: 'sha-foreign'} is DIFFLESS → refused
//         (kills the captured-vs-captured shallow mirror, which proceeds and gate-kills) (RED)
//   T18i  an out-of-scope diff never rescues: changedPaths non-empty but inScope empty →
//         refused (kills the no-inScope-filter shallow, which proceeds to a path_scope
//         kill) (RED)
//
// §E The honest-registry flip (CP9 — stage: registry-flag-lie)
//   CP9a  registry row: claim_turn.destructive === true, irreversible === false,
//         idempotent === true, summary names the final evaluation AND the typed refusal;
//         version stays '1.3.0' (the named version policy — the digest moves without the
//         version string) (RED on destructive/summary; the other flags + version are pins)
//   CP9b  the authority PROJECTION (the descriptor byte-source, :1888-1930 → digest :1946)
//         carries claim_turn.destructive === true (RED)
//
// §F Wave-driver composition (CP8 — stage: driver-composition-missing)
//   WD1   PIN — a claim_premature_liveness refusal is recorded on the claims evidence with
//         its code (the recording lane exists today: claimOnce maps code ← error?.code;
//         green today, kills an impl that drops/mangles the code on the corrective path)
//   WD2   exactly ONE corrective nudge for the SAME pause, exempt from the L4
//         one-nudge-per-pause dedup exactly once (the pause was ordinarily nudged pre-stall,
//         so the D9-path corrective nudge must bypass nudgedRequestIds) (RED — today:
//         policy field refusalNudgeBudget unknown → wave_driver_policy_invalid)
//   WD3   a refused corrective-nudge DELIVERY consumes NO budget (D8 symmetry), and the
//         NEXT pauseId is claimed again (per-pauseId claimAttempted — four fresh pauseIds
//         draw four claim attempts; today per-member keying stops after one) (RED)
//   WD4   budget exhaustion → honest closure: refusal recorded with NO nudge, nothing
//         settles the worker (act counts frozen), no new pauseId is claimed into existence,
//         the PRE-EXISTING stall clock fires (basis 'stall' — never a wall-clock cap; the
//         #163 law retired hardCapMs), the D9 fan-out no-ops (the per-pauseId attempt was
//         consumed), the guaranteed close reaps. Also pins the DEFAULT budget: no policy
//         field passed, exactly TWO corrective nudges. (RED)
//
// §G Exoneration pins (acceptance (c): the six non-suite claimTurn call sites' behavior
//   classes stay byte-identical)
//   X1    claim-diffed-pause class (31b5:247 / phase10:112 / bidirectional:369): a diffed
//         pause WITH counted liveness present still claims → completed (would-fire false;
//         kills a preflight that refuses on liveness alone) (PIN, green)
//   X2    no-requiredEffects-brief class (phase11:372/:379): a diffless pause WITH counted
//         liveness on a brief WITHOUT repository_edit still claims → completed (would-fire
//         false on the brief arm; kills a preflight that skips the brief check) (PIN, green)
//   X3    already_resolved class (31b:205): a nudge-resolved record refuses
//         already_resolved AT RESERVATION, before the preflight is reached — even with
//         counted liveness present (kills a preflight hoisted above the reservation) (PIN,
//         green)
//
// ===========================================================================
// INVENTED SURFACES (names + exact observable signatures the wave worker must land)
// ===========================================================================
//
// 1. Coordinator.claimTurn refusal value (CP6) — RETURNED, never thrown:
//      { ok: false, result: 'claim_premature_liveness', pauseId, taskId, workerId,
//        liveness: { <per-class counts and content digests only — TG4 sanitized: no path
//                    strings, no worker prose> },
//        reason: <fixed-shape hub text naming the nudge/wait guidance; contains 'claimable'> }
//    Rollback-clean: record pending/consumer null/resolution null, ZERO events minted, the
//    pause re-claimable (the preflight re-evaluates per attempt). A preflight THROW (e.g.
//    capture_failed) rejects with the error's own typed code after rollback() — never a
//    refusal value (CP1 error path; resolvingDone always released).
// 2. record.steering.expiryPending (CP1 swallowed-expiry flag) — set by the
//    _expireSteeringCycle reservation-guard skip; consumed by the refuse path ONLY, which
//    runs the expiry synchronously after rollback(). Observable effect pinned by T18g:
//    task failed + required_effect_absent verdict carrying the steering receipt
//    (steered.answered === false) + turn.settled {basis:'steering_expired'}.
// 3. Registry flags (CP9): application-semantics.mjs claim_turn entry
//    destructive: false → true (:516), summary reworded to name the full final evaluation
//    and the claim_premature_liveness refusal (:513); irreversible/idempotent unmoved;
//    registry version stays '1.3.0'. Observable via APPLICATION_SEMANTIC_REGISTRY.actions
//    .claim_turn and APPLICATION_DIGEST_PROJECTIONS.authority.actions.claim_turn.
// 4. Wave-driver budget surface (CP8): new policy field `refusalNudgeBudget` (integer ≥ 0,
//    DEFAULT 2, parallel to unproductiveNudgeBudget — freezePolicy must accept and validate
//    it). claimAttempted keys per pauseId (checkpoint.requestId), claimed stays per-member.
//    On claims-evidence code 'claim_premature_liveness' the driver issues exactly ONE
//    corrective nudge_turn for the SAME pause, exempt from the nudgedRequestIds (L4) dedup
//    exactly once per refusal, budget consumed on DELIVERED acknowledgment (a {ok:false,
//    result:'delivery_exception'} VALUE consumes nothing). Exhaustion: refusal recorded,
//    NO nudge; the pause pends to the driver's PRE-EXISTING stall clock → basis 'stall' →
//    the guaranteed close reaps. No new clock anywhere.
//
// Split against the pre-implementation tree (node --test, repo root): see the Verification
// comment at the bottom of this file.
//
// ===========================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { createWaveDriver } from '../src/wave-driver.mjs';
import {
  APPLICATION_SEMANTIC_REGISTRY, APPLICATION_DIGEST_PROJECTIONS,
} from '../src/application-semantics.mjs';

// ---------------------------------------------------------------------------
// Hermetic harness — mock adapter + tmp dirs + cleanup in test.after (trust-gate idiom).
// ---------------------------------------------------------------------------

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-cp88-'));
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

function setup({ capture, adapter, coordinatorOpts = {} }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
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
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25, // TG3's bounded window — small for determinism
    ...coordinatorOpts,
  });
  return { dir, log, coordinator, worktrees };
}

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });
const withDiff = async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['file-in-scope.txt'] });

// A prose canary planted in worker-authored content; TG4's law: it must NEVER appear in the
// refusal payload (counts/digests only, no worker prose).
const PROSE_CANARY = 'CANARY-7f3e-worker-prose';
const TOOL_COMMANDS = ['ls -la /repo', 'cat README.md', 'git status --short', 'rg --files docs', 'sed -n 1,40p PLAN.md'];

function emitTurnCompleted(adapter, handle, turnEpoch = 1, output = 'mid-workflow checkpoint') {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output },
  });
}

// The #88 receipt shape: read-only Bash tool calls (valid logical call ids/phases, zero
// exits — governance-clean) and analysis prose, all actor:'worker'.
function emitToolCall(adapter, handle, n, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'content.tool_call', actor: 'worker',
    payload: {
      callId: `tc-w88-${turnEpoch}-${n}`, phase: 'completed',
      command: TOOL_COMMANDS[(n - 1) % TOOL_COMMANDS.length], exitCode: 0, status: 'completed',
    },
  });
}
function emitAnalysis(adapter, handle, n, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'content.message', actor: 'worker',
    payload: { text: `analysis note ${n}: the orientation reads are done ${PROSE_CANARY}` },
  });
}
function emitScratchWriteOk(adapter, handle, key, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'scratchpad.write', actor: 'worker',
    payload: { entry: { kind: 'note', text: `recon note ${PROSE_CANARY}` }, expectedFence: 'current', idempotencyKey: key },
  });
}
function emitScratchWriteStaleFence(adapter, handle, key, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'scratchpad.write', actor: 'worker',
    payload: { entry: { kind: 'note', text: 'a write whose fence is stale' }, expectedFence: 999999, idempotencyKey: key },
  });
}
function emitContextReadOk(adapter, handle, key, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'context.read', actor: 'worker',
    payload: { query: { kind: 'knowledge', text: 'orientation probe' }, expectedFence: 'current', idempotencyKey: key },
  });
}
function emitContextReadInvalid(adapter, handle, key, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'context.read', actor: 'worker',
    payload: { query: { kind: 'knowledge', runId: 'run:foreign' }, expectedFence: 'current', idempotencyKey: key },
  });
}
function emitProviderCall(adapter, handle, key, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'resource.provider_call', actor: 'worker',
    payload: { callId: key, phase: 'completed', tokens: { input: 10, output: 5 } },
  });
}
function emitBoardClaimInvalid(adapter, handle, turnEpoch = 1) {
  // A board.claim whose closed frame is incomplete → board.claim_result {ok:false,
  // result:'board_claim_invalid'} — a post-memo receipt class that CP7 excludes.
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'board.claim', actor: 'worker',
    payload: { itemId: 'board-item-incomplete' },
  });
}
function emitQuestion(adapter, handle, requestId, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'question.asked', actor: 'worker',
    payload: { requestId, question: 'which probe should run next?', blocking: false },
  });
}
function emitApprovalRequest(adapter, handle, requestId, turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'approval.requested', actor: 'worker',
    payload: { requestId, toolName: 'Bash', input: { command: 'git push --force origin main' }, blocking: false },
  });
}
function emitDecisionRequest(adapter, handle, requestId, turnEpoch = 1) {
  // v1 decisions are always blocking and deadline-bound (F5/F6; the closed-shape check at
  // admission is createDecisionRequest's) — the request parks the task input_required until
  // respond() settles it back to working, all inside the asking epoch.
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'decision.requested', actor: 'worker',
    payload: {
      requestId,
      request: {
        question: 'which probe should run next?',
        options: [{ id: 'opt-a', label: 'continue the recon probes' }, { id: 'opt-b', label: 'stop and produce the diff' }],
        allowFreeResponse: false, recommended: null, deadlineMs: 60000,
      },
    },
  });
}

function registerDriver(coordinator, task) {
  coordinator._coordination.recordDriver('steering.registered', { runId: task.runId },
    { actor: 'orchestrator', key: `driver.recorded:steering.registered:${task.runId}` });
}

// A drivered pause staged on the T9/T17 idiom: registered driver (no TG3 cycle), the row's
// own liveness staging, then turn_completed → the pause record pends.
async function driveredPause({ adapter, capture = noDiff, brief = makeBrief(), coordinatorOpts = {}, stage = null }) {
  const { coordinator } = setup({ adapter, capture, coordinatorOpts });
  const handle = await coordinator.spawn('mock', brief);
  const task = coordinator._tasks.get(handle.taskId);
  registerDriver(coordinator, task);
  if (stage) await stage(adapter, handle, coordinator);
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused', 'the drivered pause pends for the claim');
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId, 'the pause record exists');
  return { coordinator, handle, task, pauseId };
}

const emitFiveToolCalls = (adapter, handle) => { for (let n = 1; n <= 5; n += 1) emitToolCall(adapter, handle, n); };

// claimTurn post-v1.1 RETURNS a typed refusal; today there is no refusal lane at all — a
// diffless claim runs the full gate and RETURNS its claimed envelope with outcome 'failed'
// (the gate handles the policy kill internally). Normalize all three shapes — return,
// refusal, and the throw lanes (preflight error path, application error lane) — into one
// comparable value; the assertions name the expected one.
function claimOutcome(coordinator, pauseId) {
  return coordinator.claimTurn(pauseId, { actor: 'orchestrator' })
    .then((r) => r, (error) => ({ ok: false, result: `__thrown__:${error?.code ?? 'error'}` }));
}
// A racing claim parked at the reservation's resolvingDone must re-enter after rollback —
// never hang. The guard turns a wedged-resolving wrong implementation into a named failure
// instead of a suite stall.
function claimOutcomeGuarded(coordinator, pauseId, ms = 3000) {
  return Promise.race([
    claimOutcome(coordinator, pauseId),
    sleep(ms).then(() => ({ ok: false, result: '__wedged__:resolving never released' })),
  ]);
}

const GATE_EVENT_CODES = ['forbidden_effect_observed', 'worker_path_scope_violation', 'required_effect_absent'];
function streamAfter(coordinator, handle, seq) {
  return coordinator._log.read(handle.id).filter((event) => event.seq > seq);
}
function maxSeq(coordinator, handle) {
  return coordinator._log.read(handle.id).reduce((m, event) => Math.max(m, event.seq), 0);
}
function assertWorkerAlive(coordinator, adapter, handle, label) {
  assert.equal(adapter.calls.kill.length, 0, `${label}: the live worker is never killed`);
  const status = coordinator._workers.get(handle.id)?.status;
  assert.ok(!['dead', 'stopping', 'exited'].includes(status), `${label}: the worker handle stays live (got ${status})`);
}
function assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq) {
  assert.equal(outcome?.ok, false,
    `stage[claim-preflight-missing]: the claim must RETURN a typed refusal (today it gate-kills; got ${JSON.stringify(outcome)})`);
  assert.equal(outcome?.result, 'claim_premature_liveness',
    `stage[claim-preflight-missing]: the ONE new refusal code (got ${outcome?.result})`);
  assert.equal(outcome?.pauseId, pauseId, 'the refusal carries the pauseId');
  assert.equal(outcome?.taskId, task.id, 'the refusal carries the taskId');
  assert.equal(outcome?.workerId, handle.id, 'the refusal carries the workerId');
  assert.equal(JSON.stringify(outcome ?? {}).includes(PROSE_CANARY), false,
    'TG4: the refusal carries no worker prose (counts/digests only)');
  assert.doesNotMatch(JSON.stringify(outcome?.liveness ?? {}), /\/repo|README|PLAN\.md/,
    'TG4: the liveness block carries no path strings');
  assert.match(String(outcome?.reason ?? ''), /claimable/,
    'the fixed-shape reason names the claimable-later contract');
  // Rollback honesty (acceptance d): record pending, consumer null, worker alive, ZERO events.
  const record = coordinator._pausedTurns.get(pauseId);
  assert.equal(record?.state, 'pending', 'the refusal rolls the record back to pending');
  assert.equal(record?.consumer, null, 'nothing is consumed');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused', 'the task stays paused');
  assertWorkerAlive(coordinator, adapter, handle, 'the refusal');
  assert.equal(streamAfter(coordinator, handle, preClaimSeq).length, 0,
    'a refusal mints ZERO events (no turn.settled, no gate event, no verdict, no expiry)');
}
function assertGateKill(coordinator, adapter, handle, task, outcome, label) {
  // Today's claim on a silent diffless pause runs the FULL gate, which maps
  // required_effect_absent into the policy-failure kill set INTERNALLY; claimTurn then
  // commits and returns its claimed envelope carrying the gate's verdict (outcome 'failed').
  assert.equal(outcome?.ok, true, `${label}: the claim itself succeeds — the gate's verdict is the failure`);
  assert.equal(outcome?.result, 'claimed', `${label}: the claim envelope, exactly as today`);
  assert.equal(outcome?.outcome, 'failed',
    `${label}: the full gate ran and judged required_effect_absent (no refusal intercepted the claim)`);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed', `${label}: the worker dies at the gate`);
  assert.ok(adapter.calls.kill.length >= 1, `${label}: the policy kill lands`);
  const cause = coordinator._tasks.get(handle.taskId).terminalCause ?? null;
  assert.equal(cause?.kind, 'policy_failure', `${label}: the terminal cause names the failure kind`);
  assert.equal(cause?.code, 'required_effect_absent', `${label}: the terminal cause names its gate (T11)`);
}

// The per-class rows' sole-liveness fixture check: the row's named class must be the ONLY
// CP3-counted liveness on the worker stream (otherwise the row's refusal could rest on
// another class and the named class would not be load-bearing — the BLOCKER 1 hole).
function assertNoOtherCountedLiveness(coordinator, handle, keepKinds, label) {
  const others = coordinator._log.read(handle.id).filter((event) => !keepKinds.includes(event.kind) && (
    event.kind === 'content.tool_call'
    || (event.kind === 'content.message' && event.actor === 'worker')
    || (event.kind === 'scratchpad.write_result' && event.payload?.ok === true)
    || (event.kind === 'context.read_result' && event.payload?.ok === true)
    || event.kind === 'resource.provider_call'
    || event.kind === 'question.answered'
    || event.kind === 'approval.resolved'
    || event.kind === 'decision.settled'
  ));
  assert.equal(others.length, 0,
    `${label}: the named class is the ONLY counted liveness in the window (found ${others.map((event) => event.kind).join(', ')})`);
}

// ===========================================================================
// §A — the #88 receipt restaged (stage: claim-preflight-missing)
// ===========================================================================

test('T18 (#88 headline): a diffless pause carrying counted liveness REFUSES claim_premature_liveness — worker alive, rollback-clean, claimable later', async () => {
  const adapter = new ScriptableAdapter();
  let current = noDiff;
  const captureCalls = [];
  // The capture stub wraps a spy: the preflight must capture with the gate-identical kwargs
  // (acceptance (a) — an argument-ignoring stub greens a shallow implementation).
  const capture = (...args) => { captureCalls.push(args); return current(...args); };
  const { coordinator } = setup({ adapter, capture });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  registerDriver(coordinator, task);
  // The grounded receipt, restaged inside turn epoch 1, actor worker: 5 read-only Bash
  // content.tool_call events + 3 analysis content.message events — PLUS one planted FAILED
  // scratchpad receipt: the refusal below must rest on the tool_calls alone (CP3: ok:false
  // receipts never count).
  emitFiveToolCalls(adapter, handle);
  for (let n = 1; n <= 3; n += 1) emitAnalysis(adapter, handle, n);
  emitScratchWriteStaleFence(adapter, handle, 't18-failed-write');
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused');
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId);
  const failedReceipt = coordinator._log.read(handle.id).find((event) => event.kind === 'scratchpad.write_result');
  assert.equal(failedReceipt?.payload?.ok ?? null, false, 'fixture check: the planted receipt FAILED (stale fence)');
  const preClaimSeq = maxSeq(coordinator, handle);

  // First claim — refused, not killed; rollback-clean.
  const first = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, first, preClaimSeq);

  // The reservation is not poisoned: reserve → refuse → reserve again works — including a
  // CONCURRENT second claim parked at resolvingDone, which must re-enter after the rollback
  // (acceptance (d), :2306-2314) and refuse on its own re-evaluation.
  const concurrent = await Promise.race([
    Promise.all([claimOutcome(coordinator, pauseId), claimOutcome(coordinator, pauseId)]),
    sleep(3000).then(() => '__wedged__:resolving never released after a refusal'),
  ]);
  assert.ok(Array.isArray(concurrent), `a concurrent re-claim is not poisoned (got ${concurrent})`);
  assert.equal(concurrent[0]?.result, 'claim_premature_liveness', 'the preflight re-evaluates on each attempt');
  assert.equal(concurrent[1]?.result, 'claim_premature_liveness');
  assert.equal(streamAfter(coordinator, handle, preClaimSeq).length, 0, 'still zero claim-attributable events');

  // A later claim after an in-scope diff: the would-fire test fails on the fresh capture and
  // the FULL gate runs and passes (TG2's law untouched — the final demands the real diff).
  current = withDiff;
  const third = await claimOutcome(coordinator, pauseId);
  assert.equal(third?.ok, true, 'the same pauseId is claimable later');
  assert.equal(third?.result, 'claimed');
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'completed', 'the full gate passes on the in-scope diff');

  // The capture spy, complete: every preflight capture carries the gate-identical
  // (worktree, kwargs) as the gate's OWN capture (the last call — the successful claim's
  // gate dispatch). A preflight capturing with wrong kwargs behaves differently on real
  // worktrees (expectedBaseSha mismatch → capture_failed) and greens nothing here.
  assert.ok(captureCalls.length >= 3, 'preflight captures happened before the gate capture');
  const gateCall = captureCalls.at(-1);
  for (const call of captureCalls) {
    assert.deepEqual(call, gateCall, 'the preflight captures with the gate-identical worktree + kwargs (:12490-12498)');
  }
  assert.equal(gateCall[1]?.vendor, 'mock');
  assert.equal(gateCall[1]?.ownerTaskId, task.id);
  assert.equal(gateCall[1]?.expectedBaseSha, 'sha-base', 'sessionContext.baseSha rides the conditional expectedBaseSha');
  assert.equal(gateCall[1]?.expectedBranch, `baton/${task.id}`);
});

test('T18e: a null capture tuple is diffless (the !sha || !baseSha arm) — refused, never a silent pass', async () => {
  const adapter = new ScriptableAdapter();
  const nullCapture = async () => ({ sha: null, baseSha: null, changedPaths: [] });
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, capture: nullCapture, stage: emitFiveToolCalls,
  });
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

// ===========================================================================
// §B — the counted set is CLOSED; the window is the pause epoch (CP3/CP4/CP5/CP7)
// ===========================================================================

test('T18w: a hub-receipted scratchpad.write_result {ok:true} counts as liveness', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, stage: (a, h) => emitScratchWriteOk(a, h, 't18w-write'),
  });
  const receipt = coordinator._log.read(handle.id).find((event) => event.kind === 'scratchpad.write_result');
  assert.equal(receipt?.payload?.ok ?? null, true, 'fixture check: the write receipt landed ok:true');
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18r: a hub-receipted context.read_result {ok:true} counts as liveness', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, stage: (a, h) => emitContextReadOk(a, h, 't18r-read'),
  });
  const receipt = coordinator._log.read(handle.id).find((event) => event.kind === 'context.read_result');
  assert.equal(receipt?.payload?.ok ?? null, true, 'fixture check: the read receipt landed ok:true');
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18p: a worker resource.provider_call counts as liveness (logical provider-call accounting)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, stage: (a, h) => emitProviderCall(a, h, 'pc-t18p-1'),
  });
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18m: worker analysis content.message counts as liveness — the messages-only pause refuses (blue-team BLOCKER 1)', async () => {
  const adapter = new ScriptableAdapter();
  // The class teeth T18 lacks: T18 plants 3 analysis messages beside 5 tool_calls, so an
  // implementation whose closed set omits CP3.4 still refuses T18 on the tool_calls and
  // greened all 26 rows. Here the diffless pause's ONLY counted liveness is 3 analysis
  // content.message events (actor worker — no tool_calls, no hub receipts, no provider
  // calls, no resolutions): omit the class and this row gate-kills → red. The removal
  // control (the SAME pause minus the messages) is T18n; T18b independently pins the
  // silent fixture. The planted PROSE_CANARY also re-pins TG4's no-worker-prose law.
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, stage: (a, h) => { for (let n = 1; n <= 3; n += 1) emitAnalysis(a, h, n); },
  });
  const stream = coordinator._log.read(handle.id);
  assert.equal(stream.filter((event) => event.kind === 'content.message' && event.actor === 'worker').length, 3,
    'fixture check: three worker analysis messages planted inside the window');
  assertNoOtherCountedLiveness(coordinator, handle, ['content.message'], 'fixture check (T18m)');
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18q: an interaction RESOLVED inside the window counts as liveness (resolution-gated)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter,
    stage: async (a, h, c) => {
      emitQuestion(a, h, 't18q:question:1');
      await flush(40);
      await c.respond('t18q:question:1', { text: 'continue the recon probes' }).catch(() => {});
      await flush(40);
    },
  });
  const answered = coordinator._log.read(handle.id).find((event) => event.kind === 'question.answered');
  assert.ok(answered, 'fixture check: the resolution minted question.answered inside the window');
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18a: an approval RESOLVED inside the window counts as liveness (approval.resolved — blue-team BLOCKER 2 sibling row)', async () => {
  const adapter = new ScriptableAdapter();
  // The T18q idiom extended to CP3.6's second mint: approval.requested (non-blocking) →
  // respond() approves → the hub mints approval.resolved (actor orchestrator — resolution
  // counting is actor-blind, exactly as T18q/T18z pin it) as the pause's ONLY counted
  // liveness. An implementation counting question.answered but not approval.resolved
  // gate-kills here → red.
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter,
    stage: async (a, h, c) => {
      emitApprovalRequest(a, h, 't18a:approval:1');
      await flush(40);
      await c.respond('t18a:approval:1', { decision: 'allow' }).catch(() => {});
      await flush(40);
    },
  });
  const resolved = coordinator._log.read(handle.id).find((event) => event.kind === 'approval.resolved');
  assert.equal(resolved?.payload?.decision ?? null, 'allow', 'fixture check: the approval resolved inside the window');
  assertNoOtherCountedLiveness(coordinator, handle, ['approval.resolved'], 'fixture check (T18a)');
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18v: a decision SETTLED inside the window counts as liveness (decision.settled — blue-team BLOCKER 2 sibling row)', async () => {
  const adapter = new ScriptableAdapter();
  // CP3.6's third mint: decision.requested (v1 decisions are always blocking — the request
  // parks the task input_required) → respond() settles it with a valid optionId → the hub
  // mints decision.settled {disposition:'delivered'} and the task returns to working, all
  // inside the asking epoch, as the pause's ONLY counted liveness. An implementation
  // omitting decision.settled from the closed set gate-kills here → red.
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter,
    stage: async (a, h, c) => {
      emitDecisionRequest(a, h, 't18v:decision:1');
      await flush(40);
      await c.respond('t18v:decision:1', { optionId: 'opt-a' }).catch(() => {});
      await flush(40);
    },
  });
  const settled = coordinator._log.read(handle.id).find((event) => event.kind === 'decision.settled');
  assert.equal(settled?.payload?.disposition ?? null, 'delivered', 'fixture check: the decision settled inside the window');
  assertNoOtherCountedLiveness(coordinator, handle, ['decision.settled'], 'fixture check (T18v)');
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18b (#64 control, PIN): a SILENT diffless drivered claim still dies required_effect_absent — the preflight never engages', async () => {
  const adapter = new ScriptableAdapter();
  // Zero CP3 events: spawn → lifecycle.turn_completed → claim (the T10b/T17 fixture shape —
  // counting lifecycle markers would green a refusal here and is the shallow this pin kills).
  const { coordinator, adapter: ad, handle, task, pauseId } = await driveredPause({ adapter });
  void ad;
  const outcome = await claimOutcome(coordinator, pauseId);
  assertGateKill(coordinator, adapter, handle, task, outcome, 'the silent worker');
});

test('T18d (PIN, the anti-stale law): liveness from BEFORE the pause\'s own epoch never counts', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({ adapter, stage: emitFiveToolCalls });
  // Resolve the epoch-1 pause WITHOUT a claim (a driver nudge settles it working), then let
  // the worker re-park: the epoch-2 pause is diffless with ZERO epoch-2 events.
  const nudged = await coordinator.nudgeTurn(pauseId, 'continue the turn', { actor: 'orchestrator' });
  assert.equal(nudged?.ok, true, 'the first pause settles by nudge (no claim consumed)');
  await flush(40);
  emitTurnCompleted(adapter, handle, 2, 'second checkpoint');
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused', 'the epoch-2 pause pends');
  const pauseId2 = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId2 && pauseId2 !== pauseId, 'a NEW pause record minted in epoch 2');
  const record2 = coordinator._pausedTurns.get(pauseId2);
  assert.equal(record2?.turnEpoch, 2, 'fixture check: the second record carries turnEpoch 2');
  // A whole-stream reader with no epoch/seq restriction finds the 5 epoch-1 tool_calls and
  // refuses — this row is the only pin that kills it: the preflight must NOT engage.
  const outcome = await claimOutcome(coordinator, pauseId2);
  assertGateKill(coordinator, adapter, handle, task, outcome, 'the stale-epoch window');
});

test('T18s (PIN, the seq bound): a scratchpad receipt minted AFTER the pause — same epoch, seq > mintedEvent — never counts', async () => {
  const adapter = new ScriptableAdapter();
  // Zero pre-pause liveness. The paused worker's write races the driver's claim: the emulated
  // up-channel carries the worker's own epoch (1), so the hub mints write_result {ok:true}
  // with turnEpoch === record.turnEpoch and seq > record.mintedEvent. An epoch-only reader
  // (no seq restriction) counts it and refuses; CP4's seq bound is the load-bearing half
  // that keeps this receipt out (the contract's belt-and-braces, pinned because a paused
  // worker's stream CAN still grow same-epoch hub receipts).
  const { coordinator, handle, task, pauseId } = await driveredPause({ adapter });
  emitScratchWriteOk(adapter, handle, 't18s-late-write', 1);
  await flush(40);
  const record = coordinator._pausedTurns.get(pauseId);
  const receipt = coordinator._log.read(handle.id).find((event) => event.kind === 'scratchpad.write_result');
  assert.equal(receipt?.payload?.ok ?? null, true, 'fixture check: the post-pause write landed ok:true');
  assert.equal(receipt.turnEpoch, record.turnEpoch, 'fixture check: same epoch as the record');
  assert.ok(receipt.seq > record.mintedEvent, 'fixture check: OUTSIDE the seq bound');
  const outcome = await claimOutcome(coordinator, pauseId);
  assertGateKill(coordinator, adapter, handle, task, outcome, 'the seq bound');
});

test('T18x (PIN, CP7): a board.claim_result buys nothing at claim time (post-memo receipt classes excluded)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, stage: (a, h) => emitBoardClaimInvalid(a, h),
  });
  const receipt = coordinator._log.read(handle.id).find((event) => event.kind === 'board.claim_result');
  assert.equal(receipt?.payload?.ok ?? null, false, 'fixture check: the board receipt landed (ok:false variant)');
  const outcome = await claimOutcome(coordinator, pauseId);
  assertGateKill(coordinator, adapter, handle, task, outcome, 'the CP7 exclusion');
});

test('T18y (PIN): FAILED receipts never count — an ok:false write and an ok:false read buy nothing', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter,
    stage: (a, h) => {
      emitScratchWriteStaleFence(a, h, 't18y-write');
      emitContextReadInvalid(a, h, 't18y-read');
    },
  });
  const stream = coordinator._log.read(handle.id);
  assert.equal(stream.find((event) => event.kind === 'scratchpad.write_result')?.payload?.ok ?? null, false, 'fixture check: failed write receipt');
  assert.equal(stream.find((event) => event.kind === 'context.read_result')?.payload?.ok ?? null, false, 'fixture check: failed read receipt');
  const outcome = await claimOutcome(coordinator, pauseId);
  assertGateKill(coordinator, adapter, handle, task, outcome, 'the ok:true law');
});

test('T18z (PIN): a PENDING interaction buys nothing — resolution-gating is load-bearing', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, stage: (a, h) => emitQuestion(a, h, 't18z:question:1'),
  });
  const answered = coordinator._log.read(handle.id).find((event) => event.kind === 'question.answered');
  assert.equal(answered ?? null, null, 'fixture check: the question stayed pending');
  const outcome = await claimOutcome(coordinator, pauseId);
  assertGateKill(coordinator, adapter, handle, task, outcome, 'resolution-gating');
});

test('T18n (PIN, the T18m removal control): the SAME pause with the content.message events REMOVED dies by the full gate', async () => {
  const adapter = new ScriptableAdapter();
  // The other half of the content.message pair: T18m's fixture minus the 3 analysis
  // messages — zero staged liveness, staging byte-identical to T18b's silent fixture,
  // kept as the pair's named removal control. An implementation that refuses a diffless
  // pause WITHOUT reading its liveness (or that counts non-worker/lifecycle content)
  // greens T18m and dies here.
  const { coordinator, adapter: ad, handle, task, pauseId } = await driveredPause({ adapter });
  void ad;
  const outcome = await claimOutcome(coordinator, pauseId);
  assertGateKill(coordinator, adapter, handle, task, outcome, 'the content.message removal control');
});

// ===========================================================================
// §C — insertion ordering + the error path (CP1)
// ===========================================================================

test('T18h: a refused claim on a cycle-armed record leaves the cycle ARMED — the ordinary expiry still lands the gate WITH the steering receipt', async () => {
  const adapter = new ScriptableAdapter();
  // DriverLESS (the only path that arms a TG3 cycle), a window big enough to outlive the
  // claim but small enough to fire inside the test.
  const { coordinator } = setup({ adapter, capture: noDiff, coordinatorOpts: { progressNudgeWindowMs: 100 } });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  emitFiveToolCalls(adapter, handle);
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(adapter.calls.prompt.filter((call) => String(call.content).includes('baton-progress-check:')).length, 1,
    'the cycle armed (one provenance-marked nudge)');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused');
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId);

  const outcome = await claimOutcome(coordinator, pauseId);
  assert.equal(outcome?.result, 'claim_premature_liveness',
    `stage[cycle-ordering]: the claim refuses BEFORE the timer clear (got ${outcome?.result})`);
  const record = coordinator._pausedTurns.get(pauseId);
  assert.equal(record?.state, 'pending', 'rollback restored pending');
  assert.equal(record?.steering?.answered, false, 'the cycle was NOT consumed by the refusal');
  assert.notEqual(record?.steering?.timer ?? null, null,
    'the window timer is still ARMED after the refusal (insertion BEFORE _clearSteeringTimer)');

  // The window then expires unanswered: TODAY'S expiry lands the full gate with the
  // steering receipt — the cheaper save (the cycle) survives the refused claim.
  await sleep(180);
  await flush(40);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed',
    'the ordinary expiry runs the full final evaluation after the window');
  const settled = coordinator._log.read(handle.id).filter((event) => event.kind === 'turn.settled'
    && event.payload?.basis === 'steering_expired');
  assert.equal(settled.length, 1, 'the expiry (basis steering_expired) settled the pause, not the claim');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent?.payload?.steered ?? verdictEvent?.payload?.steering ?? null,
    'the verdict carries the steering receipt (steered.answered === false)');
});

test('T18g: the swallowed-expiry re-check — the window fires DURING the preflight capture; the refuse path runs the expiry synchronously after rollback', async () => {
  const adapter = new ScriptableAdapter();
  // The capture pends (once, armed just before the claim) so the 100ms window fires while
  // the reservation is held: _expireSteeringCycle's guard skips, sets expiryPending; the
  // refuse path must re-run the expiry — one flag and one call, no new clock.
  let armed = false;
  let releaseCapture = null;
  const capture = () => {
    if (armed) {
      armed = false;
      return new Promise((resolve) => { releaseCapture = () => resolve(noDiff()); });
    }
    return noDiff();
  };
  const { coordinator } = setup({ adapter, capture, coordinatorOpts: { progressNudgeWindowMs: 100 } });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  emitFiveToolCalls(adapter, handle);
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId);

  armed = true;
  const claimPromise = claimOutcome(coordinator, pauseId);
  await sleep(180); // the one-shot window fires mid-capture and is swallowed by the reservation guard
  releaseCapture(); // the preflight's capture resolves diffless → refuse
  const outcome = await claimPromise;
  assert.equal(outcome?.result, 'claim_premature_liveness',
    `stage[expiryPending-re-check]: the claim still refuses (got ${outcome?.result})`);
  await sleep(60);
  await flush(40);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'failed',
    'the refuse path re-ran the swallowed expiry — the pause is NOT a zombie with a dead cycle');
  const settled = coordinator._log.read(handle.id).filter((event) => event.kind === 'turn.settled'
    && event.payload?.basis === 'steering_expired');
  assert.equal(settled.length, 1, 'the re-check expiry minted steering_expired');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.ok(verdictEvent?.payload?.steered ?? verdictEvent?.payload?.steering ?? null,
    'the verdict carries the steering receipt');
});

test('T18c: a preflight THROW rolls back and rethrows with its own typed code — resolving always released, the armed cycle untouched, zero events', async () => {
  const adapter = new ScriptableAdapter();
  let current = noDiff;
  let throwArmed = false;
  const capture = () => {
    if (throwArmed) {
      throwArmed = false;
      throw Object.assign(new Error('capture boom'), { code: 'capture_failed' });
    }
    return current();
  };
  // A long window: the cycle must still be armed (unfired) when the second claim lands.
  const { coordinator } = setup({ adapter, capture, coordinatorOpts: { progressNudgeWindowMs: 2000 } });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  emitFiveToolCalls(adapter, handle);
  emitTurnCompleted(adapter, handle);
  await flush(60);
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId);
  try {
    const preClaimSeq = maxSeq(coordinator, handle);
    throwArmed = true;
    const first = await claimOutcome(coordinator, pauseId);
    assert.equal(first?.result, '__thrown__:capture_failed',
      'the claim REJECTS with the error\'s own typed code — a preflight throw is NOT a refusal (no claim_premature_liveness is minted)');
    const record = coordinator._pausedTurns.get(pauseId);
    assert.equal(record?.state, 'pending', 'rollback-on-throw restored pending');
    assert.equal(record?.consumer, null);
    assert.notEqual(record?.steering?.timer ?? null, null,
      'the armed cycle stays armed (the timer clear is below the preflight)');
    assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused', 'no settle, no gate run, no kill');
    assertWorkerAlive(coordinator, adapter, handle, 'the preflight throw');
    assert.equal(streamAfter(coordinator, handle, preClaimSeq).length, 0,
      'zero events minted by the thrown preflight');

    // resolving is never wedged: a SECOND claim with a healthy capture proceeds.
    current = withDiff;
    const second = await claimOutcomeGuarded(coordinator, pauseId);
    assert.notEqual(second?.result, '__wedged__:resolving never released',
      'resolvingDone was released by the rollback — the racing claim re-enters (:2309)');
    assert.equal(second?.result, 'claimed', 'the second claim proceeds to the full gate and claims');
    await flush(60);
    assert.equal(coordinator._tasks.get(handle.taskId).status, 'completed');
  } finally {
    coordinator._clearSteeringTimer(coordinator._pausedTurns.get(pauseId) ?? {});
  }
});

// ===========================================================================
// §D — mirror fidelity (CP2: the would-fire test mirrors the gate EXACTLY)
// ===========================================================================

test('T18f: baseSha derives sessionContext ?? captured (a captured-vs-captured shallow mirror gate-kills where the gate would refuse)', async () => {
  const adapter = new ScriptableAdapter();
  // sessionContext.baseSha is 'sha-base' (the worktree create's baseSha). sha ===
  // sessionContext.baseSha while captured.baseSha differs: the gate's OWN derivation
  // (:12531) reads baseSha = 'sha-base' → sha === baseSha → DIFFLESS. A shallow mirror
  // comparing captured.sha === captured.baseSha ('sha-base' !== 'sha-foreign') proceeds and
  // the gate kills — this row refuses instead.
  const foreignBase = async () => ({ sha: 'sha-base', baseSha: 'sha-foreign', changedPaths: ['file-in-scope.txt'] });
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, capture: foreignBase, stage: emitFiveToolCalls,
  });
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

test('T18i: an out-of-scope diff never rescues the claim (the in-scope filter is the gate\'s own)', async () => {
  const adapter = new ScriptableAdapter();
  const outOfScope = async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['etc/evil.txt'] });
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, capture: outOfScope, brief: makeBrief({ pathScope: ['src/**'] }), stage: emitFiveToolCalls,
  });
  const preClaimSeq = maxSeq(coordinator, handle);
  const outcome = await claimOutcome(coordinator, pauseId);
  assertRefusalBasics(coordinator, adapter, handle, task, pauseId, outcome, preClaimSeq);
});

// ===========================================================================
// §E — the honest-registry flip (CP9)
// ===========================================================================

test('CP9a: the claim_turn registry entry is honest — destructive true, the summary naming the final evaluation and the refusal', () => {
  const entry = APPLICATION_SEMANTIC_REGISTRY.actions.claim_turn;
  assert.ok(entry, 'the claim_turn entry exists');
  assert.equal(entry.destructive, true,
    'stage[registry-flag-lie]: claim_turn can kill a healthy worker — destructive must be true (CP9)');
  assert.match(String(entry.summary ?? ''), /final evaluation/i,
    'the summary names the full final evaluation');
  assert.match(String(entry.summary ?? ''), /claim_premature_liveness/,
    'the summary names the typed refusal');
  // Pins (green before and after): the v1 flag pair and the named version policy.
  assert.equal(entry.irreversible, false, 'v1 keeps irreversible false (Open question 2)');
  assert.equal(entry.idempotent, true, 'idempotent unmoved');
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.version, '1.3.0',
    'the named version policy: the authority DIGEST moves without the version string (phase87:61 unmoved)');
});

test('CP9b: the authority PROJECTION (the descriptor byte-source) carries claim_turn.destructive true', () => {
  const projected = APPLICATION_DIGEST_PROJECTIONS.authority.actions.claim_turn;
  assert.ok(projected, 'the projection carries the claim_turn action');
  assert.equal(projected.destructive, true,
    'stage[registry-flag-lie]: the projection feeding every action descriptor carries destructive true');
  assert.equal(projected.irreversible, false, 'irreversible unmoved in the projection');
  assert.equal(projected.idempotent, true, 'idempotent unmoved in the projection');
});

// ===========================================================================
// §F — wave-driver composition (CP8) on the deterministic fake wave facade
// ===========================================================================

function delay(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
function cancelledFollow() {
  return Object.assign(new Error('followOnce was cancelled'), { code: 'application_follow_cancelled' });
}
function fakeView(overrides = {}) {
  return {
    schemaVersion: 1, phase: 'working', terminal: false, cursor: 0,
    viewDigest: 'f'.repeat(64), attention: [], decisionSettled: [], ...overrides,
  };
}
const cpAtt = (requestId, overrides = {}) => ({
  kind: 'turn_checkpoint', workerId: 'wk', taskId: 't', turnEpoch: 1, changedPathsDigest: 'd0', requestId, ...overrides,
});
const CLAIM_READY = { claim: { status: 'completed', summary: null }, changedPathsDigest: 'd0' };

class FakeRun {
  constructor(id, program) {
    this.id = id;
    this._program = program;
    this._poll = -1;
    this.actCalls = [];
    this.followCalls = [];
  }
  async status() {
    this._poll += 1;
    return this._program.status(this._poll, this);
  }
  async act(action, inputs = {}) {
    this.actCalls.push({ action, inputs });
    if (typeof this._program.act === 'function') return this._program.act(action, inputs, this);
    return { ok: true };
  }
  async followOnce(options) {
    this.followCalls.push({ ...options });
    await delay(options.timeoutMs, options.signal);
    if (options.signal?.aborted) throw cancelledFollow();
    return { follow: { afterCursor: options.afterCursor, throughCursor: options.afterCursor, changes: [], hasMore: false, terminal: false, timedOut: true } };
  }
}
function fakeBaton(runs) {
  const wave = {
    runs,
    settle: async () => [...runs.keys()].map((role) => ({ role, outcome: 'settled' })),
    close: async () => ({ remainingCount: 0, residueUnknown: false }),
    evidence: () => ({ schemaVersion: 1, waveId: 'fake-wave', stops: [], outcomes: [], pumpDrained: true }),
  };
  return { waves: { start: async () => wave }, doctor: async () => ({ routes: [] }) };
}
function fakeWave(programsByRole) {
  const runs = new Map(Object.entries(programsByRole).map(([role, program]) => [role, new FakeRun(`run-${role}`, program)]));
  const members = [...runs.keys()].map((role) => ({
    role, objective: `do the work (marker:${role})`,
    harness: 'mock', model: 'mock-model', effort: 'low', scope: ['reports/**'], report: `reports/${role}.md`,
  }));
  return { baton: fakeBaton(runs), runs, members };
}

const DRIVER_POLICY = Object.freeze({
  preflight: false, steering: 'nudge-on-checkpoint',
  pollIntervalMs: 20, stallTimeoutMs: 400, settleTimeoutMs: 1_500,
  finalization: 'claim-on-stall', unproductiveNudgeBudget: 1, saltObjectives: false,
});
// The application error lane (application.mjs:11896-11899) forwards the coordinator's
// {ok:false} as a THROWN application error carrying the refusal code — the shape claimOnce's
// catch already records.
const prematureRefusal = () => Object.assign(
  new Error('worker shows read-only liveness inside this pause epoch but no in-scope diff'),
  { code: 'claim_premature_liveness' },
);
const actCallsOf = (wave, role, action) => wave.runs.get(role).actCalls.filter((call) => call.action === action);

test('WD1 (PIN): a claim_premature_liveness refusal is recorded on the claims evidence with its code', async () => {
  const wave = fakeWave({
    w: {
      status: (poll) => fakeView({ attention: [cpAtt(`cp-${Math.min(poll, 1)}`, CLAIM_READY)] }),
      act: (action) => { if (action === 'claim_turn') throw prematureRefusal(); return { ok: true }; },
    },
  });
  const receipt = await createWaveDriver(wave.baton, { ...DRIVER_POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall', 'the member never settles — the wave ends on the pre-existing stall clock');
  assert.equal(actCallsOf(wave, 'w', 'claim_turn').length, 1, 'one claim attempt for the one claimed pauseId');
  assert.equal(receipt.claims.length, 1, 'one claims-evidence row');
  assert.equal(receipt.claims[0].requestId, 'cp-1', 'the row keys the claimed pauseId');
  assert.equal(receipt.claims[0].code, 'claim_premature_liveness',
    'the refusal code is recorded verbatim (:252-255, :262 — no new plumbing)');
});

test('WD2: exactly ONE corrective nudge for the SAME pause — exempt from the L4 one-nudge-per-pause dedup exactly once', async () => {
  const wave = fakeWave({
    // A persistent pause: ordinarily nudged at first sight (so cp-1 IS in nudgedRequestIds),
    // then never re-observed fresh. At the stall clock the D9 fan-out claims it, draws the
    // refusal, and must issue the corrective nudge EVEN THOUGH the requestId was already
    // nudged — the exemption — and exactly once.
    w: {
      status: () => fakeView({ attention: [cpAtt('cp-1', CLAIM_READY)] }),
      act: (action) => { if (action === 'claim_turn') throw prematureRefusal(); return { ok: true }; },
    },
  });
  const receipt = await createWaveDriver(wave.baton, { ...DRIVER_POLICY, refusalNudgeBudget: 2 })
    .run({ members: wave.members });
  assert.equal(receipt.basis, 'stall');
  assert.equal(receipt.claims.length, 1, 'the D9 fan-out claim is recorded');
  assert.equal(receipt.claims[0].code, 'claim_premature_liveness');
  assert.equal(actCallsOf(wave, 'w', 'nudge_turn').length, 2,
    'stage[driver-composition-missing]: the refusal draws exactly ONE corrective nudge on top of the ordinary one');
  const nudgeRows = receipt.nudges.filter((row) => row.role === 'w' && !row.error);
  assert.equal(nudgeRows.length, 2, 'two nudge evidence rows for cp-1: the ordinary one and the corrective one');
  assert.ok(nudgeRows.every((row) => row.requestId === 'cp-1'),
    'the corrective nudge targets the SAME pause — the L4 dedup exempts it exactly once');
});

test('WD3: a refused corrective-nudge DELIVERY consumes no budget (D8 symmetry); the NEXT pauseId is claimed again', async () => {
  let nudgeCalls = 0;
  const wave = fakeWave({
    // Fresh pauseIds each poll (a real re-park mints one per checkpoint), then a final
    // persistent one: per-pauseId claimAttempted must let EVERY fresh pauseId be claimed.
    w: {
      status: (poll) => fakeView({ attention: [cpAtt(poll === 0 ? 'cp-1' : (poll >= 4 ? 'cp-final' : `cp-${poll + 1}`), CLAIM_READY)] }),
      act: (action) => {
        if (action === 'claim_turn') throw prematureRefusal();
        nudgeCalls += 1;
        if (nudgeCalls === 2) return { ok: false, result: 'delivery_exception', reason: 'scripted transport fault' };
        return { ok: true };
      },
    },
  });
  const receipt = await createWaveDriver(wave.baton, { ...DRIVER_POLICY, refusalNudgeBudget: 2 })
    .run({ members: wave.members });
  assert.equal(receipt.basis, 'stall');
  // Per-pauseId claim attempts: cp-2, cp-3, cp-4 and cp-final are ALL claimed (per-member
  // keying — today's shape — stops after the first).
  assert.equal(actCallsOf(wave, 'w', 'claim_turn').length, 4,
    'stage[driver-composition-missing]: per-pauseId claimAttempted leaves each new pause record claimable');
  assert.deepEqual(receipt.claims.map((row) => row.requestId), ['cp-2', 'cp-3', 'cp-4', 'cp-final']);
  assert.ok(receipt.claims.every((row) => row.code === 'claim_premature_liveness'));
  // The budget arithmetic, made observable: budget 2, the FIRST corrective delivery fails
  // (delivery_exception — a VALUE, D8) and consumes nothing, so corrective nudges still land
  // for cp-3 AND cp-4. Consume-on-attempt would stop one earlier (3 nudge_turn calls total).
  assert.equal(actCallsOf(wave, 'w', 'nudge_turn').length, 4,
    'one ordinary nudge + three corrective nudges — the failed delivery consumed no budget');
  const failed = receipt.nudges.find((row) => row.requestId === 'cp-2');
  assert.equal(failed?.error?.code ?? null, 'delivery_exception', 'the failed corrective delivery is recorded D8-style');
  assert.equal(receipt.nudges.filter((row) => row.requestId === 'cp-final').length, 0,
    'budget exhausted at cp-final: the refusal is recorded with NO nudge');
});

test('WD4: budget exhaustion is the honest closure — record-only, the pause pends, the PRE-EXISTING stall clock reaps (never the 3h wall)', async () => {
  const wave = fakeWave({
    w: {
      status: (poll) => fakeView({ attention: [cpAtt(poll === 0 ? 'cp-1' : (poll >= 4 ? 'cp-final' : `cp-${poll + 1}`), CLAIM_READY)] }),
      act: (action) => { if (action === 'claim_turn') throw prematureRefusal(); return { ok: true }; },
    },
  });
  // NO refusalNudgeBudget passed: the DEFAULT is 2 (grounded in the #64 claim cadence).
  const receipt = await createWaveDriver(wave.baton, { ...DRIVER_POLICY })
    .run({ members: wave.members });
  assert.equal(receipt.basis, 'stall',
    'closure rides the driver layer\'s own stall clock (never a wall-clock cap — the #163 law retired hardCapMs)');
  assert.equal(actCallsOf(wave, 'w', 'claim_turn').length, 4,
    'each fresh pauseId claimed once; the D9 fan-out then no-ops (the per-pauseId attempt was already consumed)');
  assert.deepEqual(receipt.claims.map((row) => row.requestId), ['cp-2', 'cp-3', 'cp-4', 'cp-final']);
  assert.equal(actCallsOf(wave, 'w', 'nudge_turn').length, 3,
    'one ordinary nudge + exactly TWO corrective nudges — the DEFAULT refusalNudgeBudget is 2');
  assert.equal(receipt.nudges.filter((row) => ['cp-4', 'cp-final'].includes(row.requestId)).length, 0,
    'once the budget is spent every further refusal is record-only');
  assert.ok(receipt.claims.every((row) => row.code === 'claim_premature_liveness'));
});

// ===========================================================================
// §G — exoneration pins: the six non-suite claimTurn call sites' behavior classes
// stay byte-identical (acceptance (c), the red team's §3 audit re-verified at fold)
// ===========================================================================

test('X1 (PIN, the claim-diffed-pause class): a diffed pause WITH counted liveness still claims and completes', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, capture: withDiff, stage: emitFiveToolCalls,
  });
  const outcome = await claimOutcome(coordinator, pauseId);
  assert.equal(outcome?.ok, true, 'would-fire is false on the diff — the full gate runs (31b5:247 / phase10:112 / bidirectional:369 stay byte-identical)');
  assert.equal(outcome?.result, 'claimed');
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'completed');
});

test('X2 (PIN, the no-requiredEffects-brief class): a diffless pause WITH counted liveness on a repository_edit-free brief still claims', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle, task, pauseId } = await driveredPause({
    adapter, capture: noDiff, brief: makeBrief({ requiredEffects: [] }), stage: emitFiveToolCalls,
  });
  const outcome = await claimOutcome(coordinator, pauseId);
  assert.equal(outcome?.ok, true,
    'would-fire is false on the brief arm — phase11:372/:379 claim exactly as today');
  assert.equal(outcome?.result, 'claimed');
  await flush(60);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'completed');
});

test('X3 (PIN, the already_resolved class): a nudge-resolved record refuses already_resolved AT RESERVATION, before the preflight', async () => {
  const adapter = new ScriptableAdapter();
  // Liveness present on purpose: a preflight hoisted above the reservation would refuse
  // claim_premature_liveness here; the reservation's state guard fires FIRST (31b:205).
  const { coordinator, handle, task, pauseId } = await driveredPause({ adapter, stage: emitFiveToolCalls });
  const nudged = await coordinator.nudgeTurn(pauseId, 'continue the turn', { actor: 'orchestrator' });
  assert.equal(nudged?.ok, true, 'the nudge resolves the record first');
  await flush(40);
  const outcome = await claimOutcome(coordinator, pauseId);
  assert.equal(outcome?.ok, false);
  assert.equal(outcome?.result, 'already_resolved',
    'the reservation guard answers before the preflight is reached — byte-identical (31b:205)');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'working', 'the nudge-settled task keeps working');
});

// ===========================================================================
// Verification (recorded against the PRE-implementation tree, 2026-08-04, node v25.8.0;
// impl/src/coordinator.mjs md5 8e42ead5d5dc565bcbf84398a6ceceaa — unchanged by this fold):
//   command (repo root): node --test impl/test/claim-preflight-red.test.mjs
//   measured split (post-blue-team fold): 19 fail / 11 pass of 30. (Pre-fold split, recorded
//   against the identical tree: 16 fail / 10 pass of 26 — the fold added 3 red rows + 1 pin;
//   see docs/reference/evidence/claim-preflight-2026-08-03/suite-fold.md.)
//   RED (fail on the named stage): T18, T18e, T18w, T18r, T18p, T18m, T18q, T18a, T18v
//     (stage[claim-preflight-missing] — today the claim RETURNS {ok:true, result:'claimed',
//     outcome:'failed'} after the gate kills); T18h (stage[cycle-ordering], got 'claimed');
//     T18g (stage[expiryPending-re-check], got 'claimed'); T18c (the typed-throw lane —
//     today the gate swallows capture_failed into claimed/failed); T18f, T18i
//     (stage[claim-preflight-missing]); CP9a, CP9b (stage[registry-flag-lie]); WD2, WD3
//     (wave_driver_policy_invalid: policy field "refusalNudgeBudget" is unknown); WD4
//     (per-pauseId claim attempts: 1 !== 4).
//   GREEN pins (byte-identical before and after): T18b, T18n, T18d, T18s, T18x, T18y, T18z,
//     WD1, X1, X2, X3.
//   Blue-team fold (suite-blueteam.md, 2026-08-04): BLOCKER 1 (content.message planted but
//   never load-bearing) → T18m (messages-only sole liveness, RED) + T18n (removal control,
//   PIN); BLOCKER 2 (approval.resolved/decision.settled uncovered) → T18a + T18v (the
//   report's two-sibling-rows idiom over the T18q staging). No new invented surfaces — the
//   four rows consume the existing CP3 closed set and the CP6 refusal shape only.
// ===========================================================================
