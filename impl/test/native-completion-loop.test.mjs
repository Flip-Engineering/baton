// native-completion-loop.test.mjs — the repaired pause seam, proven end to end against the
// adapter family that produced the live finding.
//
// THE FINDING. A real native Claude self-build completed its change, emitted
// `lifecycle.turn_completed {status:'completed'}` on a `pausable` card, and the coordinator
// armed its bounded policy steering cycle. The nudge it sent BEGAN the next turn (the atomic
// pipe starts a turn synchronously inside `prompt()`); that `turn_started` answered the cycle;
// the completed turn then armed another cycle. 570 provider turns, no verdict, the model
// reporting "Complete, no remaining work" throughout.
//
// THE RULE NOW. The pause seam parks and decides nothing: `_admitPauseRecord` mints the durable
// checkpoint and returns — no policy prompt, no window, no expiry verdict, no gate dispatch.
// Native turn completion alone never mints a claim, and no elapsed time, repetition, count, or
// prose ever decides a paused task. Completion authority belongs to the autonomous orchestrator,
// which acts explicitly: `claim_turn` runs the EXISTING verifier/trust gate against a fresh
// capture; `nudge_turn` admits a real continuation; `wait_turn` notes intent. Those three acts
// and the cancellation paths are the whole decision surface, and they are unchanged.
//
// THE TESTS. The adapter below is the ATOMIC pipe (claude-session's CS7/E2 semantics: `spawn`
// begins the bootstrap turn, and an idle session begins a turn synchronously inside `prompt`).
// That shape is deliberate — it is the shape the old design fed itself with, so "zero prompts"
// and "the turn epoch never advances" are the strongest available proofs that the coordinator
// no longer re-awakens a native session. Required focuses, row by row:
//   * visible pending checkpoint (N1, N3),
//   * no automatic prompt under any elapsed time (N2, N3),
//   * explicit continuation (N4),
//   * explicit verification claim (N5),
//   * cancellation is not resurrected (N6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-ncl-'));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function makeBrief(overrides = {}) {
  return {
    goal: 'produce an in-scope diff and report completion',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: ['repository_edit'],
    ...overrides,
  };
}

/**
 * The atomic `pausable` pipe. `spawn` begins the bootstrap turn (as every real adapter does);
 * `prompt` is wire-identical for `turn`/`nudge` (CS7/E2) — an idle session begins a turn and
 * emits `lifecycle.turn_started` SYNCHRONOUSLY inside the call. Any coordinator-issued prompt
 * therefore shows up as a new turn epoch, which is exactly what these tests assert never
 * happens on the pause path.
 */
class AtomicPausableAdapter {
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
    this.turns = new Map();
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker) {
    this.calls.spawn.push({ worker });
    const session = { epoch: 1, inFlight: true };
    this.turns.set(worker, session);
    this.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: session.epoch,
      kind: 'lifecycle.turn_started', actor: 'worker', payload: {},
    });
    return { ok: true };
  }
  async prompt(worker, content, mode = 'turn') {
    this.calls.prompt.push({ worker, content, mode });
    const session = this.turns.get(worker);
    assert.ok(session, 'prompt before spawn');
    const beginsTurn = !session.inFlight;
    session.inFlight = true;
    if (beginsTurn) {
      session.epoch += 1;
      this.emit({
        worker, harness: 'mock@1.0.0', turnEpoch: session.epoch,
        kind: 'lifecycle.turn_started', actor: 'worker', payload: {},
      });
    }
    return { ok: true };
  }
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
    const session = this.turns.get(worker);
    if (session) session.inFlight = false;
    queueMicrotask(() => this.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: session?.epoch ?? 0,
      kind: 'kill.confirmed', actor: 'policy', payload: {},
    }));
    return { ok: true, terminal: true };
  }
  /** End the in-flight turn exactly as the provider would: one `turn_completed` frame. */
  completeTurn(worker, { output = 'checkpoint', status = 'completed' } = {}) {
    const session = this.turns.get(worker);
    assert.ok(session?.inFlight, 'completeTurn requires an in-flight turn');
    session.inFlight = false;
    this.emit({
      worker, harness: 'mock@1.0.0', turnEpoch: session.epoch,
      kind: 'lifecycle.turn_completed', actor: 'worker', payload: { status, output },
    });
  }
  epoch(worker) { return this.turns.get(worker)?.epoch ?? 0; }
}

function passingReferee(task) {
  return {
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  };
}

const withDiff = async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['in-scope.txt'] });
const noDiff = async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] });

function setup({ adapter, capture }) {
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
    referee: async (t) => passingReferee(t),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25, // the retired knob — asserted inert for the pause seam
  });
  return { dir, log, coordinator };
}

async function flush(times = 60) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const gateCodes = ['forbidden_effect_observed', 'worker_path_scope_violation', 'required_effect_absent'];
const gateEvents = (coordinator, workerId) =>
  coordinator._log.read(workerId).filter((event) => gateCodes.includes(event.payload?.code));
