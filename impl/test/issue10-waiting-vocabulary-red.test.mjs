// Issue #10 red suite: the waiting-on vocabulary (contract: docs/reference/evidence/
// waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md v1.1; fold: contract-fold.md;
// red-team: contract-redteam.md — D1..D13). The five waitingOn kinds are closed, the field is
// ADDITIVE on the run view / outline / runs.list item (never a new run phase), `since` is an
// event-epoch stamp from each kind's OWN stream, and the honest-null law + precedence
// interaction > waitingOn > checkpoint > working ride the SAME reduceMember the wave driver
// already uses for rendering and steering.
//
// Red-first: every RED row fails at a NAMED stage against the PRE-implementation tree and goes
// green on the contract's implementation ONLY; every PIN row is green today AND green under the
// correct implementation, but fails a plausible WRONG one (the pin list below names the wrong
// implementation each pin kills). Harness idiom mirrors test/claim-preflight-red.test.mjs
// (ScriptableAdapter coordinator harness, the deterministic fake-wave facade) and
// test/issue10-blocked-interaction-red.test.mjs (the application harness). Hermetic: mock
// adapters, tmp dirs, test.after cleanup, no network, no keychain.
//
// ===========================================================================
// ROW INVENTORY (the split at the bottom was measured against the PRE-implementation tree)
// ===========================================================================
//
// §A capacity_ceiling (task.dispatch_deferred Arm-1 receipt)
//   CC-START   ceiling 1 + A+B: the ceiling skip mints task.dispatch_deferred once with the
//              full {taskId,vendor,ceiling,inFlight,taskCreatedSeq} payload + the
//              `task.dispatch_deferred:<taskId>:<taskCreatedSeq>` idempotency key; re-driving
//              the dispatch pass 3× re-skips idempotent (still exactly 1). #88: the queued
//              task is pending, never paused. (RED: stage[dispatch-deferred-receipt-missing])
//   CC-SHOW    run view + outline + runs.list carry waitingOn.capacity_ceiling with
//              since.turnEpoch null + detail {vendor,ceiling,inFlight}. (RED:
//              stage[waiting-on-projection-missing])
//   CC-EXIT    once A completes and B claims, waitingOn reads honest null. (RED:
//              stage[waiting-on-exit-missing])
//   CC-HONEST  reduceMember([], null, waitingOn.capacity_ceiling) → {class:'capacity_ceiling',
//              blocked:false, waiting:true, gated:null, interactions:[]}, never working.
//              (RED: stage[reduceMember-missing])
//   CC-STRIP   a view that churns ONLY waitingOn.capacity_ceiling never moves the wave marker —
//              the stall clock fires (basis 'stall'), never the cap. (RED:
//              stage[stallMarker-missing])
//
// §B dispatch_pending (Arm-2, no receipt — silent exits)
//   DP-START   a claimed-but-undispatched task (patched _resolveVendor → null, so NO receipt)
//              projects waitingOn.dispatch_pending with since = the task.created seq,
//              turnEpoch null, detail {vendorRequested, reason:'pre-dispatch'}. (RED:
//              stage[dispatch-pending-projection-missing])
//   DP-SHOW    view + outline + runs.list parity. (RED: stage[dispatch-pending-projection-missing])
//   DP-EXIT-a  restore the resolver → the next dispatch pass dispatches → completes →
//              waitingOn null. (RED: stage[waiting-on-exit-missing])
//   DP-EXIT-b  restore the resolver while A still holds the slot → the receipt mints → the kind
//              FLIPS dispatch_pending → capacity_ceiling (the Arm-2→Arm-1 exit), never null
//              mid-queue. (RED: stage[waiting-on-exit-missing])
//   DP-EXIT-c  stop → cancelled → waitingOn null. (RED: stage[waiting-on-exit-missing])
//   DP-HONEST  reduceMember classes dispatch_pending, never working. (RED: stage[reduceMember-missing])
//   DP-STRIP   waitingOn.dispatch_pending churn never moves the marker. (RED: stage[stallMarker-missing])
//
// §C spawning (the D6 union worktreeCreationPending||nativeSpawnPending||recoverySpawnPending)
//   SP-START-WT       a deferred worktree creation projects spawnPending true + spawnWindow
//                     'worktree'. (RED: stage[spawn-window-fields-missing])
//   SP-START-SPAWN    a deferred native ack projects spawnWindow 'spawn'. (RED:
//                     stage[spawn-window-fields-missing])
//   SP-START-RECOVERY a recovery re-spawn projects spawnWindow 'recovery'. (RED:
//                     stage[spawn-window-fields-missing])
//   SP-SHOW           a mid-native-spawn run projects waitingOn.spawning on view + outline +
//                     runs.list, since = the task.claimed seq, turnEpoch null. (RED:
//                     stage[waiting-on-projection-missing])
//   SP-EXIT-WT        resolve the worktree while the native ack is still pending → the window
//                     SLIDES worktree→spawn without passing through null; settle the ack →
//                     spawnPending false, spawnWindow null. (RED: stage[spawn-window-fields-missing])
//   SP-EXIT-SETTLED   a settled spawn clears the run view's waitingOn to null. (RED:
//                     stage[waiting-on-exit-missing])
//   SP-REFUSAL        sendMessage to a mid-spawn worker REFUSES {ok:false, result:'worker_spawning',
//                     workerId, runId} in EVERY window (worktree/spawn/recovery); an unknown
//                     worker still refuses worker_not_active (PIN). (RED: stage[spawn-refusal-missing])
//   SP-HONEST         reduceMember classes spawning, never working. (RED: stage[reduceMember-missing])
//   SP-STRIP          waitingOn.spawning churn never moves the marker. (RED: stage[stallMarker-missing])
//
// §D plan_approval (the pure fold)
//   PA-START   a run awaiting_plan_approval projects waitingOn.plan_approval (since = the
//              plan.version_proposed seq, turnEpoch null, detail {planVersion, proposalSeq})
//              BESIDE the existing approve_plan blockedInteraction (PIN). (RED:
//              stage[plan-approval-projection-missing])
//   PA-SHOW    view + outline + runs.list parity. (RED: stage[plan-approval-projection-missing])
//   PA-EXIT    approve → dispatched → waitingOn null, phase moved (PIN). (RED:
//              stage[waiting-on-exit-missing])
//   PA-HONEST  reduceMember classes plan_approval, never working. (RED: stage[reduceMember-missing])
//   PA-STRIP   waitingOn.plan_approval churn never moves the marker. (RED: stage[stallMarker-missing])
//
// §E provider_stalled (health.stall_suspected, watchdog stallAction 'none')
//   PS-START   a watchdog stall suspicion projects waitingOn.provider_stalled with since = the
//              suspicion seq AND the suspicion turnEpoch, detail {workerId, taskId, action}.
//              #88: the suspected worker is working, never paused. (RED:
//              stage[provider-stalled-projection-missing])
//   PS-SHOW    view + outline + runs.list parity. (RED: stage[provider-stalled-projection-missing])
//   PS-EXIT    first actor==='worker' content AFTER the suspicion seq clears waitingOn to null.
//              (RED: stage[waiting-on-exit-missing])
//   PS-HONEST  a blocked member reads honest null — the interaction owns the projection, never
//              provider_stalled; reduceMember classes provider_stalled, never working. (RED:
//              stage[reduceMember-missing] + stage[waiting-on-honest-null-missing])
//   PS-STRIP   waitingOn.provider_stalled churn never moves the marker. (RED: stage[stallMarker-missing])
//
// §F D9 — the reduced flags, suppression, and the checkpoint⇒not-waiting invariant
//   D9-INVARIANT  PIN: a drivered paused task reads the three raw spawn flags false — the
//                 emergent not-waiting invariant. (kills an impl that lets a stale spawn flag
//                 survive the pause fold)
//   D9-COMPOUND   a member carrying BOTH a claim-ready checkpoint AND waitingOn is NEVER claimed
//                 — waiting beats checkpoint (the suppression gains `!reduced.waiting`). (RED:
//                 stage[waiting-not-suppressed] — today the checkpoint wins and claims)
//   D9-SHAPE      reduceMember exposes BOTH flags — blocked and waiting — and a checkpoint
//                 without waitingOn keeps its class with waiting:false. (RED:
//                 stage[reduceMember-missing])
//
// §G Digest + enum
//   DIGEST        semanticViewDigest is exported; a waitingOn transition MOVES the view digest;
//                 cursor/progressClass/requiredAction stay stripped (the deliberate asymmetry,
//                 pinned in both directions). (RED: stage[digest-export-missing])
//   WAITING_ON_KINDS  the frozen CLOSED enum of exactly the five kinds. (RED:
//                 stage[waiting-on-enum-missing])
//
// §H Exoneration pins (acceptance (c): the non-suite reducer call sites stay byte-identical)
//   EXO-1  a checkpoint WITHOUT waitingOn still claims exactly once (kills an impl that
//          over-suppresses every non-working member)
//   EXO-2  a blocking interaction WITHOUT waitingOn still suppresses claim (kills an impl that
//          lets a null waitingOn override the interaction precedence)
//
// ===========================================================================
// INVENTED SURFACES (names + exact observable signatures the wave worker must land)
// ===========================================================================
//
// 1. application-semantics.mjs WAITING_ON_KINDS — a frozen Set/collection of exactly the five
//    kinds ['capacity_ceiling','dispatch_pending','plan_approval','provider_stalled','spawning'].
// 2. wave-driver.mjs reduceMember(interactions, checkpoint, waitingOn) — the existing reducer
//    gains a third argument; a non-null waitingOn yields {class:<kind>, blocked:false,
//    waiting:true, gated:null, interactions:[]}; the checkpoint/working shapes gain
//    waiting:false. Exported.
// 3. wave-driver.mjs stallMarker — the existing (:168-174) hash strips waitingOn (additive
//    delete). The STRIP rows drive the REAL driver end-to-end (D10's either path); the export
//    is optional.
// 4. application.mjs semanticViewDigest — exported (module-private :259-264 today); still strips
//    ONLY cursor/progressClass/requiredAction, so a waitingOn transition moves the digest.
// 5. coordinator.mjs task.dispatch_deferred — the ceiling-skip receipt, idempotency key
//    `task.dispatch_deferred:<taskId>:<taskCreatedSeq>`, payload {taskId, vendor, ceiling,
//    inFlight, taskCreatedSeq}.
// 6. coordinator.mjs _publicHandle.spawnPending + spawnWindow ('worktree'|'spawn'|'recovery'|null)
//    — derived from the D6 union, live-state.
// 7. coordinator.mjs sendMessage worker_spawning refusal — {ok:false, result:'worker_spawning',
//    workerId, runId} for ANY mid-union worker (today returns {ok:true, result:'sent'}).
// 8. RunView/outline/runs.list item field waitingOn — {kind, since:{eventSeq,turnEpoch},detail}
//    | null, honest-null (the field ALWAYS present).
//
// ===========================================================================
// PIN LIST (green today, green under the correct impl; the wrong impl each kills)
// ===========================================================================
//
// - The queued/dispatched task statuses (pending/working) read exactly as today — the waitingOn
//   field is ADDITIVE, never a new phase (CC-START, CC-SHOW, DP-START, SP-SHOW, PS-START).
// - The raw spawn flags on a paused task read false (D9-INVARIANT) — kills a fold that leaves a
//   stale flag set.
// - A claimed-but-undispatched task's pausedTurns() is empty — the #88 preflight is vacuously
//   safe for every kind (CC-START, DP-START, PS-START).
// - worker_not_active for an unknown worker, run_not_active for a run with no worker (SP-REFUSAL).
// - approve_plan blockedInteraction stays (PA-START); the phase ladder is untouched (PA-EXIT).
// - A blocked member's view keeps blockedInteraction and the approved phase 'running' rides
//   exactly as today (PS-HONEST, CC-SHOW, DP-START).
// - EXO-1/EXO-2 keep the driver's ordinary checkpoint claim and interaction suppression.
//
// ===========================================================================
// VERIFIED SPLIT — recorded against the PRE-implementation tree on 2026-08-06
// (node --test impl/test/issue10-waiting-vocabulary-red.test.mjs, repo root):
//
//   38 tests — 35 RED rows FAIL, 3 PINs PASS.
//   RED rows: each fails at its NAMED stage (14 distinct stages, listed in the row
//   inventory above); none fails at a PIN assertion or a fixture error.
//   PINs PASS: D9-INVARIANT, EXO-1, EXO-2.
//   Stable across two consecutive runs: run 1 = 35 fail / 3 pass (15.8s);
//   run 2 = 35 fail / 3 pass (15.8s).
// ===========================================================================
//
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { createWaveDriver } from '../src/wave-driver.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import {
  BatonApplication, createDriver, parseBatonCli, projectBatonCliResult,
} from '../src/index.mjs';
// Namespace imports for the invented surfaces (SUITE LAW): the correct implementation must
// expose exactly these names; today they are undefined, and the rows fail at their named stage.
import * as waveDriverNs from '../src/wave-driver.mjs';
import * as applicationSemanticsNs from '../src/application-semantics.mjs';
import * as applicationNs from '../src/application.mjs';

