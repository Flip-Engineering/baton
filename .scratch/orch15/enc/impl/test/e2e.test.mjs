// Cluster-crossing END-TO-END integration suite (Phase 4 BLUE, red integration#8 —
// "the highest-value test to add before Phase 5 implementation starts").
//
// Every other test file in this suite deliberately wires only ONE cluster's real
// modules together (see coordinator.test.mjs's FIXTURE NOTE, and spec's own "Test
// independence note", IMPLEMENTATION.md:635). That is a legitimate per-cluster
// strategy, but it means none of the cross-cluster seams the red team found — the
// Adapter contract mismatch, the trust gate never calling accept(), the router never
// being wired to a verified verdict, provenance never reaching wait()'s digest, three
// incompatible Brief shapes, an EventKind literal drift — were ever exercised by a
// single real system. This file is that missing exercise.
//
// It drives a REAL `Coordinator` wired with:
//   - a REAL, unified session-shaped `MockAdapter` (spec/RECONCILIATION.md D1) — NOT
//     a hand-rolled fake — scripted via `MockScenario` (edits/forgeSuccess/delays),
//     driven purely through `spawn()`/`prompt()`/`interrupt()`/`kill()`/`onEvent()`.
//   - the REAL `worktree.mjs` against a REAL temporary git repository (no mocked git).
//   - the REAL `referee.verify()`/`accept()` hardened trust gate (D4/D6).
//   - a REAL `AdaptiveRouter` (D5).
//   - a REAL `StoryCompiler` fed via a `story: {record}` sink (D3/D8 provenance).
//   - `Brief`s built via the REAL `messages.createBrief()` (D2), never hand-rolled.
//
// FIXTURE NOTE — this file drives the SHIPPED cross-cluster system. `coordinator.mjs`,
// `adapter.mjs`'s session methods, and the D7 worktree/route/referee shapes are real code
// under src/*.mjs, not empty Phase-5 placeholders. Where RECONCILIATION.md pins an exact
// contract (D1-D9), this file follows it to the letter. Where a wiring DETAIL is left
// implicit (e.g., the precise CoordinatorOpts key names for the D7 worktree dependency),
// this file picks the most spec-consistent, clearly-commented choice and captures every
// such choice in a spy wrapper so assertions target OBSERVABLE EFFECTS (a method called
// with specific args, a file appearing/disappearing on disk, a logged event, a router
// bucket changing) — never just a returned status string — per this task's own instruction.
//
// Two of this file's original contracts went obsolete as the runtime moved; both are
// restaged below against the actual shipped behavior: admission now appends an empty
// `attention` grant alongside `orientation` (so the admitted brief is verified field by
// field, both grants asserted independently), and the invented vendor seat ceiling was
// ripped out by operator ruling #221 (so the concurrency case now pins REAL concurrent
// admission and separate verification of both contributions, not a fictional queue).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import * as worktreeMod from '../src/worktree.mjs';
import { verify, accept } from '../src/referee.mjs';
import { AdaptiveRouter } from '../src/router.mjs';
import { StoryCompiler } from '../src/story.mjs';
import { createBrief, isFact, isProse } from '../src/messages.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

// ============================================================
// Helpers
// ============================================================

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

/** A real, initialized git repo with one base commit — the whole system's substrate. */
function makeRealRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-e2e-repo-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton E2E'], dir);
  sh('git', ['commit', '--allow-empty', '-q', '-m', 'base'], dir);
  // baton keeps its worktrees/sandboxes under <repo>/.baton/; pinBaseSha() itself now calls
  // ensureBatonExcluded() first (C6), which writes this exclude line idempotently before the
  // dirty check ever runs — so this helper no longer needs to write it manually.
  return dir;
}

/**
 * Poll a real async predicate until it's true, without a fake clock — appropriate
 * here (unlike the rest of the suite) because this file deliberately drives REAL
 * timers inside the real MockAdapter/referee/git subprocess calls, not a simulated
 * clock. Mirrors the existing real-timing style already used in adapter.test.mjs /
 * worktree.test.mjs / referee.test.mjs.
 */
