// Cluster 1 (Core) — coordinator.mjs test suite.
// Covers the 8 commands, dispatch (deps + concurrency ceilings), fence-checked
// reliability, two-phase interrupt/kill, single-consumer respond(), the trust gate,
// crash/restart replay, and list()/wait(). Behaviors 19-53 of
// spec/IMPLEMENTATION.md (CLUSTER 1 — CORE, section 5).
//
// FIXTURE NOTE (deviation from a literal "import MockAdapter from ../src/adapter.mjs"):
// coordinator.mjs's own `Adapter` contract is now pinned by spec/RECONCILIATION.md D1
// (the unified, session-shaped Adapter — authoritative over any conflicting cluster spec):
//   { card(), spawn(worker,brief), prompt(worker,content,mode),
//     interrupt(worker,then), approve(worker,requestId,decision,payload),
//     answer(worker,requestId,answer), kill(worker), onEvent(cb) }
// `answer()` is distinct from `approve()` (red core#1 / D1): approvals carry a closed
// 'allow'|'deny'|'cancel' enum; questions carry a free-form {text?, decision?} answer.
// Confirmed-stop (interrupt/kill) is ALWAYS delivered as an onEvent event, never as the
// resolved value of the interrupt()/kill()/adapter-call promise (D1) — `ScriptableAdapter`
// below models this: `interrupt()`/`kill()` resolve their own immediate Ack right away, and
// the coordinator must separately await the matching control.interrupt_confirmed/
// kill.confirmed event pushed through `emit()`.
// This shape is a deliberate divergence from Cluster B's one-shot `adapter.mjs`
// `MockAdapter` { card(), run(brief, opts) } — the spec's own "Test independence note"
// (section 6 of the Core cluster spec) explicitly directs Core's test suite to
// "construct minimal local fakes conforming to Adapter/RefereeFn/WorktreeManager/RouteFn
// ... rather than importing Cluster B's real MockAdapter" — this file follows that
// guidance so it stays buildable/testable with no build-order dependency on Cluster B,
// and so the fake actually satisfies the D1 interface coordinator.mjs calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Coordinator,
  WorkerNotFoundError,
  DuplicateTaskIdError,
  UnknownVendorError,
  DependencyCycleError,
} from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';

// ============================================================
// Test fixtures — local fakes for Adapter / WorktreeManager / RefereeFn / RouteFn
// ============================================================

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-coord-test-'));
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

