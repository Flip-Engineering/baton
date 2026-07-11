// phase8-correctness.test.mjs — Phase 8, "gate-and-control-correctness" cluster.
// Spec: spec/phase8/gate-and-control-correctness.md (C1-C7). This file is owned exclusively
// by that cluster; see the spec for the full rationale, RECONCILIATION relationship, and the
// list of existing tests each contract puts pressure on.
//
// TDD-RED: every test below exercises a behavior the audit (docs/22-completeness-audit.md
// §3/§6) found built-and-tested-elsewhere-but-bypassed-on-the-live-path. They are expected to
// fail today, for the right reason (wrong/old behavior, or — only for C6's brand-new
// `ensureBatonExcluded` export — a missing export surfaced as a TypeError inside the specific
// test that calls it, never as a module-load crash, since worktree.mjs is imported as a
// namespace object here rather than via a named import that could throw at parse time).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { createDriver, MockAdapter } from '../src/index.mjs';
import { verify, accept } from '../src/referee.mjs';
import * as worktreeMod from '../src/worktree.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

// ============================================================
// Shared fixtures / helpers
// ============================================================

const cleanupDirs = [];
test.after(() => {
  for (const d of cleanupDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

/** Creates a real temp directory and registers it for suite-end cleanup. */
function mkTmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(d);
  return d;
}

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

/** A real git repo with one base commit and `.baton/` PRE-excluded (the common case — C6's own
 * tests deliberately use `makeRawRepo()` below instead, since NOT pre-excluding is their point). */
function makeRepo() {
  const dir = mkTmp('baton-phase8-repo-');
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Phase8'], dir);
  sh('git', ['commit', '--allow-empty', '-q', '-m', 'base'], dir);
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '.baton/\n');
  return dir;
}

/** A real git repo with NO manual `.git/info/exclude` write — used by C6/C7 to prove the fix
 * that used to require this workaround (see e2e.test.mjs's makeRealRepo, which does it by hand). */
function makeRawRepo() {
  const dir = mkTmp('baton-phase8-raw-repo-');
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Phase8'], dir);
  sh('git', ['commit', '--allow-empty', '-q', '-m', 'base'], dir);
  return dir;
}

async function waitUntil(predicate, { timeoutMs = 1500, intervalMs = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil: condition never became true within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

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

/** Monkeypatches `methodNames` on `obj` in place to record calls, delegating to the original. */
function spyOn(obj, methodNames) {
  const calls = {};
  for (const name of methodNames) {
    calls[name] = [];
    const orig = obj[name].bind(obj);
    obj[name] = (...args) => { calls[name].push(args); return orig(...args); };
  }
  return calls;
}

// ---------- D1-shaped local fake adapter, for the unit-level Coordinator tests (C1/C3/C4) ----------
// Per coordinator.test.mjs's own FIXTURE NOTE convention: this cluster's tests construct a
// minimal local fake conforming to the D1 Adapter contract rather than importing another
// cluster's fixture, so this file has no build-order/import dependency on coordinator.test.mjs.

class FakeAdapter {
  constructor({ harness = 'fake', version = '1.0.0', concurrencyCeiling = Infinity } = {}) {
    this._card = {
      harness, version, authPosture: 'api_key', concurrencyCeiling, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native' },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this.gates = { spawn: null, prompt: null, interrupt: null, kill: null };
    this.acks = {
      spawn: { ok: true }, prompt: { ok: true }, interrupt: { ok: true },
      approve: { ok: true }, answer: { ok: true }, kill: { ok: true },
    };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); if (this.gates.spawn) await this.gates.spawn; return this.acks.spawn; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); if (this.gates.prompt) await this.gates.prompt; return this.acks.prompt; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); if (this.gates.interrupt) await this.gates.interrupt; return this.acks.interrupt; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return this.acks.approve; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return this.acks.answer; }
  async kill(worker) { this.calls.kill.push({ worker }); if (this.gates.kill) await this.gates.kill; return this.acks.kill; }
}

/** Minimal WorktreeManager fake, matching coordinator.test.mjs's SpyWorktreeManager shape. */
class SpyWorktreeManager {
  constructor() {
    this.calls = { create: [], capture: [], createVerifyWorktree: [], removeVerifyWorktree: [], remove: [], reconcile: [] };
  }
  async create(taskId) { this.calls.create.push({ taskId }); return { path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }; }
  async capture(worktreePath, opts) { this.calls.capture.push({ worktreePath, opts }); return { sha: 'sha-result', snapshotted: true }; }
  async createVerifyWorktree(taskId, sha) { this.calls.createVerifyWorktree.push({ taskId, sha }); return { path: `/tmp/verify/${taskId}-${sha}` }; }
  async removeVerifyWorktree(verifyPath) { this.calls.removeVerifyWorktree.push({ verifyPath }); }
  async remove(taskId) { this.calls.remove.push({ taskId }); }
  async reconcile() { this.calls.reconcile.push({}); }
}

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit, matchesClaim: true,
    locus: 'fresh_sandbox', note: 'ok',
  });
}