const verifyRuns = (coordinator, workerId) =>
  coordinator._log.read(workerId).filter((event) => event.kind === 'verify.reverified').length;
const settledWith = (coordinator, workerId, basis) =>
  coordinator._log.read(workerId).find((event) => event.kind === 'turn.settled' && event.payload?.basis === basis);
const pauseRows = (coordinator, taskId) => coordinator.pausedTurns({ taskId });

/** Stage one native completion on the pausable card, exactly as the live finding did. */
async function nativeCheckpoint({ capture }) {
  const adapter = new AtomicPausableAdapter();
  const kit = setup({ adapter, capture });
  const handle = await kit.coordinator.spawn('mock', makeBrief());
  const task = kit.coordinator._tasks.get(handle.taskId);
  adapter.completeTurn(handle.id, { output: 'change complete; no remaining work' });
  await flush();
  return { ...kit, adapter, handle, task, rows: pauseRows(kit.coordinator, task.id) };
}

// ===========================================================================
// §A — The visible checkpoint, and no automatic prompt under any elapsed time
// ===========================================================================

test('N1: a native completion parks a VISIBLE checkpoint — no prompt, no verdict, no second turn', async () => {
  const { coordinator, adapter, handle, task, rows } = await nativeCheckpoint({ capture: withDiff });

  assert.equal(task.status, 'paused', 'the native completion parks the task');
  assert.equal(rows.length, 1, 'exactly one pending checkpoint is projected for the orchestrator');
  const [row] = rows;
  assert.equal(row.state, 'pending');
  assert.equal(row.consumer, null, 'nobody has decided it — it awaits an explicit act');
  assert.equal(row.workerId, handle.id);
  assert.equal(row.taskId, task.id);
  assert.ok(coordinator._pausedTurns.get(row.pauseId), 'the durable record is live');

  // The retired self-perpetuating machinery: no prompt was sent, so the atomic pipe began no
  // continuation turn at all — the coordinator is not talking to itself.
  assert.equal(adapter.calls.prompt.length, 0, 'the coordinator sends no policy prompt at a checkpoint');
  assert.equal(adapter.epoch(handle.id), 1, 'no continuation turn was started');
  assert.equal(settledWith(coordinator, handle.id, 'steering_answered'), undefined, 'no automatic settle');
  assert.equal(settledWith(coordinator, handle.id, 'steering_expired'), undefined, 'no expiry settle');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'the verifier is not dispatched automatically');
  assert.equal(gateEvents(coordinator, handle.id).length, 0, 'no verdict is written');
  assert.equal(adapter.calls.kill.length, 0, 'nothing is killed');

  // The durable origin still records the worker's own completion claim — the orchestrator's
  // claim decision reads it; the coordinator does not act on it.
  const origin = coordinator._log.read(handle.id).find((event) => event.kind === 'turn.paused')?.payload?.origin;
  assert.equal(origin?.kind, 'turn_completed');
  assert.equal(origin?.resultStatus, 'completed');
});

test('N2: no automatic prompt under ANY elapsed time — the pause seam uses no clock', async () => {
  const { coordinator, adapter, handle, task, rows } = await nativeCheckpoint({ capture: withDiff });

  await sleep(160); // more than six windows of the 25ms knob
  await flush();
  assert.equal(adapter.calls.prompt.length, 0, 'still no prompt after six windows');
  assert.equal(adapter.epoch(handle.id), 1, 'still no continuation turn');
  assert.equal(settledWith(coordinator, handle.id, 'steering_expired'), undefined, 'expiry never decides work');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'no timed verdict');
  assert.equal(gateEvents(coordinator, handle.id).length, 0);
  assert.equal(task.status, 'paused', 'the checkpoint is still parked');
  assert.equal(pauseRows(coordinator, task.id).map((r) => r.pauseId).join(), rows[0].pauseId,
    'and it is still the same claimable record');
  assert.equal(adapter.calls.kill.length, 0, 'elapsed time kills nothing');
});

test('N3: the reported loop cannot reproduce — repeated completions and wire noise mint no prompt and no claim', async () => {
  const { coordinator, adapter, handle, task } = await nativeCheckpoint({ capture: withDiff });

  // Drive the live run's sequence directly: the worker keeps finishing turns and insisting it is
  // done, and the wire carries every class the retired cycle used to read as an answer.
  for (let round = 1; round <= 8; round += 1) {
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: round + 1, kind: 'lifecycle.turn_completed',
      actor: 'worker', payload: { status: 'completed', output: 'Complete, no remaining work' },
    });
    adapter.emit({
      worker: handle.id, harness: 'mock@1.0.0', turnEpoch: round + 1, kind: 'lifecycle.turn_started',
      actor: 'worker', payload: {},
    });
    await flush(20);
  }
  await sleep(120);
  await flush();

  assert.equal(adapter.calls.prompt.length, 0,
    'eight rounds of the live shape produce ZERO policy prompts — the self-perpetuating loop is gone');
  assert.equal(adapter.epoch(handle.id), 1, 'the coordinator never re-awakened the native session');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'native turn completion alone mints no policy claim');
  assert.equal(gateEvents(coordinator, handle.id).length, 0, 'and no verdict');
  assert.equal(task.status, 'paused', 'the task stays parked, visibly awaiting its owner');
  assert.ok(pauseRows(coordinator, task.id).length >= 1, 'the checkpoint remains projected and claimable');
  assert.equal(adapter.calls.kill.length, 0, 'no unconditional process kill');
});

