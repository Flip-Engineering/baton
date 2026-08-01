// Issue #31 slice B — turn checkpoints: the three steering acts (nudge/wait/claim), nudge's
// claim invalidation, stall-watchdog parity, and the honest `paused` projections. Red suite.
//
// Binding contract:
//   docs/reference/evidence/turn-checkpoints-2026-07-23/31b-steering-acts-decisions.md (v2 FINAL)
// Ground truth: docs/35-turn-checkpoints.md v2 §2.2(6-8)/§2.3.
// Depends on the LANDED 31-a compat spine (commit 4160e72): `_pausedTurns` keyed
// `pause:${task.id}:${seq}`, the `paused` task status + TRANSITIONS edges, story.mjs's
// TURN_PAUSED/TURN_SETTLED fold, and coordination-store.mjs's `paused` plan-node projection arm.
//
// Scope pinned here (31-b only):
//   Part A — each act reserves the pause record's OWN single-consumer slot; none ride
//            `_resolveRecord`, which reserves against the `_pending` INTERACTION family.
//   Part B — `nudge` is a FULL fresh-turn admission (reserve → admit → ack → bumpTurn →
//            same-task unpark → clearBudgetStop/resetWatchdogTurn → scratch expiry →
//            turn_started carrying pauseId → drain), never a resend through either existing lane.
//   Part C — `wait` is a receipt that NEVER consumes the record; all later acts stay legal.
//   Part D — `claim` re-runs the LIVE trust gate; `changedPathsDigest` is never gate input.
//   Part E — stall-guard parity by construction (one string comparison, no special case).
//   Part F — honest `paused` phase projections + the `turn_checkpoint` attention entry.
//
// Clocks are fixed (FIXED_NOW) in every fixture — no wall-clock time bombs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { createWave } from '../src/wave.mjs';

const FIXED_NOW = '2026-07-23T00:00:00.000Z';
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

const dirs = [];
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-31b-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function until(fn, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not met');
}

/** D1-conforming adapter whose card declares `turnCompletion: 'pausable'`. */
class ScriptableAdapter {
  constructor(turnCompletion = 'pausable') {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity,
      maxContext: 100000,
      verbs: {
        spawn: 'native', prompt: 'native', steer: 'native', interrupt: 'native',
        approve: 'native', answer: 'native', kill: 'native', pause: 'unsupported',
      },
      decision: 'native',
      ...(turnCompletion ? { turnCompletion } : {}),
    };
    this._cb = null;
    this.prompts = [];
    this.promptResult = { ok: true };
  }
  card() { return this._card; }
  onEvent(cb) { this._cb = cb; }
  emit(event) { if (this._cb) this._cb(event); }
  async spawn() { return { ok: true }; }
  async prompt(workerId, message, mode) {
    this.prompts.push({ workerId, message, mode });
    if (this.promptResult instanceof Error) throw this.promptResult;
    return this.promptResult;
  }
  async steer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

function harnessId(coordinator) {
  const card = coordinator._adapters.mock.card();
  return `${card.harness}@${card.version}`;
}

/**
 * Lightweight coordinator harness (mirrors 31-a's, plus a `captureCalls` counter — the positive
 * pin for Part D rule 8's "claim re-runs a LIVE capture, never a stored digest read").
 */
function kitFor({ turnCompletion = 'pausable' } = {}) {
  const d = dir();
  const log = new Log(join(d, 'log'));
  const coordination = coordinationForLog(log);
  const fences = new FenceTable();
  const adapter = new ScriptableAdapter(turnCompletion);
  const refereeCalls = [];
  const captureCalls = [];
  const coordinator = new Coordinator({
    log, coordination, fences, adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({
        path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base',
      }),
      capture: async (path, opts) => { captureCalls.push({ path, opts }); return { sha: 'sha-result' }; },
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async (...args) => {
      refereeCalls.push(args);
      return { reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' };
    },
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });
  return { coordinator, coordination, fences, adapter, refereeCalls, captureCalls };
}

const brief = (overrides = {}) => ({
  goal: 'g', constraints: [], pathScope: ['.'], definitionOfDone: 'd',
  verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 1000, usd: 1, wallMin: 1 }, ...overrides,
});