/** Wires a Coordinator with sane defaults; every dependency overridable — mirrors
 * coordinator.test.mjs's own setup() shape, but local to this file (see FakeAdapter note above). */
function setupCoordinator(overrides = {}) {
  const dir = mkTmp('baton-phase8-coord-');
  const log = overrides.log ?? new Log(join(dir, 'log'));
  const fences = overrides.fences ?? new FenceTable();
  const adapters = overrides.adapters ?? { mock: new FakeAdapter() };
  const worktrees = overrides.worktrees ?? new SpyWorktreeManager();
  const referee = overrides.referee ?? passingReferee();
  const route = overrides.route ?? (() => Object.keys(adapters)[0]);
  let t = 0;
  const now = overrides.now ?? (() => t);
  const advance = (ms) => { t += ms; };
  const coordinator = new Coordinator({
    log, coordination: coordinationForLog(log), fences, adapters, worktrees, referee, route, now,
    approvalTimeoutMs: overrides.approvalTimeoutMs ?? 60000,
    stopDeadlineMs: overrides.stopDeadlineMs ?? 15000,
    accept: overrides.accept,
    acceptOpts: overrides.acceptOpts,
    setTimeout: overrides.setTimeout,
    clearTimeout: overrides.clearTimeout,
  });
  return { dir, log, fences, adapters, worktrees, referee, route, now, advance, coordinator };
}

/** A D1-shaped adapter that writes a file DIRECTLY into the worktree, without ever running
 * `git add`/`git commit` itself — i.e. it leaves the tree genuinely dirty at capture time, unlike
 * the real MockAdapter (which self-commits every edit). Used by C5/C7 to exercise the
 * captureCommit-does-the-attributed-commit path (worktrees.md's CAPTURE step), as opposed to the
 * "worker already committed" path MockAdapter exercises. */
class DirtyWriteAdapter {
  constructor({ harness, version = '1.0.0' }) {
    this._card = {
      harness, version, authPosture: 'api_key', concurrencyCeiling: 4, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native' },
    };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  async spawn(worker, brief, opts = {}) {
    const created = opts.worktreeReady ? await opts.worktreeReady : null;
    const worktree = created && created.path;
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'done.txt'), 'ok');
    const result = {
      status: 'completed',
      progress: 1,
      summary: 'wrote done.txt directly, uncommitted',
      artifacts: { commits: [], files: ['done.txt'] },
      verification: { command: brief.verification.command, claimedExit: brief.verification.expectExit },
      openQuestions: [],
      budgetUsed: { tokens: 1, usd: 0.01 },
    };
    if (this._onEvent) {
      this._onEvent({
        worker, harness: `${this._card.harness}@${this._card.version}`, turnEpoch: 1,
        kind: 'lifecycle.turn_completed', actor: 'worker', payload: { result },
      });
    }
    return { ok: true };
  }
  async prompt() { return { ok: true }; }
  async interrupt() { return { ok: true }; }
  async approve() { return { ok: true }; }
  async answer() { return { ok: true }; }
  async kill() { return { ok: true }; }
}