const REPO_ID = 'repo-issue10-waiting-vocabulary';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });
const WAITING_ON_KINDS_SORTED = ['capacity_ceiling', 'dispatch_pending', 'plan_approval', 'provider_stalled', 'spawning'];

// ---------------------------------------------------------------------------
// Shared constants / fixtures
// ---------------------------------------------------------------------------

function principal(id) {
  return Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-waiting-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'waiting@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Waiting Vocabulary Test'], { cwd: root });
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
// Coordinator harness (ScriptableAdapter + fake worktrees, claim-preflight idiom)
// ---------------------------------------------------------------------------

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-waiting-'));
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

// A ScriptableAdapter whose native spawn ack stays pending until settleSpawns() — the
// D6 'spawn' window (and the worktree→spawn slide).
class DeferredAckScriptableAdapter extends ScriptableAdapter {
  constructor() { super(); this._spawnAcks = []; }
  async spawn(worker, brief) {
    this.calls.spawn.push({ worker, brief });
    let resolveAck;
    const ack = new Promise((resolve) => { resolveAck = resolve; });
    this._spawnAcks.push({ worker, resolve: resolveAck });
    return ack;
  }
  settleSpawns() { for (const s of this._spawnAcks.splice(0)) s.resolve({ ok: true }); }
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

function registerDriver(coordinator, task) {
  coordinator._coordination.recordDriver('steering.registered', { runId: task.runId },
    { actor: 'orchestrator', key: `driver.recorded:steering.registered:${task.runId}` });
}

function emitTurnCompleted(adapter, handle, turnEpoch = 1, output = 'mid-workflow checkpoint') {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output },
  });
}

