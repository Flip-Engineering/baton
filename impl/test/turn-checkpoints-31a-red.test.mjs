// Issue #31 slice A — turn checkpoints: card declaration, pause records, `paused` lifecycle
// parity, and degenerate auto-settle. Red suite.
//
// Binding contract:
//   docs/reference/evidence/turn-checkpoints-2026-07-23/31a-pause-records-decisions.md (v2 FINAL)
// Ground truth: docs/35-turn-checkpoints.md v2 (§2.1 rules 1-3, §2.2 rules 4-5).
//
// Scope pinned here (31-a only):
//   Part A — `card().turnCompletion` ∈ {'claim','pausable'}, absent ⇒ 'claim', read through the
//            single `_turnCompletionOf` helper.
//   Part B — `turn.paused` durable per-worker record + the `_pausedTurns` single-consumer map
//            keyed `pause:${task.id}:${seq}`.
//   Part C — `paused` as `input_required`'s sibling: TRANSITIONS, the named guard sites,
//            `_deriveWorkerStatus`, story.mjs fold parity.
//   Part D — degenerate auto-settle (`turn.settled {basis:'auto_no_driver'}`) through the ONE
//            pre-existing gated `_runTrustGate` dispatch, and the `hasDriver` parked case.
//
// NOT in scope (31-b, per contract Part F): steering acts (nudge/wait/claim), wave.mjs's
// `driverKind:'wave'` caller, and `attentionFrom('paused') === 'turn_checkpoint'`. This suite
// ships the machinery with NO production caller — every run in the current tree takes the
// `!hasDriver` degenerate path, which is the backward-compat spine.
//
// Clocks are fixed (FIXED_NOW) in every fixture — no wall-clock time bombs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BatonApplication, createDriver } from '../src/index.mjs';