const workerResult = (overrides = {}) => ({
  status: 'completed', summary: 'ok',
  artifacts: { commits: ['sha1'], files: [] },
  verification: { command: 'true', claimedExit: 0 },
  openQuestions: [], budgetUsed: { tokens: 1, usd: 0.01 },
  ...overrides,
});

function completeTurn(kit, handle, turnEpoch = 1, payload = workerResult()) {
  kit.adapter.emit({
    worker: handle.id, harness: harnessId(kit.coordinator), turnEpoch,
    kind: 'lifecycle.turn_completed', actor: 'worker', payload,
  });
}

/** A live worker whose task is genuinely `paused` on an unconsumed 31-a pause record. */
async function pausedKit(options = {}) {
  const kit = kitFor(options);
  const spawned = await kit.coordinator.spawn('mock', brief(), {});
  await until(() => kit.coordinator.list()[0]?.status === 'working');
  // Every assertion below is against the LIVE internal handle — the public `spawn()` projection is
  // a snapshot and would silently read `undefined` for watchdog/admission fields.
  const handle = kit.coordinator._workers.get(spawned.id);
  const task = kit.coordinator._tasks.get(handle.taskId);
  // The liveness marker 31-a's `_admitPauseRecord` scans for: with a driver registered, the pause
  // does NOT auto-settle and the turn genuinely parks.
  kit.coordinator._coordRecord('steering.registered',
    { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${task.runId ?? 'null'}`, 'orchestrator');
  completeTurn(kit, handle);
  await until(() => kit.coordination.task(task.id).status === 'paused');
  const pauseId = [...kit.coordinator._pausedTurns.keys()].at(-1);
  return { ...kit, handle, task, pauseId };
}

const logKinds = (kit, workerId) => kit.coordinator._log.read(workerId).map((e) => e.kind);
const logEntries = (kit, workerId, kind) => kit.coordinator._log.read(workerId).filter((e) => e.kind === kind);

// ============================================================
// Part A — reservation + authority-op discipline (rules 1-2)
// ============================================================

test('A1: a second nudge against an already-resolving pause record waits on `resolvingDone` and '
  + 'then reports already_resolved — the same shape `_resolveRecord` gives a racing respond()', async () => {
  const kit = await pausedKit();
  let releasePrompt;
  kit.adapter.prompt = async () => {
    await new Promise((resolve) => { releasePrompt = resolve; });
    return { ok: true };
  };

  const first = kit.coordinator.nudgeTurn(kit.pauseId, 'keep going');
  await until(() => kit.coordinator._pausedTurns.get(kit.pauseId).state === 'resolving');
  // The racing caller must PARK on the reservation, not double-admit.
  const second = kit.coordinator.nudgeTurn(kit.pauseId, 'keep going too');
  releasePrompt();

  assert.equal((await first).ok, true);
  const raced = await second;
  assert.equal(raced.ok, false);
  assert.equal(raced.result, 'already_resolved');
  assert.equal(kit.coordinator._pausedTurns.get(kit.pauseId).state, 'resolved');
  // Exactly ONE fresh turn was admitted, never two.
  assert.equal(logEntries(kit, kit.handle.id, 'lifecycle.turn_started')
    .filter((e) => e.payload?.pauseId === kit.pauseId).length, 1);
});

test('A1b: `claim` racing a resolved record gets the same already_resolved refusal — the '
  + 'reservation is per-record, not per-act', async () => {
  const kit = await pausedKit();
  assert.equal((await kit.coordinator.nudgeTurn(kit.pauseId, 'go')).ok, true);
  const claimed = await kit.coordinator.claimTurn(kit.pauseId);
  assert.equal(claimed.ok, false);
  assert.equal(claimed.result, 'already_resolved');
  assert.equal(kit.coordinator.pausedTurnStatus(kit.pauseId).state, 'resolved');
});

test('A2: a pause record lives on `_pausedTurns` under 31-a\'s `pause:${task.id}:${seq}` key, and '
  + 'neither reservation family\'s state transition touches the other', async () => {
  const kit = await pausedKit();
  assert.ok(kit.pauseId.startsWith(`pause:${kit.task.id}:`),
    'the key space is 31-a\'s task-scoped one, not a second worker-scoped map');
  assert.equal(kit.coordinator._pausedTurns.get(kit.pauseId).state, 'pending');

  // An INTERACTION record for the SAME worker/task. Injected directly rather than emitted:
  // 31-a's TRANSITIONS has no `paused -> input_required` edge, so a live question cannot legally
  // be asked while the turn is parked — the point here is that the two reservation FAMILIES are
  // disjoint, which the record's presence in `_pending` is sufficient to pin.
  const requestId = 'q-1';
  kit.coordinator._pending.set(requestId, {
    kind: 'question', state: 'pending', resolution: null, consumer: null,
    worker: kit.handle.id, question: 'which branch?', turnEpochAtAsk: 1, fenceAtAsk: 1,
  });

  // The two maps are genuinely disjoint families.
  assert.ok(!kit.coordinator._pending.has(kit.pauseId));
  assert.ok(!kit.coordinator._pausedTurns.has(requestId));

  // Resolving the pause record leaves the interaction record untouched...
  const pendingBefore = kit.coordinator._pending.get(requestId).state;
  await kit.coordinator.nudgeTurn(kit.pauseId, 'go');
  assert.equal(kit.coordinator._pausedTurns.get(kit.pauseId).state, 'resolved');
  assert.equal(kit.coordinator._pending.get(requestId).state, pendingBefore);
});

// ============================================================
// Part B — nudge: a full fresh-turn admission (rules 3-5)
// ============================================================

test('B1: nudge admits a FRESH turn on the SAME task — fence bumped, task/handle status working, '
  + 'watchdog genuinely RE-ARMED (a live timer, not a bumped generation), budget stop cleared, '
  + 'turn_started carries pauseId', async () => {
  const kit = await pausedKit();
  const { coordinator, handle, task, pauseId } = kit;
  const taskIdBefore = task.id;
  const fenceBefore = coordinator._fences.current(handle.id).fence;
  const generationBefore = handle.watchdogGeneration ?? 0;
  const timerBefore = handle.watchdogTimer;
  handle.watchdogActions = new Set(['stall']);
  handle.budgetStopTimer = setTimeout(() => {}, 60_000);

  const result = await coordinator.nudgeTurn(pauseId, 'continue with the next step');
  assert.equal(result.ok, true);
  assert.equal(result.result, 'nudged');

  // (b) the governance/reserve gate ran and its queue drained.
  assert.equal(handle.turnAdmission, null);
  assert.deepEqual(kit.adapter.prompts.map((p) => p.mode), ['turn']);
  // (c) the fence advanced exactly one turn.
  assert.equal(coordinator._fences.current(handle.id).fence, fenceBefore + 1);
  // (d) SAME task unparked in place — never `_deliverFollowUp`'s new refinement task id.
  assert.equal(handle.taskId, taskIdBefore, 'nudge must not mint a new task id');
  assert.equal(result.taskId, taskIdBefore);
  assert.equal(task.status, 'working');
  assert.equal(handle.status, 'working');
  assert.equal(kit.coordination.task(taskIdBefore).status, 'working');
  // (e) budget stop cleared.
  assert.equal(handle.budgetStopTimer, null);
  // (f) the watchdog is genuinely re-armed — a LIVE timer, never generation-only.
  assert.notEqual(handle.watchdogGeneration, generationBefore);
  assert.ok(handle.watchdogTimer != null, 'nudge must re-arm a LIVE stall timer');
  assert.notEqual(handle.watchdogTimer, timerBefore, 'and a genuinely fresh one');
  assert.equal(handle.watchdogActions.size, 0);
  assert.deepEqual(handle.recentFailedActions, []);
  // (h) the durable admission event carries the resolved pause record's id.
  const started = logEntries(kit, handle.id, 'lifecycle.turn_started').at(-1);
  assert.equal(started.payload.pauseId, pauseId);
  assert.equal(started.payload.nudged, true);
  // The same-task unpark is evidenced by 31-a's symmetric fold kind, never `control.nudge`.
  const settled = logEntries(kit, handle.id, 'turn.settled').at(-1);
  assert.equal(settled.payload.basis, 'nudge');
  assert.ok(!logKinds(kit, handle.id).includes('control.nudge'),
    'nudge must not degrade to the bare prompt lane');

  clearTimeout(handle.watchdogTimer);
});

test('B2: the bare `_deliver(mode:"nudge")` lane does NONE of the bundle on the same fixture — '
  + 'today\'s behavior, unchanged, and the reason nudge cannot be that call', async () => {
  const kit = await pausedKit();
  const { coordinator, handle } = kit;
  const fenceBefore = coordinator._fences.current(handle.id).fence;
  const generationBefore = handle.watchdogGeneration ?? 0;
  handle.watchdogActions = new Set(['stall']);

  const delivered = await coordinator._deliver(handle, 'just a nudge', 'nudge', {});

  assert.equal(delivered.ok, true, 'the bare lane still delivers — it just does nothing else');
  assert.ok(logKinds(kit, handle.id).includes('control.nudge'),
    'the bare lane logs control.nudge, the collision this contract forecloses wiring onto');
  assert.equal(coordinator._fences.current(handle.id).fence, fenceBefore,
    'the bare lane never bumps the turn fence');
  assert.equal(handle.watchdogGeneration ?? 0, generationBefore,
    'the bare lane never resets the watchdog turn (no _resetWatchdogTurn call site exists in it)');
  assert.deepEqual([...(handle.watchdogActions ?? [])], ['stall'],
    'and it never clears the per-turn watchdog action set');
  assert.equal(coordinator._pausedTurns.get(kit.pauseId).state, 'pending',
    'the bare lane never consumes the pause record');
});

test('B3: `_deliverFollowUp` is unreachable for a paused task\'s worker — the reusableFollowUp '
  + 'gate is keyed on TERMINAL_TASK_STATUSES and `paused` is deliberately non-terminal', async () => {
  const kit = await pausedKit();
  const { coordinator, handle, task } = kit;
  assert.equal(task.status, 'paused');
  // The gate: a non-terminal task is not a reusable follow-up, so an idle-or-parked worker's
  // `send(mode:'turn')` refuses BEFORE any admission bundle can run.
  const inner = coordinator._workers.get(handle.id);
  inner.status = 'idle';
  const refused = await coordinator._deliver(inner, 'resume please', 'turn', {});
  assert.equal(refused.ok, false);
  assert.equal(refused.result, 'worker_not_active');
  assert.equal(coordinator._pausedTurns.get(kit.pauseId).state, 'pending');
});

test('B4: nudge expires ONLY scratch claims CAS\'d on the pre-nudge fence, with a `turn_nudged` '
  + 'reason; a post-nudge-fence claim survives and BOARD claims are untouched', async () => {
  const kit = await pausedKit();
  const { coordinator, coordination, handle, task } = kit;
  const envRef = { repoId: 'repo-31b', treeSha: 'a'.repeat(40) };
  const preFence = coordinator._fences.current(handle.id).fence;

  // A scratch claim pinned to the PRE-nudge fence — nudge's fresh turn supersedes it.
  coordination.claimScratch(
    { id: 'sc-old', resource: 'res/old', envRef, ownerWorker: handle.id, ownerTask: task.id, fence: preFence },
    { actor: 'orchestrator', key: 'sc:old' },
  );
  // A scratch claim already pinned to the POST-nudge fence — never in the filtered set.
  coordination.claimScratch(
    { id: 'sc-new', resource: 'res/new', envRef, ownerWorker: handle.id, ownerTask: task.id, fence: preFence + 1 },
    { actor: 'orchestrator', key: 'sc:new' },
  );

  const result = await coordinator.nudgeTurn(kit.pauseId, 'go');
  assert.equal(result.ok, true);
  assert.deepEqual(result.expiredScratchClaims, ['sc-old']);

  const active = coordination.activeScratchClaims({ workerId: handle.id, taskId: task.id })
    .map((claim) => claim.id);
  assert.ok(!active.includes('sc-old'), 'the pre-nudge-fence claim is expired');
  assert.ok(active.includes('sc-new'), 'a claim on the post-nudge fence is NOT expired');

  // The expiry is the version-CAS mirror, distinguished from `provider_turn_failed`.
  const expiries = coordination.events().filter((e) => e.kind === 'scratch.claim_expired');
  assert.equal(expiries.length, 1);
  assert.ok(String(expiries[0].idempotencyKey).endsWith(':turn_nudged'),
    'nudge is a policy-driven continuation, never a provider failure');

  // Board claims CAS on a BOARD-scoped fence, never the worker turn fence — fence-filtering them
  // off the turn fence would be a category error, so nudge must not touch them at all.
  assert.equal(coordination.events().some((e) => e.kind === 'board.claim_expired'), false);
  clearTimeout(handle.watchdogTimer);
});

// ============================================================
// Part C — wait: the legal zero-cost park (rule 6, the P0-1 fix)
// ============================================================

test('C1: wait leaves fence, watchdog, budget stop, and every claim byte-identical, appends a '
  + '`turn.wait_noted {pauseId, actor}` receipt, and does NOT touch the record state', async () => {
  const kit = await pausedKit();
  const { coordinator, coordination, handle, task, pauseId } = kit;
  const envRef = { repoId: 'repo-31b', treeSha: 'b'.repeat(40) };
  coordination.claimScratch(
    { id: 'sc-wait', resource: 'res/wait', envRef, ownerWorker: handle.id, ownerTask: task.id, fence: 1 },
    { actor: 'orchestrator', key: 'sc:wait' },
  );
  const before = {
    fence: coordinator._fences.current(handle.id).fence,
    turnEpoch: coordinator._fences.current(handle.id).turnEpoch,
    generation: handle.watchdogGeneration,
    timer: handle.watchdogTimer,
    budgetStop: handle.budgetStopTimer ?? null,
    claims: coordination.activeScratchClaims({ workerId: handle.id, taskId: task.id }).map((c) => c.id),
    taskStatus: task.status,
  };

  const noted = coordinator.waitTurn(pauseId, { actor: 'orchestrator' });
  assert.equal(noted.ok, true);
  assert.equal(noted.result, 'wait_noted');
  assert.equal(noted.state, 'pending');

  // Zero cost, exactly.
  assert.equal(coordinator._fences.current(handle.id).fence, before.fence);
  assert.equal(coordinator._fences.current(handle.id).turnEpoch, before.turnEpoch);
  assert.equal(handle.watchdogGeneration, before.generation);
  assert.equal(handle.watchdogTimer, before.timer);
  assert.equal(handle.budgetStopTimer ?? null, before.budgetStop);
  assert.deepEqual(
    coordination.activeScratchClaims({ workerId: handle.id, taskId: task.id }).map((c) => c.id),
    before.claims,
  );
  assert.equal(task.status, before.taskStatus, 'wait never unparks the task');

  // The reservation is genuinely untouched — `pending`, never `resolved`.
  assert.equal(coordinator._pausedTurns.get(pauseId).state, 'pending');
  assert.equal(coordinator._pausedTurns.get(pauseId).consumer, null);

  const receipt = logEntries(kit, handle.id, 'turn.wait_noted').at(-1);
  assert.equal(receipt.payload.pauseId, pauseId);
  assert.equal(receipt.payload.actor, 'orchestrator');
});

test('C2: wait never wedges the record — wait -> nudge succeeds on the SAME pause record', async () => {
  const kit = await pausedKit();
  assert.equal(kit.coordinator.waitTurn(kit.pauseId).ok, true);
  const nudged = await kit.coordinator.nudgeTurn(kit.pauseId, 'now go');
  assert.equal(nudged.ok, true, 'a prior wait must not consume the reservation');
  assert.equal(nudged.pauseId, kit.pauseId);
  clearTimeout(kit.handle.watchdogTimer);
});

test('C3: wait -> claim succeeds on the SAME pause record, and wait -> wait is an idempotent '
  + 'receipt that still leaves `state` pending', async () => {
  const kit = await pausedKit();
  assert.equal(kit.coordinator.waitTurn(kit.pauseId).ok, true);
  assert.equal(kit.coordinator.waitTurn(kit.pauseId).ok, true);
  assert.equal(kit.coordinator.waitTurn(kit.pauseId).ok, true);
  // Each call appends its OWN receipt; none of them touch the reservation.
  assert.equal(logEntries(kit, kit.handle.id, 'turn.wait_noted').length, 3);
  assert.equal(kit.coordinator._pausedTurns.get(kit.pauseId).state, 'pending');

  const claimed = await kit.coordinator.claimTurn(kit.pauseId);
  assert.equal(claimed.ok, true, 'a prior wait must not block a later claim');
  assert.ok(['completed', 'failed'].includes(claimed.outcome));
});

// ============================================================
// Part D — claim: the trust gate against a FRESH live capture (rules 7-9)
// ============================================================

test('D1: claim RE-RUNS the live trust gate — a fresh `_worktrees.capture()` is observed at claim '
  + 'time, never a read of the pause record\'s stored changedPathsDigest', async () => {
  const kit = await pausedKit();
  const { coordinator, captureCalls, refereeCalls, pauseId, task } = kit;
  // The parked turn skipped the gate entirely (31-a Part D): nothing captured, nothing verified.
  assert.equal(captureCalls.length, 0);
  assert.equal(refereeCalls.length, 0);
  // The digest exists on the record — and is deliberately NOT what the gate consumes.
  assert.equal(typeof coordinator._pausedTurns.get(pauseId).changedPathsDigest, 'string');

  const claimed = await coordinator.claimTurn(pauseId);
  assert.equal(claimed.ok, true);
  assert.equal(captureCalls.length, 1, 'claim runs ONE live capture against the current worktree');
  assert.equal(captureCalls[0].path, `/tmp/wt/${task.id}`);
  assert.equal(refereeCalls.length, 1, 'and the same verification an ordinary completion runs');
});

test('D2: claim resolves to exactly `completed` or `failed` — the gate\'s only two outcomes — and '
  + 'never bumps the fence or touches the watchdog (that is nudge\'s job, not claim\'s)', async () => {
  const kit = await pausedKit();
  const { coordinator, handle, pauseId } = kit;
  const fenceBefore = coordinator._fences.current(handle.id).fence;
  const generationBefore = handle.watchdogGeneration;

  const claimed = await coordinator.claimTurn(pauseId);
  assert.equal(claimed.ok, true);
  assert.ok(['completed', 'failed'].includes(claimed.outcome),
    `claim produced an undefined third outcome: ${claimed.outcome}`);
  assert.equal(coordinator._coordination.task(claimed.taskId).status, claimed.outcome);
  assert.equal(coordinator._fences.current(handle.id).fence, fenceBefore,
    'claim admits no fresh turn, so it must not advance the turn fence');
  assert.equal(handle.watchdogGeneration, generationBefore,
    'claim re-arms no watchdog — there is no new turn to guard');
  // The reservation committed only after the gate durably landed.
  assert.equal(coordinator._pausedTurns.get(pauseId).state, 'resolved');
  assert.equal(coordinator._pausedTurns.get(pauseId).resolution.act, 'claim');
});

test('D3: no act-layer name COLLIDES with `wave.settle` — the rename from v1\'s `settle` is total; '
  + '31-a\'s `turn.settled` fold kind is a legitimate, differently-named survivor', async () => {
  const source = readFileSync(join(SRC, 'coordinator.mjs'), 'utf8');
  // The act is `claimTurn`, and no `settleTurn`/`settlePause`-shaped act exists.
  assert.ok(/\basync claimTurn\(/.test(source));
  assert.ok(!/\bsettleTurn\b|\bsettlePause\b|\bpauseSettle\b/.test(source),
    'no steering act may carry a `settle` name at this layer');
  // wave.settle is untouched and still the wave-outcome collector it always was.
  const wave = readFileSync(join(SRC, 'wave.mjs'), 'utf8');
  assert.ok(/async function settle\(\{ timeoutMs = 60_000 \} = \{\} \)?/.test(wave)
    || /async function settle\(\{ timeoutMs = 60_000 \} = \{\}\)/.test(wave),
    'wave.settle keeps its exact signature');
});

// ============================================================
// Part E — stall-watchdog parity by construction (rules 10-11)
// ============================================================

/** A coordinator whose stall watchdog fires almost immediately, so parity is observable. */
function stallKit() {
  const d = dir();
  const log = new Log(join(d, 'log'));
  const coordination = coordinationForLog(log);
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { mock: new ScriptableAdapter() },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-result' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
    watchdog: { stallMs: 20, stallAction: 'interrupt' },
  });
  return { coordinator, coordination, log };
}

test('E1: a stall watchdog fired while the task is `paused` performs NO action — the SAME '
  + 'parametrized fixture proves identical behavior for blocked/input_required, and that '
  + '`working` is the one status that DOES fire', async () => {
  const observed = {};
  for (const status of ['working', 'blocked', 'input_required', 'paused']) {
    const kit = stallKit();
    const spawned = await kit.coordinator.spawn('mock', brief(), {});
    await until(() => kit.coordinator.list()[0]?.status === 'working');
    const handle = kit.coordinator._workers.get(spawned.id);
    const task = kit.coordinator._tasks.get(handle.taskId);
    // The handle stays `working` in every arm — ONLY the task status varies, which is exactly the
    // single boolean comparison the guard makes.
    handle.status = 'working';
    task.status = status;
    handle.watchdogActions = new Set();
    kit.coordinator._armWatchdog(handle);
    await new Promise((resolve) => setTimeout(resolve, 80));
    observed[status] = kit.coordinator._log.read(handle.id)
      .some((event) => event.kind === 'health.stall_suspected');
    if (handle.watchdogTimer != null) clearTimeout(handle.watchdogTimer);
  }
  assert.equal(observed.working, true, 'a genuinely working task still stalls — no regression');
  assert.equal(observed.blocked, false);
  assert.equal(observed.input_required, false);
  assert.equal(observed.paused, false,
    '`paused` joins the guard by the same string comparison, not a special case');
});

test('E2: the load-bearing guard still reads `task.status !== \'working\'` verbatim — a source pin '
  + 'against a future refactor silently narrowing it to an allowlist (rule 11)', () => {
  const source = readFileSync(join(SRC, 'coordinator.mjs'), 'utf8');
  assert.ok(
    source.includes("if (!task || task.status !== 'working' || handle.watchdogActions?.has('stall')) return;"),
    'the stall guard must stay a single negated string comparison',
  );
});

test('E3: `lifecycle.turn_completed` CLEARS the watchdog for a pausable card (it never re-arms it) '
  + '— pinning the correction that only a fresh admission re-arms', async () => {
  const kit = kitFor();
  const spawned = await kit.coordinator.spawn('mock', brief(), {});
  await until(() => kit.coordinator.list()[0]?.status === 'working');
  const handle = kit.coordinator._workers.get(spawned.id);
  const task = kit.coordinator._tasks.get(handle.taskId);
  kit.coordinator._coordRecord('steering.registered',
    { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${task.runId ?? 'null'}`, 'orchestrator');
  const generationBefore = handle.watchdogGeneration;

  completeTurn(kit, handle);
  await until(() => kit.coordination.task(task.id).status === 'paused');

  // `_clearWatchdog` bumps the generation; `_resetWatchdogTurn` would ALSO have reset the
  // per-turn action set and orientation state, which the turn-completed handler never does.
  assert.notEqual(handle.watchdogGeneration, generationBefore, 'the watchdog was cleared');
  assert.ok(!kit.coordinator._log.read(handle.id).some((e) => e.kind === 'lifecycle.turn_started'
    && e.payload?.pauseId), 'nothing re-admitted a turn on completion');
  if (handle.watchdogTimer != null) clearTimeout(handle.watchdogTimer);
});

// ============================================================
// Part F — honest `paused` projections + turn_checkpoint attention (rules 12-16)
// ============================================================

test('F1: wave.mjs classifies a `paused` member as `turn_checkpoint` through progress(), with no '
  + 'explicit attention override and no wave source change beyond that one branch', async () => {
  const statuses = { alpha: { phase: 'paused', attention: undefined } };
  const baton = {
    runs: {
      start: async (objective) => ({
        approve: async () => {},
        status: async () => ({ view: statuses.alpha }),
        complete: async () => new Promise(() => {}),
        objective,
      }),
    },
  };
  const wave = await createWave(baton, {
    members: [{ role: 'alpha', objective: 'do the thing', scope: ['impl/**'] }],
  });
  const snapshot = await wave.progress();
  assert.equal(snapshot.members[0].phase, 'paused');
  assert.equal(snapshot.members[0].attention, 'turn_checkpoint');
  assert.equal(snapshot.members[0].terminal, false, 'a checkpoint is not an outcome');

  // An explicit attention override still wins — the branch is a DEFAULT, never an escalation.
  statuses.alpha = { phase: 'paused', attention: 'blocked_interaction:answer_required' };
  const overridden = await wave.progress();
  assert.equal(overridden.members[0].attention, 'blocked_interaction:answer_required');
});

test('F2: all three RunView phase ternaries carry an explicit `paused` branch, each checked '
  + 'BEFORE its running/dispatched fallback and each left subordinate to runStop precedence', () => {
  const source = readFileSync(join(SRC, 'application.mjs'), 'utf8');
  // `_historicalProfileView` (31-a landed this one), `_buildWorkflowView`, `_buildView`.
  const branches = [
    ": node?.state === 'paused' ? 'paused'",
    ": attempts.some((attempt) => attempt.state === 'paused') ? 'paused'",
    "else if (node.state === 'paused') phase = 'paused';",
  ];
  for (const branch of branches) {
    assert.ok(source.includes(branch), `missing honest paused branch: ${branch}`);
  }
  // Each paused branch precedes the running/dispatched fallback it would otherwise fall through to.
  assert.ok(source.indexOf(": node?.state === 'paused' ? 'paused'")
    < source.indexOf(": node?.taskId ? 'running' : 'approved'"));
  assert.ok(source.indexOf(": attempts.some((attempt) => attempt.state === 'paused') ? 'paused'")
    < source.indexOf(": anyDispatched ? 'running' : 'approved'"));
  assert.ok(source.indexOf("else if (node.state === 'paused') phase = 'paused';")
    < source.indexOf('else if (node.taskId) phase = \'running\';'));
  // ...and every one of them stays subordinate to the runStop precedence that follows the ternary.
  assert.equal(source.split("if (runStop?.status === 'stopped') phase = 'stopped';").length - 1, 3);
});

test('F3: the coordinator exposes still-unconsumed pause records for the `turn_checkpoint` '
  + 'attention entry, carrying the `requestId: pauseId` that _semanticActions\' guard requires; '
  + 'a resolved pause disappears from the projection', async () => {
  const kit = await pausedKit();
  const rows = kit.coordinator.pausedTurns({ taskId: kit.task.id });
  assert.equal(rows.length, 1);
  // BD v2: a completed park also carries `claim` from the durable pause-origin field
  // (absent only for pre-v2 events without origin) — status completed, summary wrapped
  // untrusted or null when the turn carried none.
  assert.deepEqual(Object.keys(rows[0]).sort(),
    ['changedPathsDigest', 'claim', 'consumer', 'pauseId', 'state', 'taskId', 'turnEpoch', 'workerId']);
  assert.equal(rows[0].claim.status, 'completed');
  assert.ok(rows[0].claim.summary === null
    || (typeof rows[0].claim.summary === 'object' && rows[0].claim.summary.untrusted === true));
  assert.equal(rows[0].pauseId, kit.pauseId);
  assert.equal(rows[0].workerId, kit.handle.id);
  // `validText(attention.requestId, 4_096)` — a generic non-empty/no-null-byte/<=4096-byte check.
  assert.ok(rows[0].pauseId.length > 0 && rows[0].pauseId.length <= 4096);
  assert.ok(!rows[0].pauseId.includes('\0'));

  // The attention entry is pushed ALONGSIDE interactions, never instead of them.
  const source = readFileSync(join(SRC, 'application.mjs'), 'utf8');
  assert.ok(source.includes("kind: 'turn_checkpoint',"));
  assert.ok(source.indexOf('allAttention.push(...projectDecisionAttention(this.driver.coordinator, workers));')
    < source.indexOf("kind: 'turn_checkpoint',"));

  // Once the pause resolves, the checkpoint is gone — the driver has nothing left to act on.
  await kit.coordinator.claimTurn(kit.pauseId);
  assert.deepEqual(kit.coordinator.pausedTurns({ taskId: kit.task.id }), []);
});

test('F4: all FOUR pre-existing `nudge` literals stay the BARE prompt lane — the new act adds no '
  + 'MCP tool, no enum member, and redefines none of them (rule 16 / Part H)', () => {
  const mcp = readFileSync(join(SRC, 'mcp-northbound.mjs'), 'utf8');
  const occurrences = (haystack, needle) => haystack.split(needle).length - 1;
  // fleet_run_steer.mode, fleet_run_workstream_notify.delivery, baton_workstream_notify.delivery
  assert.equal(occurrences(mcp, "['nudge', 'now', 'turn']"), 3);
  // fleet_send.mode plus its own validation echo
  assert.equal(occurrences(mcp, "['turn', 'steer', 'nudge']"), 2);
  // No new act verb was smuggled into the MCP surface.
  for (const smuggled of ['nudge_turn', 'wait_turn', 'claim_turn', 'turn_checkpoint']) {
    assert.ok(!mcp.includes(smuggled), `${smuggled} must not appear as an MCP schema literal`);
  }
  // And the bare lane still logs `control.nudge` — the collision this contract forecloses wiring to.
  const coordinator = readFileSync(join(SRC, 'coordinator.mjs'), 'utf8');
  assert.ok(coordinator.includes("mode === 'nudge' ? 'control.nudge'"));
});