/** Hand-rolled deterministic fake `setTimeout`/`clearTimeout` pair: records scheduled callbacks
 * without ever touching the real event loop, so C4's tests can simulate a deadline firing with
 * zero real wall-clock wait and zero risk of an indefinite hang if the feature isn't wired yet. */
function makeFakeTimers() {
  let nextId = 1;
  const scheduled = new Map();
  const calls = { setTimeout: [], clearTimeout: [] };
  const fakeSetTimeout = (fn, ms) => {
    const id = nextId += 1;
    const handle = { id, unrefCalled: false, unref() { this.unrefCalled = true; } };
    scheduled.set(id, { fn, handle });
    calls.setTimeout.push({ id, ms, handle });
    return handle;
  };
  const fakeClearTimeout = (handle) => {
    calls.clearTimeout.push(handle);
    if (handle && scheduled.has(handle.id)) scheduled.delete(handle.id);
  };
  const fire = (id) => {
    const entry = scheduled.get(id);
    if (!entry) return false;
    scheduled.delete(id);
    entry.fn();
    return true;
  };
  return { setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, calls, fire, scheduled };
}

// ============================================================
// C1 — GATE: referee.accept() is the single done-gate
// ============================================================

test('C1: requireRedGreen:true fails a verdict that passes the exit-check but never went red->green', async () => {
  const adapter = new FakeAdapter();
  const referee = async () => ({
    reverified: true, passed: true, observedExit: 0, redGreen: false, matchesClaim: true,
    locus: 'fresh_sandbox', note: 'pass but not red->green',
  });
  const { coordinator } = setupCoordinator({
    adapters: { mock: adapter },
    referee,
    accept: (verdict, acceptOpts) => accept(verdict, acceptOpts),
    acceptOpts: { requireRedGreen: true },
  });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id, harness: 'fake@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed',
    actor: 'worker', payload: makeWorkerResult(),
  });
  await coordinator.wait(50);

  const outcome = await coordinator.result(handle.id);
  assert.equal(outcome.ready, true);
  assert.equal(
    outcome.status,
    'failed',
    'requireRedGreen:true must fail a verdict that never went red->green, even though the plain exit-check passed — the coordinator must gate on the INJECTED accept(), not an inline re-derivation'
  );
});

test('C1: the logged verify.reverified payload records both the accept decision and the acceptOpts policy used', async () => {
  const adapter = new FakeAdapter();
  const referee = async () => ({
    reverified: true, passed: true, observedExit: 0, redGreen: false, matchesClaim: true,
    locus: 'fresh_sandbox', note: 'pass but not red->green',
  });
  const { coordinator, log } = setupCoordinator({
    adapters: { mock: adapter },
    referee,
    accept: (verdict, acceptOpts) => accept(verdict, acceptOpts),
    acceptOpts: { requireRedGreen: true },
  });
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id, harness: 'fake@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed',
    actor: 'worker', payload: makeWorkerResult(),
  });
  await coordinator.wait(50);

  const event = log.read(handle.id).find((e) => e.kind === 'verify.reverified');
  assert.ok(event, 'a verify.reverified event must be logged');
  assert.equal(event.payload.accept, false, 'the logged accept decision must reflect the injected policy-gated result');
  assert.deepEqual(
    event.payload.acceptOpts,
    { requireRedGreen: true, requireCoverage: false, requireMutation: false },
    'the exact policy opts used for this decision must be recorded alongside it'
  );
});