function makeWorkerResult(overrides = {}) {
  return {
    status: 'completed',
    summary: 'ok',
    artifacts: { commits: ['sha1'], files: [] },
    verification: { command: 'true', claimedExit: 0 },
    openQuestions: [],
    budgetUsed: { tokens: 1, usd: 0.01 },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Scriptable fake conforming to coordinator.mjs's Adapter contract (spec §3.2).
 * Every mediating method's Ack timing is independently controllable via `gates.<method>`
 * (a Promise the call `await`s before resolving) so tests can construct exact,
 * deterministic same-tick races without any real setTimeout/sleep. Worker-originated
 * events are delivered synchronously to the registered onEvent callback via `emit()`.
 */
class ScriptableAdapter {
  constructor({ harness = 'mock', version = '1.0.0', concurrencyCeiling = Infinity, maxContext = 100000, verbs = {} } = {}) {
    this._card = {
      harness,
      version,
      authPosture: 'api_key',
      concurrencyCeiling,
      maxContext,
      verbs: { spawn: 'native', interrupt: 'native', ...verbs },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this.gates = { spawn: null, prompt: null, interrupt: null, approve: null, answer: null, kill: null };
    this.acks = {
      spawn: { ok: true },
      prompt: { ok: true },
      interrupt: { ok: true },
      approve: { ok: true },
      answer: { ok: true },
      kill: { ok: true },
    };
    this._onEvent = null;
  }
  card() {
    return this._card;
  }
  onEvent(cb) {
    this._onEvent = cb;
  }
  /** Test-only: push a worker-originated event through the registered callback. */
  emit(event) {
    if (this._onEvent) this._onEvent(event);
  }
  async spawn(worker, brief) {
    this.calls.spawn.push({ worker, brief });
    if (this.gates.spawn) await this.gates.spawn;
    return this.acks.spawn;
  }
  async prompt(worker, content, mode) {
    this.calls.prompt.push({ worker, content, mode });
    if (this.gates.prompt) await this.gates.prompt;
    return this.acks.prompt;
  }
  async interrupt(worker, then) {
    this.calls.interrupt.push({ worker, then });
    if (this.gates.interrupt) await this.gates.interrupt;
    return this.acks.interrupt;
  }
  async approve(worker, requestId, decision, payload) {
    this.calls.approve.push({ worker, requestId, decision, payload });
    if (this.gates.approve) await this.gates.approve;
    return this.acks.approve;
  }
  /** D1: distinct from approve() — for free-form QUESTION answers, never for approvals. */
  async answer(worker, requestId, answer) {
    this.calls.answer.push({ worker, requestId, answer });
    if (this.gates.answer) await this.gates.answer;
    return this.acks.answer;
  }
  async kill(worker) {
    this.calls.kill.push({ worker });
    if (this.gates.kill) await this.gates.kill;
    return this.acks.kill;
  }
}

/** Spy conforming to the WorktreeManager contract (spec §3.2). */
class SpyWorktreeManager {
  constructor() {
    this.calls = {
      create: [],
      capture: [],
      createVerifyWorktree: [],
      removeVerifyWorktree: [],
      remove: [],
      reconcile: [],
    };
  }
  async create(taskId, baseRef) {
    this.calls.create.push({ taskId, baseRef });
    return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' };
  }
  async capture(worktreePath) {
    this.calls.capture.push({ worktreePath });
    return { sha: 'sha-result' };
  }
  async createVerifyWorktree(taskId, sha) {
    this.calls.createVerifyWorktree.push({ taskId, sha });
    return { path: `/tmp/verify/${taskId}-${sha}` };
  }
  async removeVerifyWorktree(verifyPath) {
    this.calls.removeVerifyWorktree.push({ verifyPath });
  }
  async remove(taskId) {
    this.calls.remove.push({ taskId });
  }
  async reconcile() {
    this.calls.reconcile.push({});
  }
}

function passingReferee() {
  return async (task, result, opts) => ({
    reverified: true,
    observedExit: task.brief.verification.expectExit,
    matchesClaim: true,
    locus: 'fresh_sandbox',
    note: 'ok',
  });
}

function failingReferee(observedExit) {
  return async (task, result, opts) => ({
    reverified: true,
    observedExit,
    matchesClaim: observedExit === result.verification.claimedExit,
    locus: 'fresh_sandbox',
    note: 'observed exit did not match the worker\'s claim',
  });
}

function fixedRoute(vendor) {
  return () => vendor;
}

/** Wires up a Coordinator with sane defaults; every dependency is overridable. */
function setup(overrides = {}) {
  const dir = tmpDir();
  const log = overrides.log ?? new Log(join(dir, 'log'));
  const fences = overrides.fences ?? new FenceTable();
  const adapters = overrides.adapters ?? { mock: new ScriptableAdapter() };
  const worktrees = overrides.worktrees ?? new SpyWorktreeManager();
  const referee = overrides.referee ?? passingReferee();
  const route = overrides.route ?? fixedRoute(Object.keys(adapters)[0]);
  let t = 0;
  const now = overrides.now ?? (() => t);
  const advance = (ms) => {
    t += ms;
  };
  const coordinator = new Coordinator({
    log,
    fences,
    adapters,
    worktrees,
    referee,
    route,
    now,
    approvalTimeoutMs: overrides.approvalTimeoutMs ?? 60000,
    stopDeadlineMs: overrides.stopDeadlineMs ?? 15000,
  });
  return { dir, log, fences, adapters, worktrees, referee, route, now, advance, coordinator };
}

// ============================================================
// dispatch — behaviors 19-24
// ============================================================

test('spawn() under headroom creates the worktree, calls adapter.spawn, logs spawned then turn_started in order, returns a working handle', async () => {
  const { coordinator, adapters, worktrees, log } = setup();
  const handle = await coordinator.spawn('mock', makeBrief());
  assert.equal(handle.status, 'working');
  assert.equal(worktrees.calls.create.length, 1);
  assert.equal(adapters.mock.calls.spawn.length, 1);

  const kinds = log.read(handle.id).map((e) => e.kind);
  const spawnedIdx = kinds.indexOf('lifecycle.spawned');
  const startedIdx = kinds.indexOf('lifecycle.turn_started');
  assert.ok(spawnedIdx !== -1 && startedIdx !== -1);
  assert.ok(spawnedIdx < startedIdx, 'lifecycle.spawned must precede lifecycle.turn_started');
});

test('spawn() at the vendor concurrency ceiling queues as pending (GLM=1 case); promotes once a slot frees', async () => {
  const adapter = new ScriptableAdapter({ harness: 'glm-via-claude', concurrencyCeiling: 1 });
  const { coordinator, worktrees } = setup({ adapters: { glm: adapter }, route: fixedRoute('glm') });

  const handleA = await coordinator.spawn('glm', makeBrief(), { taskId: 'a' });
  assert.equal(handleA.status, 'working');

  const handleB = await coordinator.spawn('glm', makeBrief(), { taskId: 'b' });
  assert.equal(handleB.status, 'pending');
  assert.equal(worktrees.calls.create.length, 1, 'no worktree for the queued task yet');
  assert.equal(adapter.calls.spawn.length, 1, 'no adapter.spawn call for the queued task yet');

  adapter.emit({
    worker: handleA.id,
    harness: 'glm-via-claude@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult(),
  });
  await coordinator.wait(50);
  coordinator.tick();

  const b = coordinator.list().find((w) => w.id === handleB.id);
  assert.equal(b.status, 'working');
  assert.equal(adapter.calls.spawn.length, 2);
});

// core#6: a worker in 'stopping' (or 'blocked') still occupies a concurrency seat until it
// reaches idle/terminal — the ceiling accounting race. Every OTHER ceiling test frees the
// slot via a completed lifecycle.turn_completed; this one frees it via an in-flight
// interrupt() that has NOT yet been confirmed, which must NOT free the seat.
test('D11/core#6: a "stopping" worker still counts against its vendor ceiling until its stop is confirmed, not merely requested (GLM=1)', async () => {
  const adapter = new ScriptableAdapter({ harness: 'glm-via-claude', concurrencyCeiling: 1 });
  const { coordinator, worktrees } = setup({ adapters: { glm: adapter }, route: fixedRoute('glm') });

  const handleA = await coordinator.spawn('glm', makeBrief(), { taskId: 'a' });
  assert.equal(handleA.status, 'working');

  // Interrupt the sole active worker but gate its adapter Ack so it stays 'stopping'
  // indefinitely — the confirmed-stop event never arrives during this test.
  adapter.gates.interrupt = new Promise(() => {});
  coordinator.interrupt(handleA.id);
  assert.equal(coordinator.list().find((w) => w.id === handleA.id).status, 'stopping');

  const handleB = await coordinator.spawn('glm', makeBrief(), { taskId: 'b' });
  assert.equal(
    handleB.status,
    'pending',
    'a second GLM task must not dispatch while the first is only "stopping", not yet confirmed-stopped — GLM concurrencyCeiling:1 is a hard vendor limit'
  );
  assert.equal(worktrees.calls.create.length, 1, 'no worktree for the still-blocked second task');
  assert.equal(adapter.calls.spawn.length, 1, 'no adapter.spawn call for the still-blocked second task');

  // Explicitly re-check after a tick — the seat must remain occupied, not freed by the
  // mere fact that an interrupt was requested.
  coordinator.tick();
  assert.equal(coordinator.list().find((w) => w.id === handleB.id).status, 'pending');
});

test('a task with an unsatisfied dep stays pending even with free concurrency headroom', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });

  const dependent = await coordinator.spawn('mock', makeBrief(), { taskId: 't1', deps: ['t0'] });
  assert.equal(dependent.status, 'pending');
  assert.equal(adapter.calls.spawn.length, 0);

  const base = await coordinator.spawn('mock', makeBrief(), { taskId: 't0' });
  assert.equal(base.status, 'working');

  adapter.emit({
    worker: base.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult(),
  });
  await coordinator.wait(50);
  coordinator.tick();

  const promoted = coordinator.list().find((w) => w.id === dependent.id);
  assert.equal(promoted.status, 'working', 'dep satisfied -> task must now dispatch');
});

// core#10 / D11: dependency cycles are validated OUT at spawn() time, never left as a
// silent permanent-pending deadlock. D11 pins the exact behavior and error class.
test('D11/core#10: spawn() rejects a task whose deps would close a dependency cycle with DependencyCycleError, never a silent permanent-pending deadlock', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });

  // t1 depends on t2, which does not exist yet — queueing it is entirely legitimate.
  const t1 = await coordinator.spawn('mock', makeBrief(), { taskId: 't1', deps: ['t2'] });
  assert.equal(t1.status, 'pending');

  // t2 depending back on t1 closes a 2-cycle: t1 -> t2 -> t1. This must be rejected
  // outright on the call that completes the cycle, not silently left pending forever.
  await assert.rejects(
    () => coordinator.spawn('mock', makeBrief(), { taskId: 't2', deps: ['t1'] }),
    DependencyCycleError
  );

  // The rejected cyclic spawn must not have registered a task or dispatched anything.
  const table = coordinator.list();
  assert.ok(!table.some((w) => w.taskId === 't2'), 'a rejected cyclic spawn must not leave a task behind');
  assert.equal(adapter.calls.spawn.length, 0, 'no worker was ever dispatched for either half of the cycle');

  // Repeated tick()s must not eventually "resolve" the cycle by any other means — t1 stays
  // legitimately pending on its (never-satisfiable, since t2 was rejected) dep forever, but
  // that is a distinct, non-silent outcome from what a real cycle would have caused.
  coordinator.tick();
  coordinator.tick();
  assert.equal(coordinator.list().find((w) => w.id === t1.id).status, 'pending');
});