async function driveredPause({ adapter, capture, brief = makeBrief(), coordinatorOpts = {}, stage = null }) {
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

// ---------------------------------------------------------------------------
// Application harness (issue10-blocked-interaction idiom)
// ---------------------------------------------------------------------------

// One MockAdapter whose spawn() selects a scenario by matching a `(marker:x)` fragment in the
// dispatched brief's goal, so multiple scenarios can share one driver/adapter instance.
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
      provenance: 'waiting-vocabulary-test', refreshedAt: null,
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

// A MockAdapter whose native spawn ack stays pending until settleSpawns() — keeps the D6 'spawn'
// window open at the application level.
class DeferredAckAppAdapter extends MockAdapter {
  constructor(config = {}) { super(config); this._pendingSpawns = []; }
  card() {
    return {
      ...super.card(),
      modelSelection: {
        mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
        provenance: 'waiting-vocabulary-test', refreshedAt: null,
      },
    };
  }
  async spawn(worker, brief, options = {}) {
    let resolveAck;
    const ack = new Promise((resolve) => { resolveAck = resolve; });
    this._pendingSpawns.push({ worker, resolve: resolveAck });
    return ack;
  }
  settleSpawns() { for (const p of this._pendingSpawns.splice(0)) p.resolve({ ok: true }); }
}

function harnessApp(t, adapter, createOpts = {}) {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-waiting-log-'));
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

// ---------------------------------------------------------------------------
// Fake-wave facade (claim-preflight idiom) for the driver-level rows
// ---------------------------------------------------------------------------

function fakeView(overrides = {}) {
  return {
    schemaVersion: 1, phase: 'working', terminal: false, cursor: 0,
    viewDigest: 'f'.repeat(64), attention: [], decisionSettled: [], ...overrides,
  };
}
const cpAtt = (requestId, overrides = {}) => ({
  kind: 'turn_checkpoint', workerId: 'wk', taskId: 't', turnEpoch: 1, changedPathsDigest: 'd0', requestId, ...overrides,
});
const qAtt = (requestId, overrides = {}) => ({
  kind: 'answer_question', workerId: 'wk', taskId: 't', requestId, ...overrides,
});
const CLAIM_READY = { claim: { status: 'completed', summary: null }, changedPathsDigest: 'd0' };

function delay(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
function cancelledFollow() {
  return Object.assign(new Error('followOnce was cancelled'), { code: 'application_follow_cancelled' });
}
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
  pollIntervalMs: 20, stallTimeoutMs: 400, hardCapMs: 30_000, settleTimeoutMs: 1_500,
  finalization: 'claim-on-stall', unproductiveNudgeBudget: 1, saltObjectives: false,
});
// STRIP rows: a churning waitingOn must not reset the clock (stallTimeoutMs fires first); today
// the churn resets it every poll and the wave rides to the cap.
const STRIP_POLICY = { ...DRIVER_POLICY, stallTimeoutMs: 250, hardCapMs: 1_200 };
const actCallsOf = (wave, role, action) => wave.runs.get(role).actCalls.filter((call) => call.action === action);

// A canonical waitingOn value for a kind (the D3 since-stamp shape). provider_stalled rides a
// suspicion turnEpoch; the fence-less kinds read turnEpoch null.
function WAIT(kind, detailSeed = 'x') {
  return {
    kind,
    since: { eventSeq: 1, turnEpoch: kind === 'provider_stalled' ? 3 : null },
    detail: { seed: detailSeed },
  };
}
function stripWave(kind) {
  return fakeWave({
    w: {
      status: (poll) => fakeView({ waitingOn: poll % 2 === 0 ? WAIT(kind, 'a') : WAIT(kind, 'b') }),
      act: () => ({ ok: true }),
    },
  });
}

// ===========================================================================
// §A — capacity_ceiling
// ===========================================================================

test('CC-START (RED): a ceiling-skipped dispatch mints task.dispatch_deferred once — idempotent re-drive, full payload', async () => {
  const adapter = new ScriptableAdapter();
  adapter._card.concurrencyCeiling = 1;
  const { coordinator, coordination } = setup({ adapter });
  const a = await coordinator.spawn('mock', makeBrief({ goal: 'CC-START a' }));
  const b = await coordinator.spawn('mock', makeBrief({ goal: 'CC-START b' }));
  const taskA = coordinator._tasks.get(a.taskId);
  const taskB = coordinator._tasks.get(b.taskId);
  assert.equal(taskA.status, 'working', 'PIN: A takes the single slot');
  assert.equal(taskB.status, 'pending', 'PIN: B is queued behind the ceiling');

  const receipts = () => coordination.events(1).filter((e) => e.kind === 'task.dispatch_deferred');
  assert.equal(receipts().length, 1,
    'stage[dispatch-deferred-receipt-missing]: the ceiling skip must mint exactly one task.dispatch_deferred receipt (got 0 today)');

  coordinator.tick(); coordinator.tick(); coordinator.tick();
  assert.equal(receipts().length, 1,
    'the re-driven pass re-skips idempotent — the same key returns the same event, never a duplicate');

  const receipt = receipts()[0];
  assert.equal(receipt.payload.taskId, taskB.id, 'the receipt names the deferred task');
  assert.equal(receipt.payload.vendor, 'mock', 'the receipt names the resolved vendor');
  assert.equal(receipt.payload.ceiling, 1, 'the receipt carries the ceiling');
  assert.equal(receipt.payload.inFlight, 1, 'the receipt carries the in-flight count');
  const created = coordination.events(1).find((e) => e.kind === 'task.created' && e.payload?.id === taskB.id);
  assert.ok(created, 'the queued task has a created event');
  assert.equal(receipt.payload.taskCreatedSeq, created.seq, 'the receipt pins the task.created seq');
  assert.equal(receipt.idempotencyKey, `task.dispatch_deferred:${taskB.id}:${created.seq}`,
    'the idempotency key is the contract shape');

  // #88: the queued task is not paused — the preflight is vacuously safe.
  assert.equal(taskB.status, 'pending', 'PIN: the queued task is not paused');
  assert.equal(coordinator.pausedTurns({ taskId: taskB.id }).length, 0, 'PIN: no pause record for a queued task');
});

test('CC-SHOW (RED): a ceiling-queued run projects waitingOn.capacity_ceiling on view, outline, and runs.list', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    slow: { outcome: 'completed', edits: [{ path: 'reports/slow.md', content: 'slow\n', delayMs: 1200 }] },
    fast: { outcome: 'completed', edits: [{ path: 'reports/fast.md', content: 'fast\n', delayMs: 100 }] },
  }, { concurrencyCeiling: 1 }));
  const owner = principal('owner');
  const a = await application.start({ objective: 'CC-SHOW (marker:slow): hold the slot', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(a.runId, a.plan.digest, principal('approver'));
  const b = await application.start({ objective: 'CC-SHOW (marker:fast): queued behind', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const approvedB = await application.approve(b.runId, b.plan.digest, principal('approver'));
  assert.equal(approvedB.phase, 'running', 'PIN: the queued run rides the running phase — the field is additive');
  const bTask = [...driver.coordinator._tasks.values()].find((task) => task.runId === b.runId);
  assert.equal(bTask.status, 'pending', 'PIN: B is queued (pending, undispatched)');

  const view = await application.status(b.runId, owner);
  assert.ok(view.waitingOn, 'stage[waiting-on-projection-missing]: a ceiling-queued run must project waitingOn');
  assert.equal(view.waitingOn.kind, 'capacity_ceiling', 'stage[waiting-on-projection-missing]: the kind');
  assert.equal(view.waitingOn.since.turnEpoch, null, 'stage[waiting-on-projection-missing]: fence-less since');
  assert.deepEqual(view.waitingOn.detail, { vendor: 'mock', ceiling: 1, inFlight: 1 },
    'stage[waiting-on-projection-missing]: the receipt detail');

  const listed = (await application.listRuns(owner)).items.find((item) => item.id === b.runId);
  assert.ok(listed.waitingOn, 'stage[waiting-on-projection-missing]: the runs.list item carries waitingOn');
  assert.deepEqual(listed.waitingOn, view.waitingOn, 'the list item projects the SAME waitingOn');
  const outline = projectBatonCliResult(parseBatonCli(['run', 'status', b.runId]), view);
  assert.ok(outline.waitingOn, 'stage[waiting-on-projection-missing]: the outline carries waitingOn');
  assert.deepEqual(outline.waitingOn, view.waitingOn, 'the outline projects the SAME waitingOn');
});

test('CC-EXIT (RED): once the slot frees and B claims, waitingOn reads honest null', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    slow: { outcome: 'completed', edits: [{ path: 'reports/slow.md', content: 'slow\n', delayMs: 1000 }] },
    fast: { outcome: 'completed', edits: [{ path: 'reports/fast.md', content: 'fast\n', delayMs: 80 }] },
  }, { concurrencyCeiling: 1 }));
  const owner = principal('owner');
  const a = await application.start({ objective: 'CC-EXIT (marker:slow): holds then frees', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(a.runId, a.plan.digest, principal('approver'));
  const b = await application.start({ objective: 'CC-EXIT (marker:fast): claims later', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(b.runId, b.plan.digest, principal('approver'));

  const queuedView = await application.status(b.runId, owner);
  assert.ok(queuedView.waitingOn, 'stage[waiting-on-projection-missing]: B queued behind the ceiling projects waitingOn');
  assert.equal(queuedView.waitingOn.kind, 'capacity_ceiling', 'stage[waiting-on-projection-missing]: the queued kind');

  await until(async () => {
    const task = [...driver.coordinator._tasks.values()].find((taskItem) => taskItem.runId === b.runId);
    return task?.status === 'working' ? true : null;
  }, 'B claims the freed slot');
  const view = await application.status(b.runId, owner);
  assert.equal(view.waitingOn, null, 'stage[waiting-on-exit-missing]: a dispatched run must read honest null');
});

test('CC-HONEST (RED): reduceMember classes capacity_ceiling, never working', () => {
  assert.equal(typeof waveDriverNs.reduceMember, 'function', 'stage[reduceMember-missing]: reduceMember must be exported');
  const r = waveDriverNs.reduceMember([], null, WAIT('capacity_ceiling'));
  assert.deepEqual(r, { class: 'capacity_ceiling', blocked: false, waiting: true, gated: null, interactions: [] },
    'stage[reduceMember-missing]: the waiting shape for capacity_ceiling');
});

test('CC-STRIP (RED): waitingOn.capacity_ceiling transitions never move the wave marker — the stall clock fires, never the cap', async () => {
  const wave = stripWave('capacity_ceiling');
  const receipt = await createWaveDriver(wave.baton, { ...STRIP_POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall', 'stage[stallMarker-missing]: waitingOn transitions are stripped from the stall marker');
});

// ===========================================================================
// §B — dispatch_pending (Arm-2, no receipt)
// ===========================================================================

// Patch the coordinator's vendor resolver so a named run's task can never resolve a vendor —
// the task stays claimed-but-undispatched with NO receipt (the Arm-2 condition).
function stallVendorFor(driver, runId) {
  const realResolve = driver.coordinator._resolveVendor.bind(driver.coordinator);
  driver.coordinator._resolveVendor = (task) => (task.runId === runId ? null : realResolve(task));
  return realResolve;
}

test('DP-START (RED): a claimed-but-undispatched task projects waitingOn.dispatch_pending with since = the task.created seq', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 400 }] },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'DP-START (marker:default): stays pending', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const runId = started.runId;
  stallVendorFor(driver, runId);
  const approved = await application.approve(runId, started.plan.digest, principal('approver'));
  assert.equal(approved.phase, 'running', 'PIN: the run rides the running phase while its task pends');
  const task = [...driver.coordinator._tasks.values()].find((taskItem) => taskItem.runId === runId);
  assert.ok(task, 'PIN: the run has a claimed-but-undispatched task');
  assert.equal(task.status, 'pending', 'PIN: the task is pending with no vendor resolved');
  assert.equal(driver.coordination.events(1).filter((e) => e.kind === 'task.dispatch_deferred').length, 0,
    'PIN: NO receipt exists — this is the Arm-2 condition');

  const view = await application.status(runId, owner);
  assert.ok(view.waitingOn, 'stage[dispatch-pending-projection-missing]: a pre-dispatch pending task must project waitingOn');
  assert.equal(view.waitingOn.kind, 'dispatch_pending', 'stage[dispatch-pending-projection-missing]: the kind');
  assert.equal(view.waitingOn.since.turnEpoch, null, 'stage[dispatch-pending-projection-missing]: fence-less since');
  const created = driver.coordination.events(1).find((e) => e.kind === 'task.created' && e.payload?.id === task.id);
  assert.equal(view.waitingOn.since.eventSeq, created.seq, 'stage[dispatch-pending-projection-missing]: since = the task.created seq');
  assert.deepEqual(view.waitingOn.detail, { vendorRequested: 'mock', reason: 'pre-dispatch' },
    'stage[dispatch-pending-projection-missing]: the Arm-2 detail');
});