test('C1: with no accept/acceptOpts override, behavior is unchanged AND the default policy is still logged', async () => {
  const adapter = new FakeAdapter();
  const referee = passingReferee(); // old-style verdict shape: no .passed field at all
  const { coordinator, log } = setupCoordinator({ adapters: { mock: adapter }, referee }); // no accept/acceptOpts passed
  const handle = await coordinator.spawn('mock', makeBrief());

  adapter.emit({
    worker: handle.id, harness: 'fake@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed',
    actor: 'worker', payload: makeWorkerResult(),
  });
  await coordinator.wait(50);

  const outcome = await coordinator.result(handle.id);
  assert.equal(outcome.status, 'completed', 'default behavior (no override) must be preserved for old-style verdicts lacking .passed');

  const event = log.read(handle.id).find((e) => e.kind === 'verify.reverified');
  assert.ok(event);
  assert.deepEqual(
    event.payload.acceptOpts,
    { requireRedGreen: false, requireCoverage: false, requireMutation: false },
    'even the unconfigured default policy must be visible on the logged event, not silently implicit'
  );
});

// ============================================================
// C2 — DISPATCH: router.pick() is the real selector, not first-fit
// ============================================================

test('C2: with two ceiling-feasible vendors, a strongly router-favored vendor is actually dispatched to, not first-fit', async () => {
  const repoRoot = makeRepo();
  const logDir = mkTmp('baton-phase8-c2-log-');
  const adapterA = new MockAdapter({ scenario: { outcome: 'completed', edits: [] }, card: { harness: 'vendorA', version: '1.0.0' } });
  const adapterB = new MockAdapter({ scenario: { outcome: 'completed', edits: [] }, card: { harness: 'vendorB', version: '1.0.0' } });
  const callsA = spyOn(adapterA, ['spawn']);
  const callsB = spyOn(adapterB, ['spawn']);

  const driver = createDriver({ repoRoot, logDir, adapters: { vendorA: adapterA, vendorB: adapterB } });

  // Strongly favor vendorB: enough recorded verified wins to clear the adaptive floor
  // (DEFAULT_MIN_SAMPLES_FOR_ADAPTIVE), while vendorA has none.
  for (let i = 0; i < 5; i += 1) {
    driver.router.record('vendorB@1.0.0', 'general', true, { family: 'default' });
  }

  await driver.coordinator.spawn('auto', makeBrief(), { taskId: 'route-1', taskType: 'general' });

  assert.equal(callsB.spawn.length, 1, 'the router-favored vendor B must have been dispatched to');
  assert.equal(callsA.spawn.length, 0, 'vendor A must not receive the dispatch when B is strongly favored by real router state');
});

test('C2: with all ceilings saturated, router.pick is consulted (and returns null) and the task queues exactly as before', async () => {
  const repoRoot = makeRepo();
  const logDir = mkTmp('baton-phase8-c2b-log-');
  const adapterA = new MockAdapter({
    scenario: { outcome: 'completed', edits: [{ path: 'a.txt', content: 'a', delayMs: 500 }] },
    card: { harness: 'vendorA', version: '1.0.0', concurrencyCeiling: 1 },
  });
  const adapterB = new MockAdapter({
    scenario: { outcome: 'completed', edits: [{ path: 'b.txt', content: 'b', delayMs: 500 }] },
    card: { harness: 'vendorB', version: '1.0.0', concurrencyCeiling: 1 },
  });
  const driver = createDriver({ repoRoot, logDir, adapters: { vendorA: adapterA, vendorB: adapterB } });
  const pickCalls = spyOn(driver.router, ['pick']);

  const handleA = await driver.coordinator.spawn('vendorA', makeBrief(), { taskId: 'sat-a', taskType: 'general' });
  const handleB = await driver.coordinator.spawn('vendorB', makeBrief(), { taskId: 'sat-b', taskType: 'general' });

  const handleC = await driver.coordinator.spawn('auto', makeBrief(), { taskId: 'sat-c', taskType: 'general' });

  assert.equal(handleC.status, 'pending', 'both vendors are already at their ceiling — the auto task must queue, exactly as before');
  assert.ok(
    pickCalls.pick.length >= 1,
    'router.pick() must actually be consulted at dispatch time, even when the outcome is "queue" — today it is never called anywhere in src/'
  );

  // This test deliberately creates long-running workers. Quiesce all three before suite-level
  // temp cleanup; deleting the authoritative log while workers can still emit is itself an
  // integrity failure and must not be hidden by production code.
  await Promise.all([driver.coordinator.kill(handleA.id, 'policy'), driver.coordinator.kill(handleB.id, 'policy')]);
  await driver.coordinator.kill(handleC.id, 'policy');
});