// core#7: proves the tick()-driven deadline sweep still works as a redundant backup path,
// exercised via a command OTHER than the literally-named tick(). Since C4, the coordinator
// *also* arms a real, unref'd background timer on every fresh stop-waiter (independent of
// tick()) — so "no background timer thread" is no longer true of the coordinator overall.
// This test's setup() never overrides opts.setTimeout/opts.clearTimeout, so that real timer
// is armed for the full stopDeadlineMs (1000ms) here too; but this test's fake logical clock
// is advanced instantly and a non-tick command (list()) is called in the same real-time tick,
// so the sweep-based path always wins the race and force-stops microseconds in, long before
// the real 1-second background timer could ever fire (and _forceStop's clear makes the
// later-armed real timer moot). What this test actually proves: the deadline sweep is not
// hardcoded to fire only from a literal `.tick()` call — any public command implicitly
// ticking first is enough, even with the real background timer also armed alongside it.
test('core#7: the implicit tick-on-every-command contract fires a deadline sweep as a side effect of a command other than .tick()', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, advance, log } = setup({ adapters: { mock: adapter }, stopDeadlineMs: 1000 });
  const handle = await coordinator.spawn('mock', makeBrief());

  const p = coordinator.interrupt(handle.id); // adapter Acks, but no confirmed-stop ever arrives
  advance(1001);

  // Deliberately call a DIFFERENT public command instead of .tick() anywhere in this test.
  coordinator.list();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  const result = await p;
  assert.equal(result.result, 'forced', 'the stopDeadlineMs sweep must have fired as a side effect of list(), not require an explicit tick()');
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'dead');
  assert.equal(adapter.calls.kill.length, 1, 'a forced stop must escalate to adapter.kill()');
  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.forced_stop'));
});

test('spawn(\'auto\', brief) resolves the vendor via the injected route() using live cards/inFlight', async () => {
  const adapterA = new ScriptableAdapter({ harness: 'a' });
  const adapterB = new ScriptableAdapter({ harness: 'b' });
  let seenCards = null;
  let seenInFlight = null;
  const route = (task, cards, inFlight) => {
    seenCards = cards;
    seenInFlight = inFlight;
    return 'b';
  };
  const { coordinator } = setup({ adapters: { a: adapterA, b: adapterB }, route });

  const handle = await coordinator.spawn('auto', makeBrief());
  assert.equal(handle.status, 'working');
  assert.ok(seenCards && seenCards.a && seenCards.b, 'route() must see the live HarnessCard map');
  assert.ok(seenInFlight, 'route() must see in-flight counts');
  assert.equal(adapterB.calls.spawn.length, 1);
  assert.equal(adapterA.calls.spawn.length, 0);
});

test('spawn() with a duplicate taskId throws DuplicateTaskIdError on the second call; the first task is untouched', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });

  const first = await coordinator.spawn('mock', makeBrief(), { taskId: 'dup' });
  await assert.rejects(
    () => coordinator.spawn('mock', makeBrief(), { taskId: 'dup' }),
    DuplicateTaskIdError
  );

  const stillThere = coordinator.list().find((w) => w.id === first.id);
  assert.equal(stillThere.status, 'working');
  assert.equal(adapter.calls.spawn.length, 1, 'the failed duplicate must not have dispatched a second worker');
});

test('with one free slot and two simultaneously-ready tasks, exactly one dispatches per tick(), deterministically FIFO', async () => {
  const adapter = new ScriptableAdapter({ concurrencyCeiling: 1 });
  const { coordinator } = setup({ adapters: { mock: adapter }, route: fixedRoute('mock') });

  const base = await coordinator.spawn('mock', makeBrief(), { taskId: 't0' });
  assert.equal(base.status, 'working');
  const first = await coordinator.spawn('mock', makeBrief(), { taskId: 't1', deps: ['t0'] });
  const second = await coordinator.spawn('mock', makeBrief(), { taskId: 't2', deps: ['t0'] });
  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'pending');

  adapter.emit({
    worker: base.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult(),
  });
  await coordinator.wait(50);
  coordinator.tick();

  const table = coordinator.list();
  const firstNow = table.find((w) => w.id === first.id);
  const secondNow = table.find((w) => w.id === second.id);
  assert.equal(firstNow.status, 'working', 't1 was created first (FIFO) and must dispatch');
  assert.equal(secondNow.status, 'pending', 't2 must remain queued behind the ceiling');
  assert.equal(adapter.calls.spawn.length, 2, 't0 + exactly one of {t1,t2}');
});

// ============================================================
// send() / fencing races — behaviors 25-29
// ============================================================

test('send() a nudge to a healthy working worker succeeds and logs control.nudge', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const result = await coordinator.send(handle.id, { text: 'keep going' }, 'nudge');
  assert.equal(result.ok, true);
  assert.equal(result.result, 'ok');
  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.nudge'));
});

test('a same-tick interrupt racing an in-flight send() rejects the send as stale (no control.nudge logged)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const gate = deferred();
  adapter.gates.prompt = gate.promise; // send()'s prompt() call will not resolve until we let it

  const sendPromise = coordinator.send(handle.id, { text: 'nudge before interrupt' }, 'nudge');
  // interrupt() bumps the fence synchronously (before awaiting anything) — this must land
  // *after* send() already snapshotted its stamp but *before* send()'s post-await recheck.
  const interruptPromise = coordinator.interrupt(handle.id);
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'stopping');

  gate.resolve({ ok: true });
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });

  const sendResult = await sendPromise;
  await interruptPromise;

  assert.equal(sendResult.ok, false);
  assert.equal(sendResult.result, 'stale_fence');
  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(!kinds.includes('control.nudge'), 'a stale send must never be applied as a nudge');
  assert.ok(kinds.includes('control.stale_rejected'));
  assert.ok(
    kinds.includes('control.delivery_amended'),
    'adapter.prompt() was actually invoked before the fence moved — the log must say so, not just that the send was rejected'
  );
});

test('send() to an unknown worker throws WorkerNotFoundError', async () => {
  const { coordinator } = setup();
  await assert.rejects(() => coordinator.send('no-such-worker', { text: 'hi' }, 'nudge'), WorkerNotFoundError);
});