test('DP-SHOW (RED): dispatch_pending projects identically on view, outline, and runs.list', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 400 }] },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'DP-SHOW (marker:default): parity', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const runId = started.runId;
  stallVendorFor(driver, runId);
  await application.approve(runId, started.plan.digest, principal('approver'));

  const view = await application.status(runId, owner);
  assert.ok(view.waitingOn, 'stage[dispatch-pending-projection-missing]: the view carries waitingOn');
  const listed = (await application.listRuns(owner)).items.find((item) => item.id === runId);
  assert.ok(listed.waitingOn, 'stage[dispatch-pending-projection-missing]: the runs.list item carries waitingOn');
  assert.deepEqual(listed.waitingOn, view.waitingOn, 'the list item projects the SAME waitingOn');
  const outline = projectBatonCliResult(parseBatonCli(['run', 'status', runId]), view);
  assert.ok(outline.waitingOn, 'stage[dispatch-pending-projection-missing]: the outline carries waitingOn');
  assert.deepEqual(outline.waitingOn, view.waitingOn, 'the outline projects the SAME waitingOn');
});

test('DP-EXIT-a (RED): a restored resolver dispatches the pending task and waitingOn clears to null', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'DP-EXIT-a (marker:default): later dispatched', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const runId = started.runId;
  const realResolve = stallVendorFor(driver, runId);
  await application.approve(runId, started.plan.digest, principal('approver'));
  const pendingView = await application.status(runId, owner);
  assert.ok(pendingView.waitingOn, 'stage[dispatch-pending-projection-missing]: the pending task projects dispatch_pending first');
  assert.equal(pendingView.waitingOn.kind, 'dispatch_pending', 'stage[dispatch-pending-projection-missing]: the Arm-2 kind');
  driver.coordinator._resolveVendor = realResolve;
  driver.coordinator.tick();

  await until(async () => {
    const task = [...driver.coordinator._tasks.values()].find((taskItem) => taskItem.runId === runId);
    return task?.status === 'completed' ? true : null;
  }, 'the restored task dispatches and completes');
  const view = await application.status(runId, owner);
  assert.equal(view.waitingOn, null, 'stage[waiting-on-exit-missing]: a dispatched-and-completed run reads honest null');
});