// ============================================================
// C3 — FENCING AT DELIVERY: send() checks the fence before AND after delivery
// ============================================================

test('C3: bumpHuman before send(), with the caller\'s stale fence supplied — adapter.prompt is never invoked', async () => {
  const adapter = new FakeAdapter();
  const { coordinator, fences } = setupCoordinator({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const oldFence = fences.current(handle.id).fence;
  fences.bumpHuman(handle.id); // an out-of-band fence bump that already happened before this send()

  const result = await coordinator.send(handle.id, { text: 'stale nudge' }, 'nudge', { expectedFence: oldFence });

  assert.equal(
    adapter.calls.prompt.length,
    0,
    'adapter.prompt() must never be invoked once the PRE-check finds the caller\'s supplied fence already stale'
  );
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stale_fence');
});

// Amended by SC4 (spec/phase10/system-completion.md): sends are now serialized per worker and a
// queued send revalidates its guards at slot acquisition — which narrows delivered-despite-stale
// to exactly the window this test pins: a fence bump landing while the delivery itself is on the
// wire. That race is irreducible (un-delivery is impossible; grok queues prompts in-CLI).
test('C3: bumpHuman during an in-flight send() — delivery happens, return is stale_fence, and control.delivery_amended is logged', async () => {
  const adapter = new FakeAdapter();
  const { coordinator, fences, log } = setupCoordinator({ adapters: { mock: adapter } });
  const handle = await coordinator.spawn('mock', makeBrief());

  const gate = deferred();
  adapter.gates.prompt = gate.promise;

  const sendPromise = coordinator.send(handle.id, { text: 'in flight' }, 'nudge');
  // SC4 amendment: deliveries now start on the worker's serialized send lane (a microtask after
  // send() returns), so the bump must land while the delivery is genuinely ON THE WIRE — after
  // adapter.prompt() was invoked and its stamp captured, before the post-await recheck. A bump
  // landing any earlier is now absorbed honestly pre-delivery (see the SC4b tests).
  while (adapter.calls.prompt.length === 0) await new Promise((r) => setTimeout(r, 1));
  fences.bumpHuman(handle.id);
  gate.resolve({ ok: true });

  const result = await sendPromise;

  assert.equal(adapter.calls.prompt.length, 1, 'the delivery genuinely reached the adapter before the staleness was ever discovered');
  assert.equal(result.ok, false);
  assert.equal(result.result, 'stale_fence');

  const kinds = log.read(handle.id).map((e) => e.kind);
  assert.ok(
    kinds.includes('control.delivery_amended'),
    'a delivery that happened despite a stale fence must be logged with a loud, explicit amendment event — never silently suppressed'
  );
  const amendedEvent = log.read(handle.id).find((e) => e.kind === 'control.delivery_amended');
  assert.equal(amendedEvent.payload.deliveredDespiteStale, true);
});

// ============================================================
// C4 — STOP LIVENESS: a real, injectable, unref'd deadline timer independent of tick()
// ============================================================

test('C4: an adapter that never confirms a stop resolves the forced path after the deadline fires, with zero tick() calls after arming', async () => {
  const adapter = new FakeAdapter(); // interrupt() Acks but never emits a confirmed-stop event
  const timers = makeFakeTimers();
  const { coordinator } = setupCoordinator({
    adapters: { mock: adapter },
    stopDeadlineMs: 5000,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const handle = await coordinator.spawn('mock', makeBrief());

  let tickCalls = 0;
  const originalTick = coordinator.tick.bind(coordinator);
  coordinator.tick = (...args) => { tickCalls += 1; return originalTick(...args); };

  const interruptPromise = coordinator.interrupt(handle.id); // not yet awaited
  const ticksAtArm = tickCalls;

  assert.ok(timers.calls.setTimeout.length >= 1, 'a real deadline timer must be armed as soon as the stop begins');
  const armed = timers.calls.setTimeout[timers.calls.setTimeout.length - 1];

  // Simulate the deadline firing — no test-driven tick()/advance()/further command in between,
  // proving liveness does not depend on the caller doing anything else.
  const fired = timers.fire(armed.id);
  assert.ok(fired, 'the armed timer callback must actually be invokable directly');

  const result = await interruptPromise;

  assert.equal(result.result, 'forced');
  assert.equal(
    tickCalls,
    ticksAtArm,
    'no additional tick() calls may occur between arming the deadline timer and the forced resolution it produces'
  );
  assert.equal(armed.handle.unrefCalled, true, 'the armed timer must be unref\'d so it can never keep the process alive on its own');
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'dead');
});

test('C4: an adapter that confirms quickly clears the armed timer; a late manual fire of the cleared callback is a no-op', async () => {
  const adapter = new FakeAdapter();
  const timers = makeFakeTimers();
  const { coordinator, log } = setupCoordinator({
    adapters: { mock: adapter },
    stopDeadlineMs: 5000,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  });
  const handle = await coordinator.spawn('mock', makeBrief());

  const interruptPromise = coordinator.interrupt(handle.id);
  const armed = timers.calls.setTimeout[timers.calls.setTimeout.length - 1];

  adapter.emit({
    worker: handle.id, harness: 'fake@1.0.0', turnEpoch: 1, kind: 'control.interrupt_confirmed',
    actor: 'worker', payload: {},
  });
  const result = await interruptPromise;
  assert.equal(result.result, 'confirmed');

  assert.ok(timers.calls.clearTimeout.length >= 1, 'the armed timer must be cleared once the stop is genuinely confirmed');
  const clearedHandle = timers.calls.clearTimeout[timers.calls.clearTimeout.length - 1];
  assert.equal(clearedHandle, armed.handle, 'clearTimeout must be called with the EXACT handle setTimeout returned');

  const logCountBefore = log.read(handle.id).length;
  const fired = timers.fire(armed.id); // the fake harness honors clearTimeout by deleting the callback
  assert.equal(fired, false, 'a cleared timer must never fire again');
  assert.equal(log.read(handle.id).length, logCountBefore, 'no forced-stop side effect may occur after a confirmed stop');
  assert.equal(coordinator.list().find((w) => w.id === handle.id).status, 'idle');
});

// ============================================================
// C5 — VENDOR ATTRIBUTION: through the real coordinator + real git
// ============================================================

test('C5: a dirty-tree task ends with HEAD authored as baton-worker-<vendor> and a Baton-Vendor trailer', async () => {
  const repoRoot = makeRepo();
  const logDir = mkTmp('baton-phase8-c5a-log-');
  const adapter = new DirtyWriteAdapter({ harness: 'forgevendor' });
  const driver = createDriver({ repoRoot, logDir, adapters: { forgevendor: adapter } });

  const brief = makeBrief({ verification: { command: 'test -f done.txt', expectExit: 0 } });
  const handle = await driver.coordinator.spawn('forgevendor', brief, { taskId: 'attrib-1', taskType: 'general' });

  await waitUntil(async () => (await driver.coordinator.result(handle.id)).ready);
  const outcome = await driver.coordinator.result(handle.id);
  assert.equal(outcome.status, 'completed');

  const worktreeDir = join(repoRoot, '.baton', 'wt', 'attrib-1');
  const author = sh('git', ['log', '-1', '--format=%an'], worktreeDir);
  const body = sh('git', ['log', '-1', '--format=%B'], worktreeDir);

  assert.equal(author, 'baton-worker-forgevendor', 'the snapshot commit author must name the real dispatching vendor');
  assert.ok(body.includes('Baton-Vendor: forgevendor'), 'the commit trailer must name the vendor');
});

test('C5: a self-committed task still logs the vendor on verify.reverified, even though captureCommit cannot rewrite the worker\'s own commit', async () => {
  const repoRoot = makeRepo();
  const logDir = mkTmp('baton-phase8-c5b-log-');
  const scenario = { outcome: 'completed', edits: [{ path: 'done2.txt', content: 'ok' }] };
  const adapter = new MockAdapter({ scenario, card: { harness: 'mock', version: '1.0.0' } });
  const driver = createDriver({ repoRoot, logDir, adapters: { mock: adapter } });

  const brief = makeBrief({ verification: { command: 'test -f done2.txt', expectExit: 0 } });
  const handle = await driver.coordinator.spawn('mock', brief, { taskId: 'attrib-2', taskType: 'general' });

  await waitUntil(async () => (await driver.coordinator.result(handle.id)).ready);
  const outcome = await driver.coordinator.result(handle.id);
  assert.equal(outcome.status, 'completed');

  const worktreeDir = join(repoRoot, '.baton', 'wt', 'attrib-2');
  const isClean = sh('git', ['status', '--porcelain'], worktreeDir) === '';
  assert.equal(isClean, true, 'MockAdapter self-commits its own edits — the tree must already be clean by capture time');

  const event = driver.log.read(handle.id).find((e) => e.kind === 'verify.reverified');
  assert.ok(event, 'a verify.reverified event must be logged');
  assert.equal(event.payload.capture?.snapshotted, false, 'captureCommit must have found a clean tree (no new snapshot commit)');
  assert.equal(
    event.payload.capture?.vendor,
    'mock',
    'log-is-truth: the vendor must still be recorded even though git history itself could not be rewritten'
  );
});

// ============================================================
// C6 — .baton/ EXCLUSION: idempotent, order-safe, content-preserving
// ============================================================

test('C6: pinBaseSha succeeds on a fresh repo with a pre-existing .baton/ dir and no manual exclude', async () => {
  const dir = makeRawRepo();
  mkdirSync(join(dir, '.baton', 'junk'), { recursive: true });
  writeFileSync(join(dir, '.baton', 'junk', 'x.txt'), 'leftover scaffold');

  await assert.doesNotReject(
    () => worktreeMod.pinBaseSha(dir, {}),
    'a pre-existing .baton/ directory must never make pinBaseSha see the repo as dirty'
  );
});

test('C6: the exclude line is not duplicated across repeated calls', async () => {
  const dir = makeRawRepo();
  worktreeMod.ensureBatonExcluded(dir);
  worktreeMod.ensureBatonExcluded(dir);

  const content = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
  const occurrences = content.split('\n').filter((l) => l.trim() === '.baton/').length;
  assert.equal(occurrences, 1, 'the .baton/ exclude line must appear exactly once no matter how many times ensureBatonExcluded runs');
});

test('C6: a pre-existing, unrelated exclude line survives', async () => {
  const dir = makeRawRepo();
  mkdirSync(join(dir, '.git', 'info'), { recursive: true });
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '*.log\n');

  worktreeMod.ensureBatonExcluded(dir);

  const content = readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8');
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  assert.ok(lines.includes('*.log'), 'the pre-existing unrelated exclude line must be preserved, not overwritten');
  assert.ok(lines.includes('.baton/'), 'the new .baton/ exclusion line must be present');
});

// ============================================================
// C7 — ENTRYPOINT: direct tests for createDriver()
// ============================================================

test('C7: createDriver() end-to-end — an honest task completes, is attributed, and the exclude fix holds with no manual workaround', async () => {
  const repoRoot = makeRawRepo(); // deliberately no manual exclude — exercises C6 through the real pinBaseSha call
  mkdirSync(join(repoRoot, '.baton', 'seed'), { recursive: true });
  writeFileSync(join(repoRoot, '.baton', 'seed', 'x.txt'), 'pre-existing scaffold, never manually excluded');
  const logDir = mkTmp('baton-phase8-c7a-log-');

  const adapter = new DirtyWriteAdapter({ harness: 'honestvendor' });
  const driver = createDriver({ repoRoot, logDir, adapters: { honestvendor: adapter } });

  const brief = makeBrief({ verification: { command: 'test -f done.txt', expectExit: 0 } });
  const handle = await driver.coordinator.spawn('honestvendor', brief, { taskId: 'c7-honest', taskType: 'general' });

  await waitUntil(async () => (await driver.coordinator.result(handle.id)).ready);
  const outcome = await driver.coordinator.result(handle.id);
  assert.equal(
    outcome.status,
    'completed',
    'an honest, verification-satisfying task must complete end to end through the real createDriver(), even with a pre-existing un-excluded .baton/ dir'
  );

  const stat = driver.router.getStat('honestvendor@1.0.0', 'general');
  assert.ok(stat && stat.count >= 1, 'the router bucket must have been updated by the real createDriver() record() wiring');

  const worktreeDir = join(repoRoot, '.baton', 'wt', 'c7-honest');
  const author = sh('git', ['log', '-1', '--format=%an'], worktreeDir);
  assert.equal(author, 'baton-worker-honestvendor', 'vendor attribution must reach the real committed HEAD through the real entrypoint');
});

test('C7: createDriver() end-to-end — a forged task never completes, and auto-dispatch genuinely consults router.pick', async () => {
  const repoRoot = makeRepo();
  const logDir = mkTmp('baton-phase8-c7b-log-');
  const scenario = { outcome: 'failed', forgeSuccess: true, edits: [{ path: 'unrelated.txt', content: 'not the ask' }] };
  const adapter = new MockAdapter({ scenario, card: { harness: 'mock', version: '1.0.0' } });
  const driver = createDriver({ repoRoot, logDir, adapters: { mock: adapter } });
  const pickCalls = spyOn(driver.router, ['pick']);

  const brief = makeBrief({ verification: { command: 'test -f done.txt', expectExit: 0 } });
  const handle = await driver.coordinator.spawn('auto', brief, { taskId: 'c7-forged', taskType: 'general' });

  await waitUntil(async () => (await driver.coordinator.result(handle.id)).ready);
  const outcome = await driver.coordinator.result(handle.id);

  assert.equal(outcome.status, 'failed', 'a forged completion must never produce completed, even through the real end-to-end entrypoint');
  assert.equal(outcome.verdict.passed, false);
  assert.ok(!existsSync(join(repoRoot, 'done.txt')), 'the planted artifact the worker claimed to have written must genuinely never exist');

  assert.ok(
    pickCalls.pick.length >= 1,
    'an "auto" dispatch must genuinely consult router.pick() for selection — today it is never called anywhere in src/'
  );
});

test('C7: createDriver({requireCoverage:true}) makes an otherwise-passing task fail when no coverage signal exists — the hardening opt is load-bearing end to end', async () => {
  const repoRoot = makeRepo();
  const logDir = mkTmp('baton-phase8-c7c-log-');
  const adapter = new DirtyWriteAdapter({ harness: 'covvendor' });
  const driver = createDriver({ repoRoot, logDir, adapters: { covvendor: adapter }, requireCoverage: true });

  const brief = makeBrief({ verification: { command: 'test -f done.txt', expectExit: 0 } }); // no coverageCommand configured
  const handle = await driver.coordinator.spawn('covvendor', brief, { taskId: 'c7-cov', taskType: 'general' });

  await waitUntil(async () => (await driver.coordinator.result(handle.id)).ready);
  const outcome = await driver.coordinator.result(handle.id);

  assert.equal(outcome.verdict.passed, true, 'the pinned check itself genuinely passed');
  assert.equal(
    outcome.status,
    'failed',
    'requireCoverage:true must fail acceptance when no coverage signal was ever established, even though the plain check passed — proving createDriver actually plumbs the hardening opt into the live gate'
  );
});