async function waitUntil(predicate, { timeoutMs = 5000, intervalMs = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitUntil: condition never became true within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** A one-shot promise gate. The concurrency case uses it as its deterministic fixture
 * boundary — an explicit deferred resolved by the test, never a wall-clock sleep standing
 * in for a concurrency proof. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/**
 * A narrow delivery gate: every D1 method delegates straight to the REAL adapter, but the
 * initial provider delivery (`spawn` — the call that hands a worker its prompt) is held open
 * until `release()`. Nothing about the real MockAdapter, its worktree readiness or its git
 * effects is replaced; only the instant of delivery is deferred. Holding two deliveries open
 * at once is therefore a deterministic proof that both workers are in flight simultaneously:
 * a serializing dispatcher could never invoke the second while the first is still undelivered.
 */
function gatedDelivery(adapter) {
  const gate = deferred();
  const held = [];
  let released = false;
  const wrapped = {};
  for (const method of ['card', 'spawn', 'prompt', 'interrupt', 'approve', 'answer', 'kill', 'onEvent']) {
    wrapped[method] = adapter[method].bind(adapter);
  }
  wrapped.spawn = (...args) => {
    held.push(args[0]);
    return gate.promise.then(() => adapter.spawn(...args));
  };
  return { adapter: wrapped, held, get released() { return released; }, release: () => { released = true; gate.resolve(); } };
}

// ---------- spy wrappers: record calls to REAL modules while delegating to them ----------
// Every hardened assertion in this file checks an EFFECT — a specific method called with
// specific args, never just a returned status — per this task's instruction. These spies
// make that possible without reimplementing any of the real modules' behavior.

function spyOn(obj, methodNames) {
  const calls = {};
  const spied = {};
  for (const name of methodNames) {
    calls[name] = [];
    const orig = obj[name].bind(obj);
    spied[name] = (...args) => {
      calls[name].push(args);
      return orig(...args);
    };
  }
  return { calls, spied };
}

function spyFns(fns) {
  const calls = {};
  const spied = {};
  for (const [name, fn] of Object.entries(fns)) {
    calls[name] = [];
    spied[name] = (...args) => {
      calls[name].push(args);
      return fn(...args);
    };
  }
  return { calls, spied };
}

/** D1: the unified session-shaped Adapter contract — spy every method the coordinator calls. */
function spyAdapter(adapter) {
  const { calls, spied } = spyOn(adapter, ['card', 'spawn', 'prompt', 'interrupt', 'approve', 'answer', 'kill', 'onEvent']);
  return { calls, adapter: spied };
}

/** D5: router.pick/record are the two coordinator-facing surfaces; getStat/snapshot pass through. */
function spyRouter(router) {
  const { calls, spied } = spyOn(router, ['pick', 'record']);
  spied.getStat = router.getStat.bind(router);
  spied.snapshot = router.snapshot.bind(router);
  return { calls, router: spied };
}

/**
 * D7: worktree.mjs's REAL functions, spied (so `worktreeCalls.captureCommit` etc. still assert
 * real effects), wrapped into the coordinator's manager interface (create/capture/
 * createVerifyWorktree/removeVerifyWorktree/remove/reconcile) with the real temp repo closed over.
 */
function makeWorktreeManager(repoRoot) {
  const { calls, spied } = spyFns({
    pinBaseSha: worktreeMod.pinBaseSha,
    createFromBase: worktreeMod.createFromBase,
    captureCommit: worktreeMod.captureCommit,
    freshVerifySandbox: worktreeMod.freshVerifySandbox,
    markStopped: worktreeMod.markStopped,
    reap: worktreeMod.reap,
    reconcile: worktreeMod.reconcile,
    changedLines: worktreeMod.changedLines,
    listWorktrees: worktreeMod.listWorktrees,
  });
  const manager = {
    async create(taskId) {
      const base = await spied.pinBaseSha(repoRoot, {});
      const r = await spied.createFromBase(repoRoot, taskId, base.sha, {});
      return { path: r.dir, branch: r.branch, baseSha: r.baseSha };
    },
    async capture(worktreePath) {
      return await spied.captureCommit(repoRoot, basename(worktreePath), {});
    },
    async createVerifyWorktree(taskId, sha) {
      const r = await spied.freshVerifySandbox(repoRoot, taskId, sha, {});
      return { path: r.dir ?? r.path };
    },
    async removeVerifyWorktree(verifyPath) {
      try { execFileSync('git', ['worktree', 'remove', '--force', verifyPath], { cwd: repoRoot, stdio: 'ignore' }); } catch { /* noop */ }
      try { rmSync(verifyPath, { recursive: true, force: true }); } catch { /* noop */ }
    },
    async remove(taskId) { try { await spied.reap(repoRoot, taskId, { force: true }); } catch { /* noop */ } },
    async reconcile() { try { await spied.reconcile(repoRoot, []); } catch { /* noop */ } },
    markStopped: (taskId) => spied.markStopped(repoRoot, taskId),
  };
  return { calls, manager };
}

/**
 * D4/D6: the real hardened referee, spied, adapted to the coordinator's referee-fn contract
 * (task, result, {pinnedVerification, sandbox}). Maps the coordinator's task.worktree ->
 * workerWorktreeDir (the D6 freshness field) and its string sandbox -> {dir}.
 */
function makeReferee() {
  const { calls, spied } = spyFns({ verify, accept });
  const refereeFn = async (task, result, opts) => {
    const mapped = { ...task, workerWorktreeDir: task.worktree, verification: opts.pinnedVerification };
    const verdict = await spied.verify(mapped, result, { dir: opts.sandbox }, {});
    spied.accept(verdict);
    return verdict;
  };
  return { calls, refereeFn };
}

/** D2: the one Brief shape, built via the real messages.createBrief(), never hand-rolled. */
function makeBrief(overrides = {}) {
  return createBrief({
    goal: 'create done.txt containing "ok"',
    constraints: [],
    pathScope: ['**'],
    definitionOfDone: 'done.txt exists and the pinned check passes',
    verification: { command: 'test -f done.txt', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 10 },
    ...overrides,
  });
}

/**
 * Wires a full, real system: real temp git repo, real Log/FenceTable, a real
 * AdaptiveRouter (D5), a real StoryCompiler fed via the story sink (D3/D8), the real
 * hardened referee (D4/D6), and the real worktree.mjs export surface (D7) — every
 * dependency spied for effect-level assertions, none faked.
 */
function setupSystem({ adapter, adapterVendor = 'mock', now } = {}) {
  const repoRoot = makeRealRepo();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-e2e-log-'));
  const clock = now ?? (() => Date.now());

  const log = new Log(logDir, () => new Date(clock()).toISOString());
  const fences = new FenceTable();

  const realRouter = new AdaptiveRouter({ mode: 'adaptive', now: clock });
  // D5: the coordinator selects via route(task,cards,inFlight) and learns via route.record(...).
  const routerCalls = { pick: [], record: [] };
  // SC9 (phase10): this stub is deliberately synthetic — it records the call and returns the one
  // vendor unconditionally, and will NEVER mirror the real route() in index.mjs (feasibility +
  // nonRefuserFor restriction + router.pick + first-listed collision rule). Real-entrypoint
  // routing is covered by C7 (phase8-correctness.test.mjs) and SC7 (phase10-completion.test.mjs).
  const routeFn = (task, cards, inFlight) => { routerCalls.pick.push([task, cards, inFlight]); return adapterVendor; };
  routeFn.record = (mv, tt, win) => { routerCalls.record.push([mv, tt, win]); return realRouter.record(mv, tt, win); };

  const { calls: refereeCalls, refereeFn } = makeReferee();
  const { calls: worktreeCalls, manager: worktreeManager } = makeWorktreeManager(repoRoot);

  const story = new StoryCompiler({ now: clock });

  const { calls: adapterCalls, adapter: spiedAdapter } = spyAdapter(adapter);

  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences,
    adapters: { [adapterVendor]: spiedAdapter },
    worktrees: worktreeManager, // D7 — worktree.mjs wrapped into the coordinator's manager interface, spied
    repoRoot, // the real temp git repo this whole run operates against
    referee: refereeFn, // D4/D6 — real hardened verify+accept, spied, in the coordinator's fn contract
    route: routeFn, // D5 — selection fn with a .record hook into the real AdaptiveRouter, spied
    story: { record: (event) => story.ingest(event) }, // D8/D3 wiring
    now: clock,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
  });

  return {
    repoRoot,
    logDir,
    log,
    fences,
    router: realRouter,
    routerCalls,
    refereeCalls,
    worktreeCalls,
    story,
    adapterCalls,
    coordinator,
  };
}