test('DP-EXIT-b (RED): a pending task that gains a receipt FLIPS to capacity_ceiling — the Arm-2→Arm-1 exit', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    slow: { outcome: 'completed', edits: [{ path: 'reports/slow.md', content: 'slow\n', delayMs: 1200 }] },
    fast: { outcome: 'completed', edits: [{ path: 'reports/fast.md', content: 'fast\n', delayMs: 100 }] },
  }, { concurrencyCeiling: 1 }));
  const owner = principal('owner');
  const a = await application.start({ objective: 'DP-EXIT-b (marker:slow): holds the slot', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(a.runId, a.plan.digest, principal('approver'));
  const b = await application.start({ objective: 'DP-EXIT-b (marker:fast): flips to ceiling', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const realResolve = stallVendorFor(driver, b.runId);
  await application.approve(b.runId, b.plan.digest, principal('approver'));

  let view = await application.status(b.runId, owner);
  assert.ok(view.waitingOn, 'stage[waiting-on-projection-missing]: a pre-dispatch pending task projects dispatch_pending');
  assert.equal(view.waitingOn.kind, 'dispatch_pending', 'stage[waiting-on-projection-missing]: the Arm-2 kind first');

  driver.coordinator._resolveVendor = realResolve;
  driver.coordinator.tick();
  view = await application.status(b.runId, owner);
  assert.ok(view.waitingOn, 'stage[waiting-on-exit-missing]: the kind flips, never drops to null mid-queue');
  assert.equal(view.waitingOn.kind, 'capacity_ceiling',
    'stage[waiting-on-exit-missing]: dispatch_pending exits to capacity_ceiling while the slot is still held');
});

test('DP-EXIT-c (RED): a cancelled pre-dispatch run reads honest null', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 400 }] },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'DP-EXIT-c (marker:default): will be cancelled', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const runId = started.runId;
  stallVendorFor(driver, runId);
  await application.approve(runId, started.plan.digest, principal('approver'));
  const task = [...driver.coordinator._tasks.values()].find((taskItem) => taskItem.runId === runId);
  assert.equal(task.status, 'pending', 'PIN: the task pends pre-dispatch');
  const pendingView = await application.status(runId, owner);
  assert.ok(pendingView.waitingOn, 'stage[dispatch-pending-projection-missing]: the pending task projects dispatch_pending first');
  assert.equal(pendingView.waitingOn.kind, 'dispatch_pending', 'stage[dispatch-pending-projection-missing]: the Arm-2 kind');
  await application.stop(runId, 'abandoned', principal('stopper'));
  const view = await until(async () => {
    const v = await application.status(runId, owner);
    return ['cancelled', 'stopped'].includes(v.phase) ? v : null;
  }, 'run cancelled');
  assert.equal(view.phase, 'cancelled', 'PIN: the run cancels');
  assert.equal(view.waitingOn, null, 'stage[waiting-on-exit-missing]: a cancelled run reads honest null');
});

test('DP-HONEST (RED): reduceMember classes dispatch_pending, never working', () => {
  assert.equal(typeof waveDriverNs.reduceMember, 'function', 'stage[reduceMember-missing]: reduceMember must be exported');
  const r = waveDriverNs.reduceMember([], null, WAIT('dispatch_pending'));
  assert.deepEqual(r, { class: 'dispatch_pending', blocked: false, waiting: true, gated: null, interactions: [] },
    'stage[reduceMember-missing]: the waiting shape for dispatch_pending');
});

test('DP-STRIP (RED): waitingOn.dispatch_pending transitions never move the wave marker', async () => {
  const wave = stripWave('dispatch_pending');
  const receipt = await createWaveDriver(wave.baton, { ...STRIP_POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall', 'stage[stallMarker-missing]: waitingOn transitions are stripped from the stall marker');
});

// ===========================================================================
// §C — spawning (the D6 union)
// ===========================================================================

test('SP-START-WT (RED): a deferred worktree creation projects spawnPending true + spawnWindow worktree', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter, worktreesOverrides: { create: () => new Promise(() => {}) } });
  const handle = await coordinator.spawn('mock', makeBrief({ goal: 'SP-START-WT' }));
  const raw = coordinator._workers.get(handle.id);
  assert.ok(raw, 'PIN: the raw handle exists');
  assert.equal(raw.worktreeCreationPending, true, 'PIN: the worktree creation is pending');
  const ph = coordinator._publicHandle(raw);
  assert.equal(ph.status, 'working', 'PIN: the mid-spawn handle reads working');
  assert.equal(ph.spawnPending, true, 'stage[spawn-window-fields-missing]: a mid-worktree handle must project spawnPending true');
  assert.equal(ph.spawnWindow, 'worktree', 'stage[spawn-window-fields-missing]: the worktree window');
});

test('SP-START-SPAWN (RED): a deferred native ack projects spawnWindow spawn', async () => {
  const adapter = new DeferredAckScriptableAdapter();
  const { coordinator } = setup({ adapter });
  const handle = await coordinator.spawn('mock', makeBrief({ goal: 'SP-START-SPAWN' }));
  const raw = coordinator._workers.get(handle.id);
  assert.equal(raw.nativeSpawnPending, true, 'PIN: the native spawn ack is pending');
  const ph = coordinator._publicHandle(raw);
  assert.equal(ph.spawnPending, true, 'stage[spawn-window-fields-missing]: a mid-native-spawn handle must project spawnPending true');
  assert.equal(ph.spawnWindow, 'spawn', 'stage[spawn-window-fields-missing]: the native spawn window');
});

test('SP-START-RECOVERY (RED): a recovery re-spawn projects spawnWindow recovery', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapter });
  const handle = await coordinator.spawn('mock', makeBrief({ goal: 'SP-START-RECOVERY' }));
  const raw = coordinator._workers.get(handle.id);
  raw.recoverySpawnPending = true; // the recovery path (:5748) sets the raw flag; stage it directly
  const ph = coordinator._publicHandle(raw);
  assert.equal(ph.spawnPending, true, 'stage[spawn-window-fields-missing]: a mid-recovery handle must project spawnPending true');
  assert.equal(ph.spawnWindow, 'recovery', 'stage[spawn-window-fields-missing]: the recovery window');
});