test('send() propagates emulated:true from the adapter ack verbatim, into both the return value and the logged event', async () => {
  const adapter = new ScriptableAdapter({ verbs: { steer: 'emulated' } });
  adapter.acks.prompt = { ok: true, emulated: true };
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const result = await coordinator.send(handle.id, { text: 'steer this way' }, 'steer');
  assert.equal(result.emulated, true);
  const steerEvent = log.read(handle.id).find((e) => e.kind === 'control.steer');
  assert.ok(steerEvent);
  assert.equal(steerEvent.emulated, true);
});

test('send() on a worker currently stopping is refused immediately, without calling the adapter or writing any log entry', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.gates.interrupt = new Promise(() => {}); // wedge, so we can inspect mid-stop
  coordinator.interrupt(handle.id); // fire-and-forget; status flips synchronously
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'stopping');

  const promptCallsBefore = adapter.calls.prompt.length;
  const logCountBefore = log.read(handle.id).length;
  const result = await coordinator.send(handle.id, { text: 'nudge' }, 'nudge');
  assert.equal(result.ok, false);
  assert.equal(result.result, 'worker_stopping');
  assert.equal(adapter.calls.prompt.length, promptCallsBefore, 'no adapter call for a nudge queued mid-stop');
  // core#12: §3.5 send step 2 promises "no adapter call, no log entry" — the log-entry half
  // was previously unverified (only the adapter-call half was checked).
  assert.equal(
    log.read(handle.id).length,
    logCountBefore,
    'a nudge refused mid-stop must append no log entry at all, not just no control.nudge'
  );
});

// ============================================================
// interrupt() / two-phase stop — behaviors 30-35
// ============================================================

test('interrupt() sets status to stopping synchronously, before the confirmed-stop event arrives', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const gate = deferred();
  adapter.gates.interrupt = gate.promise;
  const p = coordinator.interrupt(handle.id);

  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'stopping');

  gate.resolve({ ok: true });
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });
  const result = await p;
  assert.equal(result.result, 'confirmed');
});

test('interrupt()\'s promise does not resolve until the adapter emits its confirmed-stop event', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const p = coordinator.interrupt(handle.id);
  let settled = false;
  p.then(() => {
    settled = true;
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false, 'interrupt() must stay pending until the adapter confirms the stop');

  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });
  const result = await p;
  assert.equal(settled, true);
  assert.equal(result.result, 'confirmed');
});

// core#11: a lifecycle.turn_completed claim arriving DURING the stopping window must be
// discarded — the task must never end up 'completed'. This extends the C5 worktree-lease
// test (which only proved the trust gate's verify-worktree machinery is not touched mid-stop)
// to also assert the final outcome once the interrupt confirms.
test('while a worker is stopping, its worktree lease is not touched by verify/remove operations, and a turn_completed claim arriving mid-stop is discarded (never completed)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, worktrees } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const gate = deferred();
  adapter.gates.interrupt = gate.promise;
  const interruptPromise = coordinator.interrupt(handle.id);
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'stopping');

  // A completion claim arriving mid-stop must not trigger the trust gate's verify-worktree
  // machinery against this task while the stop is still unresolved (Invariant C5).
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult(),
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(worktrees.calls.createVerifyWorktree.length, 0);
  assert.equal(worktrees.calls.remove.length, 0);

  gate.resolve({ ok: true });
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });
  const interruptResult = await interruptPromise;
  assert.equal(interruptResult.result, 'confirmed');

  // D9: the claim that arrived mid-stop must be discarded, never retroactively trusted —
  // the trust gate must still never have run, and the task must never reach 'completed'.
  assert.equal(
    worktrees.calls.createVerifyWorktree.length,
    0,
    'a turn_completed claim received during stopping must never trigger the trust gate, even after confirmation'
  );
  const outcome = await coordinator.result(handle.id);
  assert.notEqual(outcome.status, 'completed', 'a completion claim racing an interrupt must never win as completed');
  if (outcome.ready) {
    assert.ok(
      ['cancelled', 'failed'].includes(outcome.status),
      'a discarded mid-stop claim ends the task cancelled/failed per D9, not completed'
    );
  }
});

test('interrupt() on a blocked worker auto-resolves its pending approval with a cancel decision', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'appr-1';
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'approval.requested',
    actor: 'worker',
    payload: { requestId, question: 'ok to proceed?', blocking: true },
  });
  await Promise.resolve();
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'blocked');

  const interruptPromise = coordinator.interrupt(handle.id);
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });
  const result = await interruptPromise;
  assert.equal(result.result, 'confirmed');

  const approveCall = adapter.calls.approve.find((c) => c.requestId === requestId);
  assert.ok(approveCall, 'interrupt() must auto-resolve the outstanding approval');
  assert.equal(approveCall.decision, 'cancel');

  const followUp = await coordinator.respond(requestId, { decision: 'allow' });
  assert.equal(followUp.result, 'already_resolved', 'the approval was already consumed by interrupt()');
});

test('if the adapter never emits a confirmed-stop event, interrupt() resolves forced once stopDeadlineMs elapses', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, advance, log } = setup({ adapters: { mock: adapter }, stopDeadlineMs: 1000 });
  const handle = await coordinator.spawn('mock', makeBrief());

  const p = coordinator.interrupt(handle.id); // adapter.interrupt() acks immediately, but no confirmed-stop ever arrives
  advance(1001);
  coordinator.tick();

  const result = await p;
  assert.equal(result.result, 'forced');
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'dead');
  assert.equal(adapter.calls.kill.length, 1, 'a forced stop must escalate to adapter.kill()');
  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.forced_stop'));
});

// core#2 / D9: composing interrupt()/kill() on the same worker before the first confirms.
// A fresh interrupt/kill on idle/working/blocked bumps the fence and calls the adapter; a
// SECOND interrupt/kill while already 'stopping' must NOT re-bump the fence or re-call the
// adapter — it attaches as an additional waiter on the same in-flight confirmation. A kill()
// arriving during a soft interrupt()'s wait escalates immediately to force-kill. Every
// interrupt/kill promise must resolve — none may hang on a fence value the adapter can
// never emit (SYSTEM.md §5.6: kill always works).

test('D9: a second interrupt() on a worker already stopping does not re-bump the fence or re-call the adapter; it attaches as an additional waiter and both promises resolve on the single confirmation', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, fences } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const gate = deferred();
  adapter.gates.interrupt = gate.promise;
  const first = coordinator.interrupt(handle.id);
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'stopping');
  const fenceAfterFirst = fences.current(handle.id).fence;

  const second = coordinator.interrupt(handle.id); // fired while still 'stopping', first not yet confirmed
  await Promise.resolve();
  assert.equal(adapter.calls.interrupt.length, 1, 'a second interrupt() while stopping must not re-call the adapter');
  assert.equal(
    fences.current(handle.id).fence,
    fenceAfterFirst,
    'a second interrupt() while stopping must not re-bump the fence'
  );

  gate.resolve({ ok: true });
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });

  // Both promises MUST resolve — neither may hang on a fence value the adapter never emits.
  const [r1, r2] = await Promise.all([first, second]);
  assert.equal(r1.result, 'confirmed');
  assert.equal(r2.result, 'confirmed');
  assert.equal(adapter.calls.interrupt.length, 1, 'still exactly one physical adapter.interrupt() call for both waiters');
});