// ===========================================================================
// §B — Explicit continuation and explicit verification
// ===========================================================================

test('N4: an orchestrator nudge is a real continuation — a fresh turn on the SAME task', async () => {
  const { coordinator, adapter, handle, task, rows } = await nativeCheckpoint({ capture: withDiff });
  const pauseId = rows[0].pauseId;

  const nudged = await coordinator.nudgeTurn(pauseId, 'continue with the remaining plan', { actor: 'orchestrator' });
  assert.equal(nudged.ok, true);
  assert.equal(nudged.result, 'nudged');
  assert.equal(task.status, 'working', 'the continuation unparks the same task');
  assert.equal(adapter.epoch(handle.id), 2, 'the explicit act began one real turn');
  assert.equal(adapter.calls.prompt.length, 1, 'exactly one delivery — the orchestrator\'s own');
  assert.equal(String(adapter.calls.prompt[0].content), 'continue with the remaining plan');
  assert.ok(settledWith(coordinator, handle.id, 'nudge'), 'durable turn.settled {basis: nudge}');
  assert.equal(pauseRows(coordinator, task.id).length, 0, 'the act consumed the record');

  // When that continuation ends, it parks as an ORDINARY checkpoint again — with no prompt.
  adapter.completeTurn(handle.id, { output: 'second checkpoint' });
  await flush();
  assert.equal(task.status, 'paused');
  assert.equal(pauseRows(coordinator, task.id).length, 1, 'a new visible checkpoint');
  assert.equal(adapter.calls.prompt.length, 1, 'parking sends no prompt — no loop back into the policy');
  assert.equal(adapter.epoch(handle.id), 2, 'and starts no further turn');
});

test('N5: an explicit claim runs the EXISTING verifier — accepted with the diff, refused without it', async () => {
  // (a) the in-scope diff is accepted by the real verifier.
  const accepted = await nativeCheckpoint({ capture: withDiff });
  const claimed = await accepted.coordinator.claimTurn(accepted.rows[0].pauseId, { actor: 'orchestrator' });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.outcome, 'completed');
  assert.equal(accepted.task.status, 'completed');
  assert.equal(verifyRuns(accepted.coordinator, accepted.handle.id), 1, 'the existing verifier ran exactly once');
  assert.ok(settledWith(accepted.coordinator, accepted.handle.id, 'claim'));
  assert.equal(accepted.adapter.calls.prompt.length, 0, 'the claim needed no policy prompt');
  assert.equal(pauseRows(accepted.coordinator, accepted.task.id).length, 0, 'the record is consumed');

  // (b) the same act without the required effect is refused by the gate's required-effect phase.
  const refused = await nativeCheckpoint({ capture: noDiff });
  const refusedClaim = await refused.coordinator.claimTurn(refused.rows[0].pauseId, { actor: 'orchestrator' });
  assert.equal(refusedClaim.ok, true);
  assert.equal(refusedClaim.outcome, 'failed');
  assert.equal(refused.task.status, 'failed');
  const verdict = gateEvents(refused.coordinator, refused.handle.id)
    .find((event) => event.payload?.code === 'required_effect_absent');
  assert.ok(verdict, 'the verifier names required_effect_absent — the claim is not accepted on prose');
  assert.equal(verdict.payload?.steered, undefined, 'no retired steering receipt exists any more');
  assert.equal(refused.adapter.calls.prompt.length, 0, 'and still no policy prompt');
});

// ===========================================================================
// §C — Cancellation
// ===========================================================================

test('N6: a cancelled checkpoint is not resurrected by a late native completion', async () => {
  const { coordinator, adapter, handle, task, rows } = await nativeCheckpoint({ capture: withDiff });

  await coordinator.stopRunTargets([handle.id], 'orchestrator');
  assert.equal(task.status, 'cancelled', 'the explicit stop closes the parked task');

  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2,
    kind: 'lifecycle.turn_completed', actor: 'worker', payload: { status: 'completed', output: 'complete' },
  });
  await flush();
  assert.equal(task.status, 'cancelled', 'a late completion cannot reopen a cancelled task');
  assert.deepEqual(pauseRows(coordinator, task.id).map((r) => r.pauseId), [rows[0].pauseId],
    'the late frame mints no NEW checkpoint');
  assert.equal(adapter.calls.prompt.length, 0, 'no prompt after the stop');
  assert.equal(verifyRuns(coordinator, handle.id), 0, 'the verifier never evaluates a cancelled task');
});