function cleanupSystem(t, sys, release = () => {}) {
  t.after(async () => {
    release();
    // Drain exactly the resources this run owns through the same real surfaces that created
    // them — stop every worker (two-phase, adapter-confirmed) and let the coordinator reap its
    // own worktrees/runtime — BEFORE the temp repo and log trees are deleted out from under
    // them. Deleting first would leave git worktree metadata and adapter sessions dangling.
    await Promise.all(sys.coordinator.list().map(
      (worker) => sys.coordinator.kill(worker.id, 'test-cleanup'),
    ));
    sys.coordinator.closeAuthority();
    rmSync(sys.repoRoot, { recursive: true, force: true });
    rmSync(sys.logDir, { recursive: true, force: true });
  });
}

// ============================================================
// 1. Normal task: spawn -> work -> captureCommit -> freshVerifySandbox ->
//    referee.verify -> accept -> 'completed', logged, story renders it.
// ============================================================

test('E2E happy path: a real task runs the whole spawn->trust-gate->completed pipeline end to end, logged and narrated', async (t) => {
  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'done.txt', content: 'ok' }],
    summary: 'wrote done.txt as asked',
  };
  const adapter = new MockAdapter({ scenario, card: { harness: 'mock', version: '1.0.0' } });
  const sys = setupSystem({ adapter });
  cleanupSystem(t, sys);

  const brief = makeBrief();
  const handle = await sys.coordinator.spawn('mock', brief, { taskId: 'happy-1', taskType: 'build' });
  assert.equal(handle.status, 'working');

  // CI1 EFFECT: admission snapshots even a previously-created Brief. The adapter gets identical
  // content but never a caller-owned object whose nested verification could change mid-run.
  assert.equal(sys.adapterCalls.spawn.length, 1);
  assert.notEqual(sys.adapterCalls.spawn[0][1], brief, 'CI1: adapter receives an admission-owned snapshot');
  // Admission adds context grants while preserving every delegation field.
  const admitted = sys.adapterCalls.spawn[0][1];
  const { orientation, attention, ...delegationSnapshot } = admitted;
  assert.deepEqual(delegationSnapshot, brief, 'CI1: snapshot preserves the delegation contract field for field');
  // O-6: the pathScope-scoped L0 orientation grant — a cited, framed context-pack ADDED at
  // admission, never a mutation of the delegation fields.
  assert.ok(orientation && orientation.packId, 'O-6: the L0 orientation grant is cited into the brief');
  // Issue #79 (D1/D3): a worker-addressed brief always carries the pending-attention push; the
  // empty pending set is attached as `[]` (the renderer omits the section) — asserted
  // independently of the orientation grant so neither hides the other.
  assert.deepEqual(attention, [], 'the empty pending-attention push is attached for an addressed worker');
  assert.ok(Object.isFrozen(admitted), 'CI1: admitted snapshot is immutable');

  await waitUntil(async () => (await sys.coordinator.result(handle.id)).ready);
  const outcome = await sys.coordinator.result(handle.id);

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.verdict.passed, true);
  assert.equal(accept(outcome.verdict), true);

  // EFFECT: the hardened trust gate genuinely ran — captureCommit + freshVerifySandbox +
  // referee.verify were each called exactly once for this task (D4's pipeline, for real).
  assert.equal(sys.worktreeCalls.captureCommit.length, 1);
  assert.equal(sys.worktreeCalls.freshVerifySandbox.length, 1);
  assert.equal(sys.refereeCalls.verify.length, 1);
  assert.ok(sys.refereeCalls.accept.length >= 1);

  // CI1/D2 identity: the trust gate re-runs the exact ADMITTED verification object that the
  // adapter received, not caller-owned mutable state.
  const verifiedTaskArg = sys.refereeCalls.verify[0][0];
  const gateVerification = verifiedTaskArg.verification ?? verifiedTaskArg.brief?.verification;
  assert.equal(gateVerification, sys.adapterCalls.spawn[0][1].verification, 'CI1: adapter and gate share the immutable admitted definition of done');
  assert.notEqual(gateVerification, brief.verification, 'CI1: caller-owned verification is outside the admitted trust boundary');

  // D6: the sandbox referee.verify() actually ran in must never be the worker's own worktree.
  const sandboxArg = sys.refereeCalls.verify[0][2];
  const sandboxDir = sandboxArg?.dir ?? sandboxArg;
  const ownWorktree = sys.coordinator.list().find((w) => w.id === handle.id)?.worktree;
  assert.ok(sandboxDir, 'referee.verify must have been called with a sandbox');
  assert.notEqual(sandboxDir, ownWorktree, 'D6: the verify sandbox must never be the worker\'s own worktree');

  // EFFECT: the fresh verify sandbox is actually cleaned up afterward, not leaked on disk.
  assert.ok(!existsSync(sandboxDir), 'the fresh verify sandbox must be reaped after the trust gate runs');

  // Logged: the real ordered event trail on the real Log, not an inference from a return value.
  const kinds = sys.log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('lifecycle.spawned'));
  assert.ok(kinds.includes('lifecycle.turn_started'));
  assert.ok(kinds.includes('lifecycle.turn_completed'));
  assert.ok(kinds.includes('verify.reverified'), 'D4: the trust gate\'s own verdict must be logged');
  const verifyIdx = kinds.indexOf('verify.reverified');
  const turnCompletedIdx = kinds.indexOf('lifecycle.turn_completed');
  assert.ok(turnCompletedIdx < verifyIdx || kinds.filter((k) => k === 'lifecycle.turn_completed').length >= 1, 'the claimed completion precedes/accompanies the re-verification');

  // Story renders it: a REAL StoryCompiler, fed only via the coordinator's story sink, reflects
  // the real completion — proving the wiring (not just story.mjs's own unit-level fold) works.
  const narrative = sys.story.narrative();
  assert.equal(typeof narrative, 'string');
  assert.notEqual(narrative, 'No workers active.', 'the story sink must actually have been fed real events');

  // D8: coordinator.wait()'s digest never carries bare/untagged data — every fact entry carries
  // hub-computed provenance, and prose (if any) is isolated and marked untrusted. This is the
  // load-bearing safety property (SYSTEM.md §5.6) tested at the COORDINATOR level, not just
  // inside messages.mjs's own unit tests (red integration#4).
  const digest = await sys.coordinator.wait(50);
  assert.ok(digest.facts.length > 0, 'a real completed run must have produced at least one fact');
  assert.ok(digest.facts.every(isFact), 'every entry in digest.facts must pass messages.isFact()');
  assert.ok(!digest.facts.some(isProse), 'facts and prose lanes must never mix');
  if (digest.prose && digest.prose.length > 0) {
    assert.ok(digest.prose.every(isProse), 'anything worker-authored in the digest must be tagged untrusted:true, never presented as fact');
  }

  // D5: the router learned from the VERIFIED win — record() called exactly once, with the
  // adapter's resolved route tuple, this task's taskType, and
  // verifiedWin === referee.accept(verdict) — never the worker's self-reported status.
  assert.equal(sys.routerCalls.record.length, 1);
  const [modelVersion, taskType, verifiedWin] = sys.routerCalls.record[0];
  const routeKey = '["mock","1.0.0","default","default","default","build"]';
  assert.equal(modelVersion, routeKey);
  assert.equal(taskType, 'build');
  assert.equal(verifiedWin, true);
  assert.equal(verifiedWin, accept(outcome.verdict));

  const stat = sys.router.getStat(routeKey, 'build');
  assert.ok(stat !== null && stat.count >= 1, 'the router bucket must actually reflect the recorded win');
});