test('D9: kill() arriving while a soft interrupt() is still in flight escalates immediately to force-kill; both promises resolve and the worker ends dead', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter }, stopDeadlineMs: 15000 });
  const handle = await coordinator.spawn('mock', makeBrief());

  const interruptGate = new Promise(() => {}); // the soft interrupt's adapter call never Acks
  adapter.gates.interrupt = interruptGate;
  const interruptPromise = coordinator.interrupt(handle.id);
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'stopping');

  const killPromise = coordinator.kill(handle.id);
  // Escalation to force-kill must be immediate — no clock advance past stopDeadlineMs, no
  // explicit tick() — distinguishing it from the ordinary stopDeadlineMs-driven forced path.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    adapter.calls.kill.length,
    1,
    'kill() arriving during an in-flight soft interrupt must escalate to adapter.kill() immediately'
  );

  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'kill.confirmed',
    actor: 'worker',
    payload: {},
  });

  // Neither the superseded interrupt() nor the escalating kill() may hang.
  const [interruptResult, killResult] = await Promise.all([interruptPromise, killPromise]);
  assert.equal(killResult.result, 'confirmed');
  assert.ok(
    ['confirmed', 'forced'].includes(interruptResult.result),
    'the superseded interrupt() must still resolve, never hang, once the escalated kill lands'
  );
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'dead');
});

// core#13: WorkerNotFoundError is proven for send() (behavior 27) but was previously
// untested for interrupt()/kill()/result(), even though they share getWorker().

test('interrupt() on an unknown worker throws WorkerNotFoundError', async () => {
  const { coordinator } = setup();
  await assert.rejects(() => coordinator.interrupt('no-such-worker'), WorkerNotFoundError);
});

test('kill() on an unknown worker throws WorkerNotFoundError', async () => {
  const { coordinator } = setup();
  await assert.rejects(() => coordinator.kill('no-such-worker'), WorkerNotFoundError);
});

test('result() on an unknown worker throws WorkerNotFoundError', async () => {
  const { coordinator } = setup();
  await assert.rejects(() => coordinator.result('no-such-worker'), WorkerNotFoundError);
});

// core#14 / C9: "no silent emulation" is tested for send() but interrupt()/kill() also
// receive an Ack that may carry emulated:true, and C9 requires it propagate verbatim
// into both the return value and the logged confirmation event.

test('C9/core#14: interrupt() propagates emulated:true from the adapter Ack verbatim into the return value and the logged control.interrupt_confirmed event', async () => {
  const adapter = new ScriptableAdapter({ verbs: { interrupt: 'emulated' } });
  adapter.acks.interrupt = { ok: true, emulated: true };
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const p = coordinator.interrupt(handle.id);
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });
  const result = await p;
  assert.equal(result.emulated, true, "interrupt()'s return shape must carry emulated, not silently drop it");

  const confirmedEvent = log.read(handle.id).find((e) => e.kind === 'control.interrupt_confirmed');
  assert.ok(confirmedEvent);
  assert.equal(confirmedEvent.emulated, true, 'the logged confirmation must also carry emulated:true');
});

test('C9/core#14: kill() propagates emulated:true from the adapter Ack verbatim into the return value and the logged kill.confirmed event', async () => {
  const adapter = new ScriptableAdapter({ verbs: { kill: 'emulated' } });
  adapter.acks.kill = { ok: true, emulated: true };
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const p = coordinator.kill(handle.id);
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'kill.confirmed',
    actor: 'worker',
    payload: {},
  });
  const result = await p;
  assert.equal(result.emulated, true, "kill()'s return shape must carry emulated, not silently drop it");

  const confirmedEvent = log.read(handle.id).find((e) => e.kind === 'kill.confirmed');
  assert.ok(confirmedEvent);
  assert.equal(confirmedEvent.emulated, true, 'the logged confirmation must also carry emulated:true');
});

test('kill() on an already-dead worker is idempotent (already_dead, no duplicate kill.confirmed)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const firstKill = coordinator.kill(handle.id);
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'kill.confirmed',
    actor: 'worker',
    payload: {},
  });
  const first = await firstKill;
  assert.equal(first.result, 'confirmed');
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'dead');

  const second = await coordinator.kill(handle.id);
  assert.equal(second.result, 'already_dead');

  const killConfirmedCount = log.read(handle.id).filter((e) => e.kind === 'kill.confirmed').length;
  assert.equal(killConfirmedCount, 1, 'a second kill() on a dead worker must not log a duplicate confirmation');
});

// ============================================================
// respond() / single-consumer approvals & questions — behaviors 36-41
// ============================================================

test('a blocking question surfaces the worker as blocked and appears as a question attention item', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'q-1';
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'question.asked',
    actor: 'worker',
    payload: { requestId, question: 'which approach?', blocking: true },
  });
  await Promise.resolve();
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'blocked');

  const digest = await coordinator.wait(50);
  const item = digest.attention.find((a) => a.requestId === requestId);
  assert.ok(item, 'the blocking question must surface as an attention item');
  assert.equal(item.type, 'question');
});

// core#1 / D1 / D3: respond() to a QUESTION must call adapter.answer() with the free-form
// answer (never approve()); respond() to an APPROVAL must call adapter.approve() with the
// closed enum decision (never answer()). Both are asserted on the exact adapter method +
// args called, not merely the coordinator-side status, so an implementation that silently
// drops the delivery (or aliases the two paths) cannot pass.

test('respond() answers a pending QUESTION: calls adapter.answer() with the free-form answer (never approve()), question.answered logged, worker returns to working', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'q-2';
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'question.asked',
    actor: 'worker',
    payload: { requestId, question: 'pick one', blocking: true },
  });
  await Promise.resolve();

  const result = await coordinator.respond(requestId, { text: 'option A' });
  assert.equal(result.ok, true);
  assert.equal(result.result, 'applied');
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'working');

  // D1/core#1: the exact adapter call, not just the status transition.
  const answerCall = adapter.calls.answer.find((c) => c.requestId === requestId);
  assert.ok(answerCall, 'respond() on a question must call adapter.answer(), not approve()');
  assert.equal(answerCall.worker, handle.id);
  assert.deepEqual(answerCall.answer, { text: 'option A' });
  assert.equal(
    adapter.calls.approve.filter((c) => c.requestId === requestId).length,
    0,
    'a question response must never be aliased onto approve()'
  );

  // D3: 'question.answered' is the canonical kind, not 'question.resolved'.
  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('question.answered'));
  assert.ok(!kinds.includes('question.resolved'), 'question.resolved is not in the D3 vocabulary');
});