test('SP-SHOW (RED): a mid-native-spawn run projects waitingOn.spawning on view, outline, and runs.list', async (t) => {
  const adapter = new DeferredAckAppAdapter({ scenario: { outcome: 'completed' } });
  const { application, driver } = harnessApp(t, adapter);
  const owner = principal('owner');
  const started = await application.start({ objective: 'SP-SHOW: mid-native-spawn', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const runId = started.runId;
  const approved = await application.approve(runId, started.plan.digest, principal('approver'));
  assert.equal(approved.phase, 'running', 'PIN: the run rides the running phase while the spawn is in flight');
  const worker = driver.coordinator.list().find((h) => h.taskId != null);
  assert.ok(worker, 'PIN: the worker handle exists mid-spawn');
  const raw = driver.coordinator._workers.get(worker.id);
  assert.equal(raw.nativeSpawnPending, true, 'PIN: the native spawn ack is pending');

  try {
    const view = await application.status(runId, owner);
    assert.ok(view.waitingOn, 'stage[waiting-on-projection-missing]: a mid-spawn run must project waitingOn');
    assert.equal(view.waitingOn.kind, 'spawning', 'stage[waiting-on-projection-missing]: the spawning kind');
    assert.equal(view.waitingOn.since.turnEpoch, null, 'stage[waiting-on-projection-missing]: fence-less since');
    const claimed = driver.coordination.events(1).find((e) => e.idempotencyKey?.startsWith(`task.claimed:${raw.taskId}:`));
    assert.ok(claimed, 'PIN: the task has a claimed event');
    assert.equal(view.waitingOn.since.eventSeq, claimed.seq, 'stage[waiting-on-projection-missing]: since = the claimed seq');

    const listed = (await application.listRuns(owner)).items.find((item) => item.id === runId);
    assert.ok(listed.waitingOn, 'stage[waiting-on-projection-missing]: the runs.list item carries waitingOn');
    assert.deepEqual(listed.waitingOn, view.waitingOn, 'the list item projects the SAME waitingOn');
    const outline = projectBatonCliResult(parseBatonCli(['run', 'status', runId]), view);
    assert.ok(outline.waitingOn, 'stage[waiting-on-projection-missing]: the outline carries waitingOn');
    assert.deepEqual(outline.waitingOn, view.waitingOn, 'the outline projects the SAME waitingOn');
  } finally {
    adapter.settleSpawns(); // settle the deferred ack even when a RED assertion throws, so teardown never waits on the open spawn
  }
});

test('SP-EXIT-WT (RED): resolving the worktree slides the window worktree→spawn without null; the ack clears it', async () => {
  let resolveWorktree;
  const gate = new Promise((resolve) => { resolveWorktree = resolve; });
  const adapter = new DeferredAckScriptableAdapter();
  const { coordinator } = setup({
    adapter,
    worktreesOverrides: {
      create: async (taskId) => gate.then(() => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' })),
    },
  });
  const handle = await coordinator.spawn('mock', makeBrief({ goal: 'SP-EXIT-WT' }));
  const raw = coordinator._workers.get(handle.id);
  assert.ok(raw, 'PIN: the raw handle exists');
  let ph = coordinator._publicHandle(raw);
  assert.equal(ph.spawnWindow, 'worktree', 'stage[spawn-window-fields-missing]: the worktree window first');
  resolveWorktree();
  await sleep(30);
  ph = coordinator._publicHandle(raw);
  assert.equal(ph.spawnWindow, 'spawn', 'stage[spawn-window-fields-missing]: the window slides to spawn — never through null');
  assert.equal(ph.spawnPending, true, 'stage[spawn-window-fields-missing]: still pending across the slide');
  adapter.settleSpawns();
  await sleep(30);
  ph = coordinator._publicHandle(raw);
  assert.equal(ph.spawnPending, false, 'stage[spawn-window-fields-missing]: a settled spawn clears the window');
  assert.equal(ph.spawnWindow, null, 'stage[spawn-window-fields-missing]: no window once settled');
});

test('SP-EXIT-SETTLED (RED): a settled spawn clears the run view\'s waitingOn to null', async (t) => {
  const adapter = new DeferredAckAppAdapter({ scenario: { outcome: 'completed' } });
  const { application, driver } = harnessApp(t, adapter);
  const owner = principal('owner');
  const started = await application.start({ objective: 'SP-EXIT-SETTLED: settles', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const runId = started.runId;
  await application.approve(runId, started.plan.digest, principal('approver'));
  await until(async () => {
    const w = driver.coordinator.list().find((h) => h.taskId != null);
    return w ? true : null;
  }, 'worker claimed');
  adapter.settleSpawns();
  await sleep(80);
  const view = await application.status(runId, owner);
  assert.equal(view.waitingOn, null, 'stage[waiting-on-exit-missing]: a settled spawn clears waitingOn to honest null');
});

test('SP-REFUSAL (RED): sendMessage to a mid-spawn worker refuses worker_spawning in EVERY window; unknown workers stay worker_not_active', async () => {
  // Worktree window
  const wtAdapter = new ScriptableAdapter();
  const wt = setup({ adapter: wtAdapter, worktreesOverrides: { create: () => new Promise(() => {}) } });
  const wtHandle = await wt.coordinator.spawn('mock', makeBrief({ goal: 'SP-REFUSAL-wt' }));
  const wtRunId = wt.coordinator._tasks.get(wtHandle.taskId)?.runId ?? null;
  const r1 = await wt.coordinator.sendMessage({ kind: 'inform', to: { workerId: wtHandle.id }, body: 'ping' }, { actor: 'orchestrator' });
  assert.equal(r1.ok, false, 'stage[spawn-refusal-missing]: a worktree-window worker must refuse');
  assert.equal(r1.result, 'worker_spawning', 'stage[spawn-refusal-missing]: the typed refusal');
  assert.equal(r1.workerId, wtHandle.id, 'stage[spawn-refusal-missing]: the refusal names the worker');
  assert.equal(r1.runId, wtRunId, 'stage[spawn-refusal-missing]: the refusal names the run');

  // Native-spawn window
  const spAdapter = new DeferredAckScriptableAdapter();
  const sp = setup({ adapter: spAdapter });
  const spHandle = await sp.coordinator.spawn('mock', makeBrief({ goal: 'SP-REFUSAL-sp' }));
  const r2 = await sp.coordinator.sendMessage({ kind: 'inform', to: { workerId: spHandle.id }, body: 'ping' }, { actor: 'orchestrator' });
  assert.equal(r2.ok, false, 'stage[spawn-refusal-missing]: a native-spawn-window worker must refuse');
  assert.equal(r2.result, 'worker_spawning', 'stage[spawn-refusal-missing]: the typed refusal');

  // Recovery window
  const rcAdapter = new ScriptableAdapter();
  const rc = setup({ adapter: rcAdapter });
  const rcHandle = await rc.coordinator.spawn('mock', makeBrief({ goal: 'SP-REFUSAL-rc' }));
  rc.coordinator._workers.get(rcHandle.id).recoverySpawnPending = true; // the recovery path (:5748) sets the raw flag
  const r3 = await rc.coordinator.sendMessage({ kind: 'inform', to: { workerId: rcHandle.id }, body: 'ping' }, { actor: 'orchestrator' });
  assert.equal(r3.ok, false, 'stage[spawn-refusal-missing]: a recovery-window worker must refuse');
  assert.equal(r3.result, 'worker_spawning', 'stage[spawn-refusal-missing]: the typed refusal');

  // Exoneration: an unknown worker keeps the existing typed refusal.
  const ghost = await wt.coordinator.sendMessage({ kind: 'inform', to: { workerId: 'w-ghost' }, body: 'ping' }, { actor: 'orchestrator' });
  assert.deepEqual(ghost, { ok: false, result: 'worker_not_active' }, 'PIN: an unknown worker still refuses worker_not_active');
});

test('SP-HONEST (RED): reduceMember classes spawning, never working', () => {
  assert.equal(typeof waveDriverNs.reduceMember, 'function', 'stage[reduceMember-missing]: reduceMember must be exported');
  const r = waveDriverNs.reduceMember([], null, WAIT('spawning'));
  assert.deepEqual(r, { class: 'spawning', blocked: false, waiting: true, gated: null, interactions: [] },
    'stage[reduceMember-missing]: the waiting shape for spawning');
});

test('SP-STRIP (RED): waitingOn.spawning transitions never move the wave marker', async () => {
  const wave = stripWave('spawning');
  const receipt = await createWaveDriver(wave.baton, { ...STRIP_POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall', 'stage[stallMarker-missing]: waitingOn transitions are stripped from the stall marker');
});

// ===========================================================================
// §D — plan_approval (the pure fold)
// ===========================================================================

test('PA-START (RED): a run awaiting plan approval projects waitingOn.plan_approval beside the approve_plan interaction', async (t) => {
  const { application, driver } = harnessApp(t, markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'PA-START (marker:default): await approval', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  assert.equal(started.phase, 'awaiting_plan_approval', 'PIN: the fold phase is untouched');
  assert.deepEqual(started.blockedInteraction, { kind: 'approve_plan' }, 'PIN: the interaction still classifies');

  assert.ok(started.waitingOn, 'stage[plan-approval-projection-missing]: a run awaiting plan approval must project waitingOn');
  assert.equal(started.waitingOn.kind, 'plan_approval', 'stage[plan-approval-projection-missing]: the kind');
  assert.equal(started.waitingOn.since.turnEpoch, null, 'stage[plan-approval-projection-missing]: fence-less since');
  const proposal = driver.coordination.events(1).find((e) => e.kind === 'plan.version_proposed');
  assert.ok(proposal, 'PIN: the plan proposal event exists');
  assert.equal(started.waitingOn.since.eventSeq, proposal.seq, 'stage[plan-approval-projection-missing]: since = the proposal seq');
  assert.ok(started.waitingOn.detail?.planVersion !== undefined && started.waitingOn.detail.planVersion !== null,
    'stage[plan-approval-projection-missing]: the detail names the plan version');
  assert.equal(started.waitingOn.detail.proposalSeq, proposal.seq, 'stage[plan-approval-projection-missing]: the detail pins the proposal seq');
});

test('PA-SHOW (RED): plan_approval projects identically on view, outline, and runs.list', async (t) => {
  const { application } = harnessApp(t, markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'PA-SHOW (marker:default): parity', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const view = await application.status(started.runId, owner);
  assert.ok(view.waitingOn, 'stage[plan-approval-projection-missing]: the view carries waitingOn');
  const listed = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.ok(listed.waitingOn, 'stage[plan-approval-projection-missing]: the runs.list item carries waitingOn');
  assert.deepEqual(listed.waitingOn, view.waitingOn, 'the list item projects the SAME waitingOn');
  const outline = projectBatonCliResult(parseBatonCli(['run', 'status', started.runId]), view);
  assert.ok(outline.waitingOn, 'stage[plan-approval-projection-missing]: the outline carries waitingOn');
  assert.deepEqual(outline.waitingOn, view.waitingOn, 'the outline projects the SAME waitingOn');
});

test('PA-EXIT (RED): approve dispatches the run and waitingOn clears to null', async (t) => {
  const { application } = harnessApp(t, markerAdapter({
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'PA-EXIT (marker:default): approve away', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  const approved = await application.approve(started.runId, started.plan.digest, principal('approver'));
  assert.notEqual(approved.phase, 'awaiting_plan_approval', 'PIN: approval dispatches the run');
  assert.equal(approved.blockedInteraction, null, 'PIN: the interaction clears once dispatched');
  assert.equal(approved.waitingOn, null, 'stage[waiting-on-exit-missing]: an approved-and-dispatched run reads honest null');
});

test('PA-HONEST (RED): reduceMember classes plan_approval, never working', () => {
  assert.equal(typeof waveDriverNs.reduceMember, 'function', 'stage[reduceMember-missing]: reduceMember must be exported');
  const r = waveDriverNs.reduceMember([], null, WAIT('plan_approval'));
  assert.deepEqual(r, { class: 'plan_approval', blocked: false, waiting: true, gated: null, interactions: [] },
    'stage[reduceMember-missing]: the waiting shape for plan_approval');
});

test('PA-STRIP (RED): waitingOn.plan_approval transitions never move the wave marker', async () => {
  const wave = stripWave('plan_approval');
  const receipt = await createWaveDriver(wave.baton, { ...STRIP_POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall', 'stage[stallMarker-missing]: waitingOn transitions are stripped from the stall marker');
});

// ===========================================================================
// §E — provider_stalled (health.stall_suspected)
// ===========================================================================

async function stallSuspicion(driver, worker) {
  const raw = driver.coordinator._workers.get(worker.id);
  assert.ok(raw, 'PIN: the raw worker handle exists');
  return until(async () => {
    const events = driver.coordinator._log.read(worker.id);
    const s = events.find((e) => e.kind === 'health.stall_suspected');
    return s ?? null;
  }, 'stall suspicion minted', 10_000);
}

test('PS-START (RED): a watchdog stall suspicion projects waitingOn.provider_stalled with the suspicion epoch', async (t) => {
  const adapter = markerAdapter({ default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 2500 }] } });
  const { application, driver } = harnessApp(t, adapter, { watchdog: { stallMs: 60, stallAction: 'none' } });
  const owner = principal('owner');
  const started = await application.start({ objective: 'PS-START (marker:default): slow worker', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const worker = await until(async () => driver.coordinator.list().find((h) => h.taskId != null) ?? null, 'worker claimed');
  const suspicion = await stallSuspicion(driver, worker);

  const view = await application.status(started.runId, owner);
  assert.ok(view.waitingOn, 'stage[provider-stalled-projection-missing]: a suspected worker must project waitingOn');
  assert.equal(view.waitingOn.kind, 'provider_stalled', 'stage[provider-stalled-projection-missing]: the kind');
  assert.equal(view.waitingOn.since.eventSeq, suspicion.seq, 'stage[provider-stalled-projection-missing]: since = the suspicion seq');
  assert.equal(view.waitingOn.since.turnEpoch, suspicion.turnEpoch, 'stage[provider-stalled-projection-missing]: the suspicion epoch rides');
  assert.deepEqual(view.waitingOn.detail, { workerId: worker.id, taskId: worker.taskId, action: 'none' },
    'stage[provider-stalled-projection-missing]: the suspicion detail');

  const task = driver.coordinator._tasks.get(worker.taskId);
  assert.equal(task.status, 'working', 'PIN: the suspected worker is working, never paused — #88 vacuously safe');
  assert.equal(driver.coordinator.pausedTurns({ taskId: worker.taskId }).length, 0, 'PIN: no pause record for a suspected worker');
});

test('PS-SHOW (RED): provider_stalled projects identically on view, outline, and runs.list', async (t) => {
  const adapter = markerAdapter({ default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 2500 }] } });
  const { application, driver } = harnessApp(t, adapter, { watchdog: { stallMs: 60, stallAction: 'none' } });
  const owner = principal('owner');
  const started = await application.start({ objective: 'PS-SHOW (marker:default): parity', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const worker = await until(async () => driver.coordinator.list().find((h) => h.taskId != null) ?? null, 'worker claimed');
  await stallSuspicion(driver, worker);

  const view = await application.status(started.runId, owner);
  assert.ok(view.waitingOn, 'stage[provider-stalled-projection-missing]: the view carries waitingOn');
  const listed = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.ok(listed.waitingOn, 'stage[provider-stalled-projection-missing]: the runs.list item carries waitingOn');
  assert.deepEqual(listed.waitingOn, view.waitingOn, 'the list item projects the SAME waitingOn');
  const outline = projectBatonCliResult(parseBatonCli(['run', 'status', started.runId]), view);
  assert.ok(outline.waitingOn, 'stage[provider-stalled-projection-missing]: the outline carries waitingOn');
  assert.deepEqual(outline.waitingOn, view.waitingOn, 'the outline projects the SAME waitingOn');
});

test('PS-EXIT (RED): first worker content after the suspicion clears the stall projection to null', async (t) => {
  const adapter = markerAdapter({ default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 2500 }] } });
  const { application, driver } = harnessApp(t, adapter, { watchdog: { stallMs: 60, stallAction: 'none' } });
  const owner = principal('owner');
  const started = await application.start({ objective: 'PS-EXIT (marker:default): recovers', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const worker = await until(async () => driver.coordinator.list().find((h) => h.taskId != null) ?? null, 'worker claimed');
  const suspicion = await stallSuspicion(driver, worker);
  const stalledView = await application.status(started.runId, owner);
  assert.ok(stalledView.waitingOn, 'stage[provider-stalled-projection-missing]: the suspicion projects provider_stalled first');
  assert.equal(stalledView.waitingOn.kind, 'provider_stalled', 'stage[provider-stalled-projection-missing]: the stalled kind');

  driver.log.append({
    worker: worker.id, harness: 'mock@1.0.0', turnEpoch: (suspicion.turnEpoch ?? 0) + 1, actor: 'worker',
    kind: 'content.message', payload: { text: 'still working through the window' },
  });
  await sleep(80);
  const view = await application.status(started.runId, owner);
  assert.equal(view.waitingOn, null, 'stage[waiting-on-exit-missing]: first worker content after the suspicion clears the stall projection');
});

test('PS-HONEST (RED): a blocked member reads honest null — the interaction owns the projection; reduceMember classes provider_stalled, never working', async (t) => {
  assert.equal(typeof waveDriverNs.reduceMember, 'function', 'stage[reduceMember-missing]: reduceMember must be exported');
  const r = waveDriverNs.reduceMember([], null, WAIT('provider_stalled'));
  assert.deepEqual(r, { class: 'provider_stalled', blocked: false, waiting: true, gated: null, interactions: [] },
    'stage[reduceMember-missing]: the waiting shape for provider_stalled');

  const { application } = harnessApp(t, markerAdapter({
    q: { outcome: 'completed', edits: [], ask: { kind: 'question', question: 'which way?', blocking: true } },
  }));
  const owner = principal('owner');
  const started = await application.start({ objective: 'PS-HONEST (marker:q): block on a question', profile: 'standard', route: ROUTE, scope: ['**'] }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const view = await waitForBlockedAnswerQuestion(application, started.runId, owner);
  assert.equal(view.blockedInteraction.kind, 'answer_question', 'PIN: the interaction owns the member');
  assert.equal(view.waitingOn, null,
    'stage[waiting-on-honest-null-missing]: a blocked member reads honest null — never provider_stalled');
});

test('PS-STRIP (RED): waitingOn.provider_stalled transitions never move the wave marker', async () => {
  const wave = stripWave('provider_stalled');
  const receipt = await createWaveDriver(wave.baton, { ...STRIP_POLICY }).run({ members: wave.members });
  assert.equal(receipt.basis, 'stall', 'stage[stallMarker-missing]: waitingOn transitions are stripped from the stall marker');
});

// ===========================================================================
// §F — D9: the reduced flags, suppression, and the checkpoint⇒not-waiting invariant
// ===========================================================================

test('D9-INVARIANT (PIN): a drivered paused task reads the three raw spawn flags false', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, handle } = await driveredPause({ adapter });
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused', 'PIN: the drivered pause pends');
  const raw = coordinator._workers.get(handle.id);
  assert.ok(raw, 'PIN: the raw handle exists');
  assert.equal(raw.worktreeCreationPending, false, 'PIN: a paused task is never mid-worktree');
  assert.equal(raw.nativeSpawnPending, false, 'PIN: a paused task is never mid-spawn');
  assert.equal(raw.recoverySpawnPending, false, 'PIN: a paused task is never mid-recovery');
});

test('D9-COMPOUND (RED): a member with BOTH a claim-ready checkpoint AND waitingOn is never claimed — waiting beats checkpoint', async () => {
  const wave = fakeWave({
    w: {
      status: () => fakeView({ attention: [cpAtt('cp-1', CLAIM_READY)], waitingOn: WAIT('capacity_ceiling') }),
      act: () => ({ ok: true }),
    },
  });
  const receipt = await createWaveDriver(wave.baton, { ...DRIVER_POLICY }).run({ members: wave.members });
  assert.equal(actCallsOf(wave, 'w', 'claim_turn').length, 0,
    'stage[waiting-not-suppressed]: a waitingOn member is never claimed — the suppression gains `!reduced.waiting`');
  assert.equal(receipt.claims.length, 0, 'stage[waiting-not-suppressed]: no claims evidence for a suppressed member');
});

test('D9-SHAPE (RED): reduceMember exposes BOTH flags — blocked and waiting — and a checkpoint without waitingOn keeps its class', () => {
  assert.equal(typeof waveDriverNs.reduceMember, 'function', 'stage[reduceMember-missing]: reduceMember must be exported');
  const r = waveDriverNs.reduceMember([], null, WAIT('dispatch_pending'));
  assert.deepEqual(r, { class: 'dispatch_pending', blocked: false, waiting: true, gated: null, interactions: [] },
    'stage[reduceMember-missing]: the waiting shape exposes waiting:true');
  const c = waveDriverNs.reduceMember([], cpAtt('cp-1'), null);
  assert.equal(c.class, 'checkpoint', 'a checkpoint without waitingOn keeps its class');
  assert.equal(c.waiting, false, 'stage[reduceMember-missing]: the checkpoint shape exposes waiting:false');
  assert.equal(c.blocked, false, 'the checkpoint shape stays non-blocked');
});

// ===========================================================================
// §G — Digest + enum
// ===========================================================================

test('DIGEST (RED): semanticViewDigest is exported, moves on a waitingOn transition, and keeps the derived fields stripped', () => {
  assert.equal(typeof applicationNs.semanticViewDigest, 'function',
    'stage[digest-export-missing]: semanticViewDigest must be exported from application.mjs');
  const base = { schemaVersion: 1, phase: 'running', terminal: false, cursor: 0, attention: [] };
  const a = applicationNs.semanticViewDigest({ ...base, waitingOn: WAIT('capacity_ceiling', 'a') });
  const b = applicationNs.semanticViewDigest({ ...base, waitingOn: WAIT('capacity_ceiling', 'b') });
  assert.notEqual(a, b, 'a waitingOn transition moves the view digest — follow-change consumers wake');
  const withDerived = applicationNs.semanticViewDigest({
    ...base, cursor: 99, progressClass: 'silent', requiredAction: { kind: 'approve_plan' },
  });
  const withoutDerived = applicationNs.semanticViewDigest({ ...base });
  assert.equal(withDerived, withoutDerived,
    'cursor/progressClass/requiredAction stay stripped — the waitingOn asymmetry is deliberate');
});

test('WAITING_ON_KINDS (RED): the frozen CLOSED enum of exactly the five kinds', () => {
  assert.ok(applicationSemanticsNs.WAITING_ON_KINDS, 'stage[waiting-on-enum-missing]: WAITING_ON_KINDS must exist');
  assert.ok(Object.isFrozen(applicationSemanticsNs.WAITING_ON_KINDS),
    'stage[waiting-on-enum-missing]: the enum is frozen — a closed set, never grown silently');
  const values = [...applicationSemanticsNs.WAITING_ON_KINDS].sort();
  assert.deepEqual(values, WAITING_ON_KINDS_SORTED, 'stage[waiting-on-enum-missing]: the five closed kinds');
});

// ===========================================================================
// §H — Exoneration pins
// ===========================================================================

test('EXO-1 (PIN): a checkpoint WITHOUT waitingOn still claims exactly once — the ordinary pause is untouched', async () => {
  const wave = fakeWave({
    w: {
      status: () => fakeView({ attention: [cpAtt('cp-1', CLAIM_READY)] }),
      act: () => ({ ok: true }),
    },
  });
  const receipt = await createWaveDriver(wave.baton, { ...DRIVER_POLICY }).run({ members: wave.members });
  assert.equal(actCallsOf(wave, 'w', 'claim_turn').length, 1, 'a checkpoint member is claimed exactly once');
  assert.equal(receipt.claims.length, 1, 'one claims-evidence row');
});

test('EXO-2 (PIN): a blocking interaction WITHOUT waitingOn suppresses claim — the interaction precedence is unchanged', async () => {
  const wave = fakeWave({
    w: {
      status: () => fakeView({ attention: [qAtt('q-1')] }),
      act: () => ({ ok: true }),
    },
  });
  const receipt = await createWaveDriver(wave.baton, { ...DRIVER_POLICY }).run({ members: wave.members });
  assert.equal(actCallsOf(wave, 'w', 'claim_turn').length, 0, 'a blocked member is never claimed');
});

// ===========================================================================
// Verification (recorded against the PRE-implementation tree; see the header)
// ===========================================================================