// ============================================================
// 2. forgeSuccess: worker claims done, committed code actually fails the pinned
//    check -> the lie is CAUGHT. Task ends 'failed', never 'completed'.
// ============================================================

test('E2E forge caught: a MockAdapter that lies about completion is caught by the trust gate — task ends failed, never completed', async (t) => {
  const scenario = {
    outcome: 'failed',
    forgeSuccess: true,
    edits: [{ path: 'unrelated.txt', content: 'not what was asked for' }],
  };
  const adapter = new MockAdapter({ scenario, card: { harness: 'mock', version: '1.0.0' } });
  const sys = setupSystem({ adapter });
  cleanupSystem(t, sys);

  const brief = makeBrief();
  const handle = await sys.coordinator.spawn('mock', brief, { taskId: 'forge-1', taskType: 'build' });

  await waitUntil(async () => (await sys.coordinator.result(handle.id)).ready);
  const outcome = await sys.coordinator.result(handle.id);

  assert.equal(outcome.status, 'failed', 'a forged completion claim must never produce completed');
  assert.equal(outcome.verdict.passed, false, 'the fresh sandbox genuinely observes the pinned check failing');
  assert.equal(outcome.verdict.matchesClaim, false, 'the claim diverges from what was actually observed');
  assert.equal(accept(outcome.verdict), false);

  // Effect: the worker's own forged claim is still logged VERBATIM (never silently edited) —
  // but the coordinator's derived outcome.status diverges from it. This proves the coordinator
  // computes its own truth via referee.accept() rather than trusting/copying the worker's claim.
  const turnCompletedEvent = sys.log.read(handle.id).find((e) => e.kind === 'lifecycle.turn_completed');
  assert.ok(turnCompletedEvent);
  assert.equal(turnCompletedEvent.payload.status, 'completed', 'the raw (lying) worker claim in the log is untouched');
  assert.notEqual(outcome.status, turnCompletedEvent.payload.status, 'coordinator.result() must diverge from the raw worker claim once caught');

  assert.ok(!existsSync(join(sys.repoRoot, 'done.txt')), 'the pinned artifact genuinely never existed — the lie was real, not just labeled as one');

  // D5: router.record was driven by the VERIFIED loss (false) — never by the worker's claimed
  // "completed" status. This is the concrete, testable form of "only verified wins count".
  assert.equal(sys.routerCalls.record.length, 1);
  const [, , verifiedWin] = sys.routerCalls.record[0];
  assert.equal(verifiedWin, false, 'router.record must receive the verified failure, never the worker\'s self-reported success');
  assert.equal(verifiedWin, accept(outcome.verdict));
});