test('respond() resolves a pending APPROVAL: calls adapter.approve() with the closed enum decision (never answer()), approval.resolved logged', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'appr-1';
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'approval.requested',
    actor: 'worker',
    payload: { requestId, question: 'ok to proceed?', blocking: true },
  });
  await Promise.resolve();

  const result = await coordinator.respond(requestId, { decision: 'allow' });
  assert.equal(result.ok, true);
  assert.equal(result.result, 'applied');
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'working');

  // D1/core#1: the exact adapter call — approve() with the extracted enum decision.
  const approveCall = adapter.calls.approve.find((c) => c.requestId === requestId);
  assert.ok(approveCall, 'respond() on an approval must call adapter.approve()');
  assert.equal(approveCall.worker, handle.id);
  assert.equal(approveCall.decision, 'allow', 'approve() must receive the closed enum decision, not the whole answer object');
  assert.equal(
    adapter.calls.answer.filter((c) => c.requestId === requestId).length,
    0,
    'an approval response must never be aliased onto answer()'
  );

  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('approval.resolved'));
});

test('single-consumer: two respond() calls issued back-to-back for the same requestId resolve exactly once', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'q-3';
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'question.asked',
    actor: 'worker',
    payload: { requestId, question: 'pick one', blocking: true },
  });
  await Promise.resolve();

  // Both calls start synchronously, before either has a chance to await internally —
  // this is what makes the CAS race meaningful rather than accidentally serialized.
  const p1 = coordinator.respond(requestId, { text: 'A' });
  const p2 = coordinator.respond(requestId, { text: 'B' });
  const [r1, r2] = await Promise.all([p1, p2]);

  const results = [r1.result, r2.result].sort();
  assert.deepEqual(results, ['already_resolved', 'applied']);

  const loser = r1.result === 'already_resolved' ? r1 : r2;
  const candidateAnswers = [JSON.stringify({ text: 'A' }), JSON.stringify({ text: 'B' })];
  assert.ok(
    candidateAnswers.includes(JSON.stringify(loser.resolution)),
    'the loser must echo whichever answer actually won'
  );
  // D1: the question is delivered exclusively via adapter.answer(), never approve().
  const deliveryCount = adapter.calls.answer.filter((c) => c.requestId === requestId).length;
  assert.equal(deliveryCount, 1, 'exactly one delivery to adapter.answer(), never two');
  assert.equal(
    adapter.calls.approve.filter((c) => c.requestId === requestId).length,
    0,
    'a question must never be delivered via approve()'
  );
});

test('respond() on an unknown requestId returns not_found without throwing', async () => {
  const { coordinator } = setup();
  const result = await coordinator.respond('does-not-exist', { text: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.result, 'not_found');
});

test('an unanswered approval auto-resolves to a fixed \'deny\' default after approvalTimeoutMs; a late respond() is already_resolved', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, advance } = setup({ adapters: { mock: adapter }, approvalTimeoutMs: 1000 });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'appr-2';
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'approval.requested',
    actor: 'worker',
    payload: { requestId, question: 'proceed?', blocking: true },
  });
  await Promise.resolve();

  advance(1001);
  coordinator.tick();

  const approveCall = adapter.calls.approve.find((c) => c.requestId === requestId);
  assert.ok(approveCall, 'tick() must sweep the expired approval and deliver the default decision');
  // core#8: the default is pinned to exactly 'deny' (fail-closed) — an exact match, not
  // an includes() over ['deny','cancel'], so two spec-compliant implementations cannot
  // disagree on live behavior for every timed-out approval in the system.
  assert.equal(approveCall.decision, 'deny');

  const late = await coordinator.respond(requestId, { decision: 'allow' });
  assert.equal(late.result, 'already_resolved');
});

test('an answer arriving after the asking turn has ended is consumed (single-consumer holds) but not delivered to adapter.answer()', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator, log, fences } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const requestId = 'q-4';
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'question.asked',
    actor: 'worker',
    payload: { requestId, question: 'pick one', blocking: true },
  });
  await Promise.resolve();

  // A new turn starts for this worker before the question is ever answered.
  fences.bumpTurn(handle.id);
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: fences.current(handle.id).turnEpoch,
    kind: 'lifecycle.turn_started',
    actor: 'orchestrator',
    payload: {},
  });
  await Promise.resolve();

  const answerCallsBefore = adapter.calls.answer.length;
  const result = await coordinator.respond(requestId, { text: 'too late' });
  assert.equal(result.ok, true, 'single-consumer still resolves the request exactly once');
  assert.equal(result.result, 'applied');
  assert.equal(adapter.calls.answer.length, answerCallsBefore, 'a stale-turn answer must never reach adapter.answer()');

  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.stale_rejected'));

  const second = await coordinator.respond(requestId, { text: 'again' });
  assert.equal(second.result, 'already_resolved', 'the request is already consumed, even though undelivered');
});

// ============================================================
// trust gate — behaviors 42-46
// ============================================================

test('the trust gate runs the referee in a fresh verify sandbox, never the worker\'s own worktree', async () => {
  const adapter = new ScriptableAdapter();
  let capturedSandbox = null;
  const referee = async (task, result, opts) => {
    capturedSandbox = opts.sandbox;
    return { reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' };
  };
  const { coordinator, worktrees } = setup({ adapters: { mock: adapter }, referee });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult(),
  });
  await coordinator.wait(50);

  assert.equal(worktrees.calls.createVerifyWorktree.length, 1);
  const ownWorktree = coordinator.list().find((w) => w.id === handle.id).worktree;
  assert.ok(capturedSandbox, 'referee must have been called with a sandbox path');
  assert.notEqual(capturedSandbox, ownWorktree, 'the referee sandbox must never be the worker\'s own worktree');
});

test('forged done: worker claims completed/exit-0 but the referee observes a mismatched exit -> task ends failed', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter }, referee: failingReferee(1) });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult({ status: 'completed', verification: { command: 'true', claimedExit: 0 } }),
  });
  await coordinator.wait(50);

  const outcome = await coordinator.result(handle.id);
  assert.equal(outcome.ready, true);
  assert.equal(outcome.status, 'failed', 'a forged/incorrect completion claim must never produce completed');
  assert.equal(outcome.verdict.matchesClaim, false);
});

test('result() reports not-ready while verifying/working, then the final verdict once the trust gate resolves', async () => {
  const adapter = new ScriptableAdapter();
  const gate = deferred();
  const referee = async () => {
    await gate.promise;
    return { reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' };
  };
  const { coordinator } = setup({ adapters: { mock: adapter }, referee });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult(),
  });
  await Promise.resolve();
  await Promise.resolve();

  const mid = await coordinator.result(handle.id);
  assert.equal(mid.ready, false);
  assert.ok(['verifying', 'working'].includes(mid.status));

  gate.resolve();
  await coordinator.wait(50);

  const final = await coordinator.result(handle.id);
  assert.equal(final.ready, true);
  assert.equal(final.status, 'completed');
});