import { CoordinationRefusal, CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { KIND, foldEvent, initialState } from '../src/story.mjs';
import { ClaudeSessionCli, GlmSessionCli, KimiSessionCli } from '../src/claude-session.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { KimiAcpCli } from '../src/kimi-acp.mjs';
import { ClaudeAdapter, CodexAdapter, GlmAdapter, MockAdapter } from '../src/adapter.mjs';

// A fixed clock — never `Date.now()` in a fixture (issue #42 discipline).
const FIXED_NOW = '2026-07-23T00:00:00.000Z';
const fixedClock = () => FIXED_NOW;

const dirs = [];
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-31a-'));
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

// `canonicalDigest` is coordinator-local (coordinator.mjs:297); recompute its empty-array value
// here rather than exporting an internal just for a test.
const DIGEST_OF_EMPTY = createHash('sha256').update(JSON.stringify([])).digest('hex');

/** Minimal D1-conforming adapter whose card's `turnCompletion` is caller-controlled. */
class ScriptableAdapter {
  constructor(turnCompletion) {
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
  }
  card() { return this._card; }
  onEvent(cb) { this._cb = cb; }
  emit(event) { if (this._cb) this._cb(event); }
  async spawn() { return { ok: true }; }
  async prompt() { return { ok: true }; }
  async steer() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

function harness(coordinator) {
  return `${coordinator._adapters.mock.card().harness}@${coordinator._adapters.mock.card().version}`;
}

/**
 * Lightweight coordinator (mirrors reflex2-boards-red.test.mjs's documented harness). `refereeCalls`
 * counts trust-gate entries — the positive/negative pin for whether `_runTrustGate` dispatched.
 */
function lightweightCoordinator({ turnCompletion = null, sessionContext = undefined } = {}) {
  const d = dir();
  const log = new Log(join(d, 'log'));
  const coordination = coordinationForLog(log);
  const fences = new FenceTable();
  const adapter = new ScriptableAdapter(turnCompletion);
  const refereeCalls = [];
  const coordinator = new Coordinator({
    log, coordination, fences, adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({
        path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base',
        ...(sessionContext ?? {}),
      }),
      capture: async () => ({ sha: 'sha-result' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async (...args) => {
      refereeCalls.push(args);
      return { reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' };
    },
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });
  return { coordinator, coordination, fences, adapter, refereeCalls };
}

function brief(overrides = {}) {
  return {
    goal: 'g', constraints: [], pathScope: ['.'], definitionOfDone: 'd',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 1 }, ...overrides,
  };
}

function workerResult(overrides = {}) {
  return {
    status: 'completed', summary: 'ok',
    artifacts: { commits: ['sha1'], files: [] },
    verification: { command: 'true', claimedExit: 0 },
    openQuestions: [], budgetUsed: { tokens: 1, usd: 0.01 },
    ...overrides,
  };
}

/** Spawn a worker and drive it to `working`. */
async function liveWorker(kit, spawnOpts = {}) {
  const handle = await kit.coordinator.spawn('mock', brief(), spawnOpts);
  await until(() => kit.coordinator.list()[0]?.status === 'working');
  return handle;
}

function completeTurn(kit, handle, payload = workerResult()) {
  kit.adapter.emit({
    worker: handle.id, harness: harness(kit.coordinator), turnEpoch: 1,
    kind: 'lifecycle.turn_completed', actor: 'worker', payload,
  });
}

// ============================================================
// Part A — card().turnCompletion declaration + default
// ============================================================

test('A1: a card with no turnCompletion field reads as "claim" — the silent default', () => {
  const { coordinator } = lightweightCoordinator();
  // MockAdapter declares no `turnCompletion` (adapter.mjs:206-227) and must not have to.
  assert.equal(new MockAdapter({}).card().turnCompletion, undefined);
  assert.equal(coordinator._turnCompletionOf({ vendor: 'mock' }), 'claim');
  // An unknown vendor also defaults, never throws.
  assert.equal(coordinator._turnCompletionOf({ vendor: 'nope' }), 'claim');
});

test('A2: the five production harness identities declare turnCompletion "pausable"', () => {
  // ClaudeSessionCli is constructible with no opts (claude-session.test.mjs:112); the three ACP/
  // app-server CLIs probe their version synchronously and swallow the probe failure.
  assert.equal(new ClaudeSessionCli({}).card().turnCompletion, 'pausable');
  // GlmSessionCli/KimiSessionCli inherit through their `{...base}` spread — ONE declaration site.
  assert.equal(new GlmSessionCli({}).card().turnCompletion, 'pausable');
  assert.equal(new KimiSessionCli({}).card().turnCompletion, 'pausable');
  assert.equal(new CodexAppServerCli({ requestTimeoutMs: 1000 }).card().turnCompletion, 'pausable');
  assert.equal(new GrokAcpCli({ requestTimeoutMs: 1000 }).card().turnCompletion, 'pausable');
  assert.equal(new KimiAcpCli({ requestTimeoutMs: 1000 }).card().turnCompletion, 'pausable');
});

test('A3: the legacy SubprocessAdapterBase family stays "claim" (absent) — a card that cannot '
  + 'steer must not claim it can pause (SC8 lying-card discipline)', () => {
  for (const Cls of [CodexAdapter, ClaudeAdapter, GlmAdapter]) {
    assert.equal(new Cls({}).card().turnCompletion, undefined);
  }
});

// ============================================================
// Part C — TRANSITIONS: `paused` is `input_required`'s sibling
// ============================================================

test('C1: working -> paused is legal; paused -> working|failed|cancelled legal; '
  + 'paused -> completed is refused invalid_transition', () => {
  const store = new CoordinationStore(dir(), { clock: fixedClock });
  const mk = (id) => {
    const created = store.createTask({
      id, brief: brief(), deps: [], refines: null, taskType: 'test', vendorRequested: 'mock',
    }, { actor: 'orchestrator', key: `t:${id}` });
    const t = store.transitionTask(id, 'working', created.task.version, { actor: 'policy', key: `w:${id}` });
    return t.task.version;
  };

  // working -> paused
  let version = mk('t-pause');
  const paused = store.transitionTask('t-pause', 'paused', version, { actor: 'policy', key: 'p:1' });
  assert.equal(paused.task.status, 'paused');
  assert.equal(store.task('t-pause').status, 'paused');

  // paused -> working (the unpark 31-a exercises)
  const unparked = store.transitionTask('t-pause', 'working', paused.task.version, { actor: 'policy', key: 'u:1' });
  assert.equal(unparked.task.status, 'working');

  // paused -> failed and paused -> cancelled
  for (const [id, to] of [['t-fail', 'failed'], ['t-cancel', 'cancelled']]) {
    version = mk(id);
    const p = store.transitionTask(id, 'paused', version, { actor: 'policy', key: `p:${id}` });
    const term = store.transitionTask(id, to, p.task.version, { actor: 'policy', key: `x:${id}` });
    assert.equal(term.task.status, to);
  }

  // paused -> completed is ILLEGAL: direct-to-completed must always traverse `working` first,
  // because the trust gate's claim-time evaluation is what produces `completed`.
  version = mk('t-direct');
  const p = store.transitionTask('t-direct', 'paused', version, { actor: 'policy', key: 'p:d' });
  assert.throws(
    () => store.transitionTask('t-direct', 'completed', p.task.version, { actor: 'policy', key: 'c:d' }),
    (error) => error instanceof CoordinationRefusal && error.code === 'invalid_transition',
  );
});

test('C1b: a `paused` task folds through the existing generic task.transitioned branch and '
  + 'survives a checkpoint round-trip with no new PROJECTION_CHECKPOINT_FIELDS entry', () => {
  const root = dir();
  const store = new CoordinationStore(root, { clock: fixedClock });
  const created = store.createTask({
    id: 'ck', brief: brief(), deps: [], refines: null, taskType: 'test', vendorRequested: 'mock',
  }, { actor: 'orchestrator', key: 'ck:t' });
  const w = store.transitionTask('ck', 'working', created.task.version, { actor: 'policy', key: 'ck:w' });
  store.transitionTask('ck', 'paused', w.task.version, { actor: 'policy', key: 'ck:p' });
  assert.equal(store.task('ck').status, 'paused');

  const reloaded = new CoordinationStore(root, { clock: fixedClock });
  assert.equal(reloaded.task('ck').status, 'paused');
});

test('C3: _deriveWorkerStatus renders `paused` as `blocked` — never silently `working` '
  + '(the eighth guard site, found independently of docs/35 §2.1(3))', () => {
  const { coordinator } = lightweightCoordinator();
  assert.equal(coordinator._deriveWorkerStatus('paused'), 'blocked');
  // parity with its sibling, and the pre-existing mappings unchanged
  assert.equal(coordinator._deriveWorkerStatus('input_required'), 'blocked');
  assert.equal(coordinator._deriveWorkerStatus('working'), 'working');
  assert.equal(coordinator._deriveWorkerStatus('completed'), 'idle');
});

// ============================================================
// Part C rule 5 — story.mjs honest `paused` rendering
// ============================================================

test('C4: the REAL two-event sequence (turn_completed folds working->idle, then turn.paused '
  + 'folds idle->paused) renders the worker `paused`, never `idle`', () => {
  let state = initialState();
  state = foldEvent(state, { worker: 'w-1', seq: 1, kind: KIND.SPAWNED, actor: 'worker', ts: FIXED_NOW, payload: {} });
  state = foldEvent(state, { worker: 'w-1', seq: 2, kind: KIND.TURN_STARTED, actor: 'worker', ts: FIXED_NOW, turnEpoch: 1, payload: {} });
  state = foldEvent(state, { worker: 'w-1', seq: 3, kind: KIND.TURN_COMPLETED, actor: 'worker', ts: FIXED_NOW, turnEpoch: 1, payload: workerResult() });
  // Fold order is fixed by construction: the coordinator appends turn_completed first, then mints
  // turn.paused inside _admitPauseRecord. So TURN_PAUSED always folds from 'idle', not 'working'.
  assert.equal(state.workers.get('w-1').status, 'idle');
  state = foldEvent(state, { worker: 'w-1', seq: 4, kind: KIND.TURN_PAUSED, actor: 'worker', ts: FIXED_NOW, turnEpoch: 1, payload: { taskId: 't-1', turnEpoch: 1, changedPathsDigest: DIGEST_OF_EMPTY } });
  assert.equal(state.workers.get('w-1').status, 'paused');
  assert.ok(!state.workers.get('w-1').warnings.has('illegal_transition'));

  // turn.settled unparks the worker back to 'working'.
  state = foldEvent(state, { worker: 'w-1', seq: 5, kind: KIND.TURN_SETTLED, actor: 'policy', ts: FIXED_NOW, turnEpoch: 1, payload: { actor: 'policy', basis: 'auto_no_driver' } });
  assert.equal(state.workers.get('w-1').status, 'working');
});

test('C4b: TURN_PAUSED also folds directly from `working` (the guard\'s other admitted `from`), '
  + 'and from any other status is a no-op that flags illegal_transition', () => {
  let state = initialState();
  state = foldEvent(state, { worker: 'w-2', seq: 1, kind: KIND.SPAWNED, actor: 'worker', ts: FIXED_NOW, payload: {} });
  state = foldEvent(state, { worker: 'w-2', seq: 2, kind: KIND.TURN_STARTED, actor: 'worker', ts: FIXED_NOW, turnEpoch: 1, payload: {} });
  state = foldEvent(state, { worker: 'w-2', seq: 3, kind: KIND.TURN_PAUSED, actor: 'worker', ts: FIXED_NOW, turnEpoch: 1, payload: {} });
  assert.equal(state.workers.get('w-2').status, 'paused');

  let other = initialState();
  other = foldEvent(other, { worker: 'w-3', seq: 1, kind: KIND.SPAWNED, actor: 'worker', ts: FIXED_NOW, payload: {} });
  other = foldEvent(other, { worker: 'w-3', seq: 2, kind: KIND.EXITED, actor: 'worker', ts: FIXED_NOW, payload: {} });
  assert.equal(other.workers.get('w-3').status, 'exited');
  other = foldEvent(other, { worker: 'w-3', seq: 3, kind: KIND.TURN_PAUSED, actor: 'worker', ts: FIXED_NOW, payload: {} });
  // Not silently applied, and warned — not the vacuous silent-wrong of an unguarded assignment.
  assert.equal(other.workers.get('w-3').status, 'exited');
  assert.ok(other.workers.get('w-3').warnings.has('illegal_transition'));
});

// ============================================================
// Part B + Part D — the pause record and degenerate auto-settle
// ============================================================

test('B1/D4: a pausable card with NO steering.registered marker mints turn.paused, auto-settles '
  + 'in the same handler tick, unparks to working, and reaches the ONE pre-existing trust gate', async () => {
  const kit = lightweightCoordinator({ turnCompletion: 'pausable' });
  const handle = await liveWorker(kit);
  const task = kit.coordinator._tasks.get(handle.taskId);

  completeTurn(kit, handle);
  await until(() => kit.refereeCalls.length > 0);

  const entries = kit.coordinator._log.read(handle.id);
  const pausedEntry = entries.find((e) => e.kind === 'turn.paused');
  assert.ok(pausedEntry, 'turn.paused must be appended to the per-worker log');
  assert.equal(pausedEntry.actor, 'worker');
  // Contract Part B rule 2: THREE payload fields; `workerId` rides the envelope, never duplicated.
  assert.deepEqual(Object.keys(pausedEntry.payload).sort(), ['changedPathsDigest', 'taskId', 'turnEpoch']);
  assert.equal(pausedEntry.payload.taskId, task.id);
  assert.equal(pausedEntry.worker, handle.id);

  const settledEntry = entries.find((e) => e.kind === 'turn.settled');
  assert.ok(settledEntry, 'the degenerate case settles durably');
  assert.equal(settledEntry.payload.basis, 'auto_no_driver');
  assert.equal(settledEntry.payload.actor, 'policy');

  // The in-memory single-consumer record: keyed `pause:${task.id}:${seq}`, resolved by policy.
  const key = [...kit.coordinator._pausedTurns.keys()].find((k) => k.startsWith(`pause:${task.id}:`));
  assert.ok(key, 'a pause record is keyed pause:${taskId}:${seq}');
  const record = kit.coordinator._pausedTurns.get(key);
  assert.equal(record.state, 'resolved');
  assert.equal(record.consumer, 'policy');
  assert.equal(record.worker, handle.id);

  // The task transited paused -> working durably, and the trust gate ran exactly once.
  assert.equal(kit.refereeCalls.length, 1);
  // `task.transitioned` carries the task under `id` (coordination-store.mjs's _append payload).
  const transitions = kit.coordination.events()
    .filter((e) => e.kind === 'task.transitioned' && e.payload.id === task.id)
    .map((e) => e.payload.to);
  assert.ok(transitions.includes('paused'), 'the durable ledger records the paused detour');
  assert.ok(transitions.indexOf('paused') < transitions.lastIndexOf('working'),
    'the task unparks to working after the paused detour');
  // The detour is fully resolved within the handler tick: the task never lingers `paused`, and
  // the trust gate then drives it on to its ordinary terminal outcome exactly as it always has.
  assert.notEqual(kit.coordination.task(task.id).status, 'paused');
});

test('B3: changedPathsDigest is canonicalDigest([]) when the task has no baseSha — every '
  + 'MockAdapter/backward-compat task, and never a thrown captured_change_invalid (P1-5)', async () => {
  const kit = lightweightCoordinator({ turnCompletion: 'pausable' });
  const handle = await liveWorker(kit);
  const task = kit.coordinator._tasks.get(handle.taskId);
  // `request.context.baseSha` is only conditionally spread into SessionContext
  // (coordinator.mjs:634), so a task with no session attach reaches the mint site with
  // `sessionContext?.baseSha === undefined`. Pin that shape explicitly.
  task.sessionContext = undefined;
  assert.equal(task.sessionContext?.baseSha, undefined, 'precondition: no baseSha on the task');

  completeTurn(kit, handle);
  await until(() => kit.refereeCalls.length > 0);

  const pausedEntry = kit.coordinator._log.read(handle.id).find((e) => e.kind === 'turn.paused');
  assert.equal(pausedEntry.payload.changedPathsDigest, DIGEST_OF_EMPTY);
});

test('D5: a pausable card on a run WITH a live steering.registered marker stays paused — not '
  + 'auto-settled, and _runTrustGate is NOT invoked that turn', async () => {
  const kit = lightweightCoordinator({ turnCompletion: 'pausable' });
  const handle = await liveWorker(kit);
  const task = kit.coordinator._tasks.get(handle.taskId);

  // 31-a ships NO production caller that admits this marker (P1-4) — hand-admit it, exactly as
  // the contract says this branch can only ever be reached in-test until 31-b lands wave.mjs.
  kit.coordinator._coordRecord(
    'steering.registered',
    { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${task.runId ?? 'null'}`,
    'orchestrator',
  );

  completeTurn(kit, handle);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const entries = kit.coordinator._log.read(handle.id);
  assert.ok(entries.some((e) => e.kind === 'turn.paused'), 'the pause is still minted');
  assert.ok(!entries.some((e) => e.kind === 'turn.settled'), 'a live driver must NOT auto-settle');

  const key = [...kit.coordinator._pausedTurns.keys()].find((k) => k.startsWith(`pause:${task.id}:`));
  assert.ok(key);
  assert.equal(kit.coordinator._pausedTurns.get(key).state, 'pending');
  assert.equal(kit.coordinator._pausedTurns.get(key).consumer, null);

  assert.equal(kit.coordination.task(task.id).status, 'paused');
  // The positive pin the contract demands: the verification hook was never called.
  assert.equal(kit.refereeCalls.length, 0);
});

test('D-compat: a `claim`-carded turn (the default, every existing card) never mints a pause '
  + 'record and reaches the trust gate byte-identically to today', async () => {
  const kit = lightweightCoordinator({ turnCompletion: null });
  const handle = await liveWorker(kit);
  completeTurn(kit, handle);
  await until(() => kit.refereeCalls.length > 0);

  const entries = kit.coordinator._log.read(handle.id);
  assert.ok(!entries.some((e) => e.kind === 'turn.paused'));
  assert.ok(!entries.some((e) => e.kind === 'turn.settled'));
  assert.equal(kit.coordinator._pausedTurns.size, 0);
  assert.equal(kit.refereeCalls.length, 1);
});

// ============================================================
// Part C rule 2 — the worker-authored-write guard sites accept `paused`
// ============================================================

test('C2: every named guard site treats a `paused` task as live, exactly as it treats '
  + 'input_required, and still refuses a terminal task', async () => {
  const kit = lightweightCoordinator({ turnCompletion: 'pausable' });
  const handle = await liveWorker(kit);
  const task = kit.coordinator._tasks.get(handle.taskId);
  kit.coordinator._coordRecord(
    'steering.registered',
    { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${task.runId ?? 'null'}`,
    'orchestrator',
  );
  completeTurn(kit, handle);
  await until(() => kit.coordination.task(task.id).status === 'paused');
  assert.equal(kit.coordinator._tasks.get(handle.taskId).status, 'paused');

  // Each wrapper checks the task-status guard BEFORE its idempotencyKey/fence TypeError. So a
  // TypeError proves the guard admitted `paused`; `{result:'task_not_active'}` proves it refused.
  const probes = [
    ['claimScratch', () => kit.coordinator.claimScratch(handle.id, {}, {})],
    ['postScratchFact', () => kit.coordinator.postScratchFact(handle.id, {}, {})],
    ['requestBoardClaim', () => kit.coordinator.requestBoardClaim(handle.id, {}, {})],
    ['submitBoardReport', () => kit.coordinator.submitBoardReport(handle.id, {}, {})],
    ['admitReplManifest', () => kit.coordinator.admitReplManifest(handle.id, {}, {})],
  ];
  for (const [label, probe] of probes) {
    assert.throws(probe, TypeError, `${label} must admit a paused task past its status guard`);
  }

  // Negative case, unchanged: a terminal task is still refused by every one of them.
  task.status = 'completed';
  for (const [label, probe] of probes) {
    assert.deepEqual(probe(), { ok: false, result: 'task_not_active' },
      `${label} must still refuse a completed task`);
  }
});

// ============================================================
// Part D — driverKind admission + the steering.registered marker at run creation
// ============================================================

const D_VERIFICATION = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const D_POLICY = Object.freeze({
  schemaVersion: 1, repoId: 'repo-31a', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const D_PROFILE = Object.freeze({
  schemaVersion: 1, repoId: 'repo-31a',
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification: D_VERIFICATION,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  exportPolicy: {
    mode: 'manual', format: 'directory-v1', maxFiles: 128, maxBytes: 4 * 1024 * 1024,
    requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: false,
  },
});

const dPrincipal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const dIntent = (runId, extra = {}) => ({
  runId, objective: 'Exercise issue #31 slice A steering registration',
  profile: 'p31a', route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'], ...extra,
});

function applicationFixture() {
  const repo = dir();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', '31a@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 31a'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', delayMs: 5_000, summary: '31a fixture' },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-31a', logDir: dir(), adapters: { mock: adapter },
    goalPlanAuthority: { policy: D_POLICY, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-31a', profiles: { p31a: D_PROFILE },
    principals: {
      planner: dPrincipal('planner'), dispatcher: dPrincipal('dispatcher'), observer: dPrincipal('observer'),
    },
    exportRoot: dir(),
    authorize: async () => true,
  });
  return { application, driver };
}

function steeringMarkers(driver, runId) {
  return driver.coordination.events().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'steering.registered'
    && (runId === undefined || event.payload?.runId === runId));
}

test('D1: run.start with driverKind:"wave" reaches the handler and admits exactly one '
  + 'steering.registered marker at run creation', async (t) => {
  const { application, driver } = applicationFixture();
  t.after(async () => { try { await application.shutdown(dPrincipal('cleanup')); } catch { try { await application.detach(); } catch {} } });

  await application.command('run.start', { intent: dIntent('run-wave', { driverKind: 'wave' }) }, dPrincipal('owner'));

  const markers = steeringMarkers(driver);
  assert.equal(markers.length, 1, 'exactly one steering.registered marker is admitted');
  assert.equal(markers[0].payload.driverKind, 'wave');
  assert.equal(markers[0].payload.runId, 'run-wave');
  assert.ok(markers[0].payload.actor, 'the marker carries its admitting actor');
});

test('D2: run.start with NO driverKind (every caller in the shipped tree — 31-a ships no '
  + 'production caller) admits no marker at all', async (t) => {
  const { application, driver } = applicationFixture();
  t.after(async () => { try { await application.shutdown(dPrincipal('cleanup')); } catch { try { await application.detach(); } catch {} } });

  await application.command('run.start', { intent: dIntent('run-plain') }, dPrincipal('owner'));
  assert.equal(steeringMarkers(driver).length, 0);
});

test('D3: a SECOND run.start against the same runId (existingRun !== null) admits no second '
  + 'marker — driver identity is fixed at genuine creation, never re-granted on resume', async (t) => {
  const { application, driver } = applicationFixture();
  t.after(async () => { try { await application.shutdown(dPrincipal('cleanup')); } catch { try { await application.detach(); } catch {} } });

  await application.command('run.start', { intent: dIntent('run-twice', { driverKind: 'wave' }) }, dPrincipal('owner'));
  assert.equal(steeringMarkers(driver, 'run-twice').length, 1);
  await application.command('run.start', { intent: dIntent('run-twice', { driverKind: 'wave' }) }, dPrincipal('owner'));
  assert.equal(steeringMarkers(driver, 'run-twice').length, 1, 'must stay 1, never 2');
});

test('D4: normalizeIntent refuses a non-"wave" driverKind server-side with '
  + 'application_intent_invalid (P1-1 defense in depth, behind the client whitelist)', async (t) => {
  const { application } = applicationFixture();
  t.after(async () => { try { await application.shutdown(dPrincipal('cleanup')); } catch { try { await application.detach(); } catch {} } });

  await assert.rejects(
    () => application.command('run.start', { intent: dIntent('run-bad', { driverKind: 'orchestrator' }) }, dPrincipal('owner')),
    (error) => error?.code === 'application_intent_invalid',
  );
  // An unknown key is still refused by the same closed whitelist — driverKind widened it by
  // exactly one key, never opened it.
  await assert.rejects(
    () => application.command('run.start', { intent: dIntent('run-bad2', { bogus: 'x' }) }, dPrincipal('owner')),
    (error) => error?.code === 'application_intent_invalid',
  );
});


// ============================================================
// Part B rule 4 + Part C rule 6 — startup replay of pause records, and CI6 fail-closed
// ============================================================

/**
 * A coordinator over a given durable log directory. The store is derived from the log
 * (`coordinationForLog`) so it carries the authoritative resolver `_coordMapEvent` needs, and so
 * a second coordinator over the SAME directory replays the identical durable history.
 */
function replayCoordinator(logDir, turnCompletion = 'pausable') {
  const log = new Log(logDir);
  const coordination = coordinationForLog(log);
  const adapter = new ScriptableAdapter(turnCompletion);
  const coordinator = new Coordinator({
    log, coordination, fences: new FenceTable(), adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-result' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
  });
  return { coordinator, coordination, adapter, log };
}

function emitTurnCompleted(adapter, handle) {
  adapter.emit({
    worker: handle.id, harness: `${adapter.card().harness}@${adapter.card().version}`,
    turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker', payload: workerResult(),
  });
}

test('R1: a coordinator restarted mid-pause reconstructs _pausedTurns with state:"pending" '
  + 'keyed identically to the live mint, and (P1-3) CI6 durably FAILS the task — fail-closed '
  + 'parity with an unresolved input_required task, not a special case for `paused`', async () => {
  const logDir = join(dir(), 'log');

  // --- first process: park a turn under a live steering registration ---
  const first = replayCoordinator(logDir);
  const handle = await first.coordinator.spawn('mock', brief());
  await until(() => first.coordinator.list()[0]?.status === 'working');
  const task = first.coordinator._tasks.get(handle.taskId);
  first.coordinator._coordRecord(
    'steering.registered', { runId: task.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${task.runId ?? 'null'}`, 'orchestrator',
  );

  emitTurnCompleted(first.adapter, handle);
  await until(() => first.coordination.task(task.id).status === 'paused');
  const livePauseId = [...first.coordinator._pausedTurns.keys()].find((k) => k.startsWith(`pause:${task.id}:`));
  assert.ok(livePauseId);
  assert.equal(first.coordinator._pausedTurns.get(livePauseId).state, 'pending');

  // --- restart: a brand-new coordinator over the SAME durable log, after an explicit writer
  // handoff (the documented restart shape, coordinator.test.mjs's D11 replay harness) ---
  first.coordination.releaseWriterLease();
  const restarted = replayCoordinator(logDir);
  if (restarted.coordinator.ready) await restarted.coordinator.ready;

  // (a) the record is reconstructed under the IDENTICAL key the live mint used — which is why
  // replay keys off the turn_completed seq, not the turn.paused entry's own seq.
  assert.ok(restarted.coordinator._pausedTurns.has(livePauseId),
    `replay must reconstruct ${livePauseId} (got ${[...restarted.coordinator._pausedTurns.keys()].join(',')})`);
  const replayed = restarted.coordinator._pausedTurns.get(livePauseId);
  assert.equal(replayed.state, 'pending');
  assert.equal(replayed.worker, handle.id);
  assert.equal(replayed.taskId, task.id);

  // (b) P1-3: CI6 durably fails the task. A crashed session cannot honor a still-open pause any
  // more than it can honor a still-open question — this is `input_required`'s existing restart
  // behavior, not a new degradation introduced for `paused`.
  assert.equal(restarted.coordination.task(task.id).status, 'failed');
  // And the dangling pending record for that now-dead task survives, exactly mirroring
  // `reconstructedPending`'s identical, pre-existing tolerance.
  assert.equal(restarted.coordinator._pausedTurns.get(livePauseId).state, 'pending');
});

test('R2: a pause already settled before the restart is NOT reconstructed as an open record '
  + '(the degenerate path every run in the current tree takes)', async () => {
  const logDir = join(dir(), 'log');

  const first = replayCoordinator(logDir);
  const handle = await first.coordinator.spawn('mock', brief());
  await until(() => first.coordinator.list()[0]?.status === 'working');
  // No steering.registered marker ⇒ the degenerate auto-settle path.
  emitTurnCompleted(first.adapter, handle);
  await until(() => first.coordinator._log.read(handle.id).some((e) => e.kind === 'turn.settled'));

  first.coordination.releaseWriterLease();
  const restarted = replayCoordinator(logDir);
  if (restarted.coordinator.ready) await restarted.coordinator.ready;
  assert.equal(restarted.coordinator._pausedTurns.size, 0,
    'a settled pause is not an open record after replay');
});
