// Claim-time liveness preflight: refusal, capture failure, reservation rollback,
// and subsequent explicit coordinator claims.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

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
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
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

test('T18h: a refused claim leaves the checkpoint pending without automatic expiry', async () => {
  const adapter = new ScriptableAdapter();
  // DriverLESS (the only path that arms a TG3 cycle), a window big enough to outlive the
  // claim but small enough to fire inside the test.
  const { coordinator } = setup({ adapter, capture: noDiff, coordinatorOpts: { progressNudgeWindowMs: 100 } });
  const handle = await coordinator.spawn('mock', makeBrief());
  const task = coordinator._tasks.get(handle.taskId);
  emitFiveToolCalls(adapter, handle);
  emitTurnCompleted(adapter, handle);
  await flush(60);
  assert.equal(adapter.calls.prompt.length, 0, 'the checkpoint sends no automatic prompt');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused');
  const pauseId = coordinator.pausedTurns({ taskId: task.id })[0]?.pauseId;
  assert.ok(pauseId);

  const outcome = await claimOutcome(coordinator, pauseId);
  assert.equal(outcome?.result, 'claim_premature_liveness',
    `stage[cycle-ordering]: the claim refuses BEFORE the timer clear (got ${outcome?.result})`);
  const record = coordinator._pausedTurns.get(pauseId);
  assert.equal(record?.state, 'pending', 'rollback restored pending');
  assert.equal(record?.steering, undefined, 'a refusal does not arm an automatic cycle');

  // The window then expires unanswered: TODAY'S expiry lands the full gate with the
  // steering receipt — the cheaper save (the cycle) survives the refused claim.
  await sleep(180);
  await flush(40);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused',
    'elapsed time cannot overrule the refused claim');
  const settled = coordinator._log.read(handle.id).filter((event) => event.kind === 'turn.settled'
    && event.payload?.basis === 'steering_expired');
  assert.equal(settled.length, 0, 'elapsed time cannot settle the checkpoint');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.equal(verdictEvent, undefined, 'no automatic verdict follows the refusal');
});

test('T18g: a slow preflight capture cannot create expiry authority while the claim is reserved', async () => {
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
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'paused',
    'the refused claim restores the independently steerable checkpoint');
  assert.equal(coordinator._pausedTurns.get(pauseId).state, 'pending');
  const settled = coordinator._log.read(handle.id).filter((event) => event.kind === 'turn.settled'
    && event.payload?.basis === 'steering_expired');
  assert.equal(settled.length, 0, 'there is no deferred automatic expiry');
  const verdictEvent = coordinator._log.read(handle.id).find((event) => event.kind === 'error'
    && event.payload?.code === 'required_effect_absent');
  assert.equal(verdictEvent, undefined, 'the refused claim is not silently converted into a verdict');
});

test('T18c: a preflight throw releases its reservation and preserves a retryable checkpoint', async () => {
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
  const preClaimSeq = maxSeq(coordinator, handle);
  throwArmed = true;
  const first = await claimOutcome(coordinator, pauseId);
  assert.equal(first?.result, '__thrown__:capture_failed',
    'the claim REJECTS with the error\'s own typed code — a preflight throw is NOT a refusal (no claim_premature_liveness is minted)');
  const record = coordinator._pausedTurns.get(pauseId);
  assert.equal(record?.state, 'pending', 'rollback-on-throw restored pending');
  assert.equal(record?.consumer, null);
  assert.equal(record?.steering, undefined, 'a failed capture creates no automatic cycle');
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