test('removeVerifyWorktree is called exactly once whether the referee resolves or throws', async () => {
  for (const shouldThrow of [false, true]) {
    const adapter = new ScriptableAdapter();
    const referee = shouldThrow
      ? async () => {
          throw new Error('referee blew up');
        }
      : passingReferee();
    const { coordinator, worktrees } = setup({ adapters: { mock: adapter }, referee });
    const handle = await coordinator.spawn('mock', makeBrief());

    adapter.emit({
      worker: handle.id,
      harness: 'mock@1.0.0',
      turnEpoch: 1,
      kind: 'lifecycle.turn_completed',
      actor: 'worker',
      payload: makeWorkerResult(),
    });
    await coordinator.wait(50);

    assert.equal(worktrees.calls.removeVerifyWorktree.length, 1, `shouldThrow=${shouldThrow}`);
  }
});

test('a throwing referee ends the task at failed (never stuck verifying, never completed) and logs an error event', async () => {
  const adapter = new ScriptableAdapter();
  const referee = async () => {
    throw new Error('referee blew up');
  };
  const { coordinator, log } = setup({ adapters: { mock: adapter }, referee });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: makeWorkerResult(),
  });
  await coordinator.wait(50);

  const outcome = await coordinator.result(handle.id);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.verdict, null);

  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('error'));
});

// ============================================================
// crash / restart / log-is-truth — behaviors 47-48
// ============================================================

// core#3 / D10: Coordinator construction replay. `new Coordinator(opts)` must rebuild ALL
// state (task status, WorkerHandle, FenceTable fence/turnEpoch) purely by reading the log —
// NO test may pre-seed `fences`/tasks by hand, and the task must never have been
// `spawn()`-ed on this coordinator instance. This test constructs the coordinator the
// NORMAL way against a log directory populated entirely out-of-band, and exercises every
// row of D10's event-kind -> state table in one pass.
test('construction replay (D10): a normally-constructed Coordinator rebuilds task/worker status per the D10 event-kind table, with no manual fences.register or spawn()', async () => {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));

  function seedWorker(workerId, taskId, events) {
    const common = { worker: workerId, harness: 'mock@1.0.0' };
    log.append({
      ...common,
      turnEpoch: 1,
      actor: 'orchestrator',
      kind: 'lifecycle.spawned',
      payload: { taskId, brief: makeBrief() },
    });
    for (const e of events) log.append({ ...common, ...e });
  }

  // Row 1: turn_completed + later verify.reverified{accept:true} -> completed.
  seedWorker('w-completed', 'task-completed', [
    { turnEpoch: 1, actor: 'orchestrator', kind: 'lifecycle.turn_started', payload: {} },
    { turnEpoch: 1, actor: 'worker', kind: 'lifecycle.turn_completed', payload: makeWorkerResult() },
    {
      turnEpoch: 1,
      actor: 'policy',
      kind: 'verify.reverified',
      payload: { accept: true, verdict: { reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' } },
    },
  ]);

  // Row 2: verify.reverified{accept:false} -> failed.
  seedWorker('w-failed', 'task-failed', [
    { turnEpoch: 1, actor: 'orchestrator', kind: 'lifecycle.turn_started', payload: {} },
    { turnEpoch: 1, actor: 'worker', kind: 'lifecycle.turn_completed', payload: makeWorkerResult() },
    {
      turnEpoch: 1,
      actor: 'policy',
      kind: 'verify.reverified',
      payload: { accept: false, verdict: { reverified: true, observedExit: 1, matchesClaim: false, locus: 'fresh_sandbox', note: 'mismatch' } },
    },
  ]);

  // Row 3: kill.confirmed / control.interrupt_confirmed (no later turn) -> cancelled/idle.
  seedWorker('w-cancelled', 'task-cancelled', [
    { turnEpoch: 1, actor: 'orchestrator', kind: 'lifecycle.turn_started', payload: {} },
    { turnEpoch: 1, actor: 'human', kind: 'control.interrupt_requested', payload: {} },
    { turnEpoch: 1, actor: 'worker', kind: 'control.interrupt_confirmed', payload: {} },
  ]);

  // Row 4: turn_started with no terminal event -> working (resumable).
  seedWorker('w-working', 'task-working', [{ turnEpoch: 1, actor: 'orchestrator', kind: 'lifecycle.turn_started', payload: {} }]);

  // Row 5: question.asked unanswered -> input_required.
  seedWorker('w-blocked', 'task-blocked', [
    { turnEpoch: 1, actor: 'orchestrator', kind: 'lifecycle.turn_started', payload: {} },
    {
      turnEpoch: 1,
      actor: 'worker',
      kind: 'question.asked',
      payload: { requestId: 'q-replay', question: 'which way?', blocking: true },
    },
  ]);

  // Constructed the NORMAL way: no manual fences.register(), no coordinator.spawn() call
  // for any of these tasks anywhere in this test.
  const fences = new FenceTable();
  const adapters = { mock: new ScriptableAdapter() };
  const worktrees = new SpyWorktreeManager();
  const coordinator = new Coordinator({
    log,
    fences,
    adapters,
    worktrees,
    referee: passingReferee(),
    route: fixedRoute('mock'),
    now: () => 0,
  });
  if (coordinator.ready) await coordinator.ready; // tolerate either sync or awaited-ready construction

  // Row 1 — completed.
  const completed = await coordinator.result('w-completed');
  assert.equal(completed.ready, true, 'construction must replay a terminal completed status from the log alone');
  assert.equal(completed.status, 'completed');

  // Row 2 — failed.
  const failed = await coordinator.result('w-failed');
  assert.equal(failed.ready, true);
  assert.equal(failed.status, 'failed');

  // Row 3 — cancelled/idle (D10 itself documents either as acceptable for this row).
  const cancelled = await coordinator.result('w-cancelled');
  assert.ok(['cancelled', 'idle'].includes(cancelled.status));

  // Row 4 — working (resumable), not ready.
  const working = await coordinator.result('w-working');
  assert.equal(working.ready, false);
  assert.equal(working.status, 'working');

  // Row 5 — input_required, not ready.
  const blocked = await coordinator.result('w-blocked');
  assert.equal(blocked.ready, false);
  assert.equal(blocked.status, 'input_required');

  // The FenceTable must be genuinely repopulated by replay (register() + max turnEpoch seen)
  // — NOT left unknown_worker, which is what a constructor with no replay logic would leave.
  for (const workerId of ['w-completed', 'w-failed', 'w-cancelled', 'w-working', 'w-blocked']) {
    const stamp = fences.current(workerId);
    assert.ok(stamp, `fences must be repopulated for ${workerId} by construction replay alone`);
    assert.equal(typeof stamp.fence, 'number');
    assert.equal(stamp.turnEpoch, 1, `${workerId}'s turnEpoch must be recovered from its log's max seen turnEpoch`);
    assert.notEqual(
      fences.check(workerId, stamp).result,
      'unknown_worker',
      `${workerId} must be register()-ed by replay, not left unknown_worker`
    );
  }

  // list()/result() must also work for a worker that was NEVER spawn()-ed on this instance.
  const table = coordinator.list();
  for (const [workerId, taskId] of [
    ['w-completed', 'task-completed'],
    ['w-failed', 'task-failed'],
    ['w-cancelled', 'task-cancelled'],
    ['w-working', 'task-working'],
    ['w-blocked', 'task-blocked'],
  ]) {
    const entry = table.find((w) => w.id === workerId);
    assert.ok(entry, `list() must include ${workerId}, replayed purely from the log`);
    assert.equal(entry.taskId, taskId);
  }
});