// ============================================================
// 3. Interrupt lands: two-phase stop, worker confirms.
// ============================================================

test('E2E interrupt: two-phase stop actually lands mid-run — stopping synchronously, confirmed only once the real adapter emits the confirmation', async (t) => {
  const scenario = {
    outcome: 'completed',
    edits: [
      { path: 'a.txt', content: 'a', delayMs: 5 },
      { path: 'b.txt', content: 'b', delayMs: 3000 }, // never reached — interrupted first
    ],
  };
  const adapter = new MockAdapter({ scenario, card: { harness: 'mock', version: '1.0.0' } });
  const sys = setupSystem({ adapter });
  cleanupSystem(t, sys);

  const handle = await sys.coordinator.spawn('mock', makeBrief(), { taskId: 'interrupt-1', taskType: 'build' });

  // Let the first (fast) scripted edit land — well before the slow second edit — before interrupting.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const interruptPromise = sys.coordinator.interrupt(handle.id);
  // Phase 1 (synchronous, red core#2/D9): status flips to stopping immediately, before any
  // confirmation has arrived.
  assert.equal(sys.coordinator.list().find((w) => w.id === handle.id).status, 'stopping');

  const result = await interruptPromise;
  // Phase 2: the promise only resolves once the REAL adapter's confirmed-stop event fires —
  // never on the initial Ack.
  assert.equal(result.result, 'confirmed', 'the worker must actually confirm the stop, not merely accept the request');

  const finalStatus = sys.coordinator.list().find((w) => w.id === handle.id).status;
  assert.ok(['idle', 'cancelled'].includes(finalStatus), `expected a resolved non-working status, got ${finalStatus}`);

  // Effect: adapter.interrupt() was actually called, exactly once, for this worker.
  assert.equal(sys.adapterCalls.interrupt.length, 1);
  assert.equal(sys.adapterCalls.interrupt[0][0], handle.id);

  // Effect: the confirmed stop is a REAL logged event, not just a resolved promise (red core#2).
  const kinds = sys.log.read(handle.id).map((e) => e.kind);
  assert.ok(kinds.includes('control.interrupt_requested'));
  assert.ok(kinds.includes('control.interrupt_confirmed'));

  // Effect: the run was ACTUALLY stopped, not merely marked stopped — the slow second edit,
  // scheduled well after the interrupt landed, never reached disk.
  assert.ok(!existsSync(join(sys.repoRoot, '.baton', 'wt', 'interrupt-1', 'b.txt')), 'the slow second edit must never land once truly interrupted');

  // D9: a task that never reached a claimed completion must never enter the trust gate, and
  // must never feed the router — an interrupted run is not a verified outcome of any kind.
  assert.equal(sys.refereeCalls.verify.length, 0);
  assert.equal(sys.routerCalls.record.length, 0, 'an interrupted run must never be recorded as a router win or loss');
});