test('Coordinator construction invokes worktrees.reconcile() exactly once', () => {
  const { worktrees } = setup();
  assert.equal(worktrees.calls.reconcile.length, 1);
});

// ============================================================
// list() / wait() — behaviors 49-53
// ============================================================

test('list() reports pending and working workers with correct status/budgetUsed/pendingApprovalId fields', async () => {
  const adapter = new ScriptableAdapter({ concurrencyCeiling: 1 });
  const { coordinator } = setup({ adapters: { mock: adapter }, route: fixedRoute('mock') });

  const working = await coordinator.spawn('mock', makeBrief(), { taskId: 't-working' });
  const pendingHandle = await coordinator.spawn('mock', makeBrief(), { taskId: 't-pending' });
  assert.equal(pendingHandle.status, 'pending');

  const table = coordinator.list();
  const w = table.find((x) => x.id === working.id);
  assert.equal(w.status, 'working');
  assert.ok('budgetUsed' in w);
  assert.ok('pendingApprovalId' in w);

  const p = table.find((x) => x.id === pendingHandle.id);
  assert.equal(p.status, 'pending');
});

test('list() reflects a worker transitioning stopping -> dead', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const gate = deferred();
  adapter.gates.interrupt = gate.promise;
  const interruptPromise = coordinator.interrupt(handle.id);
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'stopping');

  gate.resolve({ ok: true });
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'control.interrupt_confirmed',
    actor: 'worker',
    payload: {},
  });
  await interruptPromise;

  const killPromise = coordinator.kill(handle.id);
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 2,
    kind: 'kill.confirmed',
    actor: 'worker',
    payload: {},
  });
  await killPromise;

  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'dead');
});

test('wait(timeoutMs) with nothing pending returns a bounded, empty digest without hanging', async () => {
  const { coordinator } = setup();
  const start = Date.now();
  const digest = await coordinator.wait(20);
  const elapsed = Date.now() - start;

  assert.deepEqual(digest.attention, []);
  assert.deepEqual(digest.facts, []);
  assert.equal(digest.more, false);
  assert.ok(elapsed < 5000, 'wait() must not hang well past its bound');
});

test('attention items (question/approval/alarm) are populated ahead of ordinary facts in the same digest', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'question.asked',
    actor: 'worker',
    payload: { requestId: 'q-5', question: 'pick one', blocking: true },
  });
  adapter.emit({
    worker: handle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'resource.tokens',
    actor: 'worker',
    payload: { tokens: 500 },
  });

  const digest = await coordinator.wait(50);
  assert.ok(digest.attention.length >= 1, 'a consumer reading only attention must never miss a blocked worker');
  assert.equal(digest.attention[0].type, 'question');
  assert.ok(digest.facts.length >= 1);
});

test('a second wait() with nothing new in between does not repeat facts/attention already returned', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({ adapters: { mock: adapter } });
  await coordinator.spawn('mock', makeBrief());

  const first = await coordinator.wait(50);
  assert.ok(first.facts.length > 0 || first.attention.length > 0);

  const second = await coordinator.wait(20);
  assert.deepEqual(second.facts, []);
  assert.deepEqual(second.attention, []);
});

// core#4 / D11: wait()'s at-least-once restart guarantee depends on a Cursor state-file
// location now PINNED in the contract: "<logDir>/.cursors/<worker>.floor", derived from
// Log's own constructor dir. Asserted directly (not just via black-box restart behavior)
// so a future refactor can't silently change the convention and break restart
// compatibility. Construction of coordinator2 is also now the NORMAL path (D10): no
// manual fences.register() — replay from the log alone must recover the worker.
test('at-least-once wait() (D11): a digest not yet followed by a subsequent wait() is re-served after a simulated restart, and the ack floor lives on disk at <logDir>/.cursors/<worker>.floor', async () => {
  const dir = tmpDir();
  const logDir = join(dir, 'log');
  const log1 = new Log(logDir);
  const fences1 = new FenceTable();
  const adapter1 = new ScriptableAdapter();
  const worktrees1 = new SpyWorktreeManager();
  const coordinator1 = new Coordinator({
    log: log1,
    fences: fences1,
    adapters: { mock: adapter1 },
    worktrees: worktrees1,
    referee: passingReferee(),
    route: fixedRoute('mock'),
    now: () => 0,
  });
  const handle = await coordinator1.spawn('mock', makeBrief());
  const first = await coordinator1.wait(50);
  assert.ok(first.facts.length > 0 || first.attention.length > 0);

  // D11: the pinned on-disk cursor floor path, owned by the Coordinator under logDir.
  const cursorFloorPath = join(logDir, '.cursors', `${handle.id}.floor`);
  assert.ok(
    existsSync(cursorFloorPath),
    `D11 pins the cursor floor at ${cursorFloorPath}; a future refactor must not silently move it`
  );

  // Simulate a crash: a brand-new Coordinator/Log/Cursor stack pointed at the same on-disk
  // log directory, with NO further wait() ever having been called to ack the digest above.
  // Constructed the NORMAL way (D10): no manual fences.register() — replay from the log
  // directory alone must recover the worker that coordinator1 spawned.
  const log2 = new Log(logDir);
  const fences2 = new FenceTable();
  const worktrees2 = new SpyWorktreeManager();
  const coordinator2 = new Coordinator({
    log: log2,
    fences: fences2,
    adapters: { mock: new ScriptableAdapter() },
    worktrees: worktrees2,
    referee: passingReferee(),
    route: fixedRoute('mock'),
    now: () => 0,
  });
  if (coordinator2.ready) await coordinator2.ready;

  const replayed = await coordinator2.wait(50);
  assert.deepEqual(
    replayed.facts.map((f) => f.seq),
    first.facts.map((f) => f.seq),
    'an un-acked digest must be re-served after a simulated restart, because the floor is on disk, not in memory (C8)'
  );
});

// ============================================================
// error taxonomy (§3.4) — extra coverage beyond the numbered list
// ============================================================

test('spawn() with an explicit unknown vendor name throws UnknownVendorError', async () => {
  const { coordinator } = setup();
  await assert.rejects(() => coordinator.spawn('does-not-exist', makeBrief()), UnknownVendorError);
});