// ============================================================
// 4. Two same-vendor tasks are admitted and run CONCURRENTLY when the card configures NO
//    ceiling — absence throttles nothing (a card that DOES configure one is enforced with a
//    durable deferral receipt; see coordinator.test.mjs "a configured ceiling defers...").
// ============================================================

test('E2E concurrency: with no configured ceiling, two tasks on the same vendor are admitted together and both real contributions are verified separately', async (t) => {
  const scenario = { outcome: 'completed', edits: [{ path: 'done.txt', content: 'ok' }] };
  // The card declares no concurrencyCeiling (canonical null = no configured limit). The #221
  // ruling killed the invented 4/1 constructor defaults; the 2026-09-13 admission pass closed
  // the other half — a CONFIGURED ceiling now defers with a ledgered receipt instead of a
  // silent skip — so an unconfigured card is the honest fixture for "both run at once".
  // One shared MockAdapter instance drives both workers; the delivery gate below makes
  // their overlap provable without a slow delay standing in for concurrency.
  const adapter = new MockAdapter({ scenario, card: { harness: 'glm-via-claude', version: '1.0.0' } });
  const delivered = gatedDelivery(adapter);
  const sys = setupSystem({ adapter: delivered.adapter, adapterVendor: 'glm' });
  cleanupSystem(t, sys, delivered.release);

  const handleA = await sys.coordinator.spawn('glm', makeBrief(), { taskId: 'glm-a', taskType: 'build' });
  assert.equal(handleA.status, 'working', '#221: A dispatches immediately');
  const handleB = await sys.coordinator.spawn('glm', makeBrief(), { taskId: 'glm-b', taskType: 'build' });
  assert.equal(handleB.status, 'working', '#221: the ceiling pre-cap is gone — B dispatches at once, never queued behind A');

  // Deterministic in-flight boundary (explicit deferred, no wall-clock sleep): A's initial
  // delivery is held open, yet B's delivery still reaches the REAL adapter. A serializing
  // dispatcher could never invoke the adapter for B while A is undelivered, so both deliveries
  // being held at once is proof the two workers are genuinely in flight together.
  await waitUntil(() => delivered.held.length === 2);
  assert.deepEqual([...delivered.held].sort(), [handleA.id, handleB.id].sort(), 'both workers reached real delivery');
  assert.equal(delivered.released, false, 'both deliveries were held open simultaneously — the workers overlapped');
  assert.equal(sys.adapterCalls.spawn.length, 2, 'the real adapter saw both spawns before either delivery was released');

  // Release the shared gate: both REAL MockAdapter sessions now run concurrently against their
  // own real worktrees, capture, fresh sandbox, referee gate and router.
  delivered.release();

  await waitUntil(async () => (await sys.coordinator.result(handleA.id)).ready
    && (await sys.coordinator.result(handleB.id)).ready);
  const outcomeA = await sys.coordinator.result(handleA.id);
  const outcomeB = await sys.coordinator.result(handleB.id);
  assert.equal(outcomeA.status, 'completed', JSON.stringify(sys.log.read(handleA.id)));
  assert.equal(outcomeB.status, 'completed', JSON.stringify(sys.log.read(handleB.id)));
  assert.equal(outcomeA.verdict.passed, true, 'A\'s real contribution passed the fresh trust gate');
  assert.equal(outcomeB.verdict.passed, true, 'B\'s real contribution passed the fresh trust gate');
  assert.equal(accept(outcomeA.verdict), true);
  assert.equal(accept(outcomeB.verdict), true);

  // Separately-owned trust-gate runs: two captures, two fresh sandboxes, two verdicts, each under
  // its own task identity — not one shared/collapsed run.
  assert.equal(sys.worktreeCalls.captureCommit.length, 2);
  assert.equal(sys.worktreeCalls.freshVerifySandbox.length, 2);
  assert.equal(sys.refereeCalls.verify.length, 2);
  assert.deepEqual(
    sys.refereeCalls.verify.map(([task]) => task.id).sort(),
    ['glm-a', 'glm-b'],
    'each real contribution reached the trust gate under its own task identity',
  );

  // Both workers produced their own real log trail (real MockAdapter, real worktree, real git).
  for (const id of [handleA.id, handleB.id]) {
    const kinds = sys.log.read(id).map((e) => e.kind);
    assert.ok(kinds.includes('lifecycle.spawned'));
    assert.ok(kinds.includes('lifecycle.turn_started'));
    assert.ok(kinds.includes('lifecycle.turn_completed'));
    assert.ok(kinds.includes('verify.reverified'), `the trust gate logged a verdict for ${id}`);
  }

  // The router learned two separate VERIFIED wins.
  assert.equal(sys.routerCalls.record.length, 2, 'both verified outcomes were recorded, one per task');
  assert.deepEqual(sys.routerCalls.record.map(([, , verifiedWin]) => verifiedWin), [true, true]);
});
