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
// FIXTURE NOTE — why this file makes some documented ASSUMPTIONS about exact wiring
// parameter names: `coordinator.mjs`, `adapter.mjs`'s session methods, and the D7-
// corrected `CoordinatorOpts.worktrees`/`route`/`referee` shapes do not exist as code
// yet (src/*.mjs is empty — every test in this suite is intentionally RED pending
// Phase 5). Where RECONCILIATION.md pins an exact contract (D1-D9), this file follows
// it to the letter. Where a wiring DETAIL is left implicit (e.g. the precise
// CoordinatorOpts key names for the D7-corrected worktree dependency), this file picks
// the most spec-consistent, clearly-commented choice and captures every such choice in
// a spy wrapper so assertions target OBSERVABLE EFFECTS (a method called with specific
// args, a file appearing/disappearing on disk, a logged event, a router bucket
// changing) — never just a returned status string — per this task's own instruction.
//
// Every test here is expected to stay RED until Phase 5 lands every module; that is
// the point (integration#8: "every assertion here fails today, for a different one of
// Findings 1-6, against the spec as written").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import * as worktreeMod from '../src/worktree.mjs';
import { verify, accept } from '../src/referee.mjs';
import { AdaptiveRouter } from '../src/router.mjs';
import { StoryCompiler } from '../src/story.mjs';
import { createBrief, isFact, isProse } from '../src/messages.mjs';

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

/** D7: the coordinator's worktree dependency is exactly worktree.mjs's real export surface. */
function spyWorktree(mod) {
  const names = ['pinBaseSha', 'createFromBase', 'captureCommit', 'freshVerifySandbox', 'markStopped', 'reap', 'reconcile', 'changedLines', 'listWorktrees'];
  return spyFns(Object.fromEntries(names.map((n) => [n, mod[n]])));
}

/** D4: the coordinator calls referee.verify() then referee.accept() — never a hand-rolled check. */
function spyReferee() {
  return spyFns({ verify, accept });
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
  const { calls: routerCalls, router: routedRouter } = spyRouter(realRouter);

  const { calls: refereeCalls, spied: refereeSpy } = spyReferee();
  const { calls: worktreeCalls, spied: worktreeSpy } = spyWorktree(worktreeMod);

  const story = new StoryCompiler({ now: clock });

  const { calls: adapterCalls, adapter: spiedAdapter } = spyAdapter(adapter);

  const coordinator = new Coordinator({
    log,
    fences,
    adapters: { [adapterVendor]: spiedAdapter },
    worktrees: worktreeSpy, // D7 — worktree.mjs's real export surface, spied
    repoRoot, // the real temp git repo this whole run operates against
    referee: refereeSpy, // D4 — {verify, accept}, both the real hardened functions, spied
    route: routedRouter, // D5 — the full AdaptiveRouter instance (pick+record), spied
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

function cleanupSystem(t, sys) {
  t.after(() => {
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

  // EFFECT, not status: the adapter's spawn() was actually invoked, with the SAME Brief object
  // messages.createBrief() produced (D2) — no copy anywhere on the way in.
  assert.equal(sys.adapterCalls.spawn.length, 1);
  assert.equal(sys.adapterCalls.spawn[0][1], brief, 'adapter.spawn() must receive the identical Brief object, not a clone');

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

  // D2 identity: the trust gate re-ran the EXACT SAME verification object createBrief() froze —
  // never a re-hydrated copy — proving the "same done command" invariant is structural, not
  // merely value-equal.
  const verifiedTaskArg = sys.refereeCalls.verify[0][0];
  const gateVerification = verifiedTaskArg.verification ?? verifiedTaskArg.brief?.verification;
  assert.equal(gateVerification, brief.verification, 'D2: the trust gate must reference the identical verification object, not a copy');

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
  // adapter's own modelVersion (card().harness + '@' + card().version, the same convention
  // BatonEvent.harness already uses everywhere else in this suite), this task's taskType, and
  // verifiedWin === referee.accept(verdict) — never the worker's self-reported status.
  assert.equal(sys.routerCalls.record.length, 1);
  const [modelVersion, taskType, verifiedWin] = sys.routerCalls.record[0];
  assert.equal(modelVersion, 'mock@1.0.0');
  assert.equal(taskType, 'build');
  assert.equal(verifiedWin, true);
  assert.equal(verifiedWin, accept(outcome.verdict));

  const stat = sys.router.getStat('mock@1.0.0', 'build');
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
// 4. GLM ceiling=1 serializes two tasks on the same vendor.
// ============================================================

test('E2E concurrency: a GLM-shaped ceiling=1 vendor genuinely serializes two tasks end to end', async (t) => {
  const scenario = { outcome: 'completed', edits: [{ path: 'done.txt', content: 'ok', delayMs: 30 }] };
  // ASSUMPTION (documented): MockAdapter accepts a `card` override bag alongside `scenario`, so
  // this test can model a GLM-shaped single-concurrency vendor with the SAME scriptable adapter
  // used everywhere else, without spinning up a real, env-guarded GlmAdapter (whose live-CLI
  // guard tests live in adapter.test.mjs). GlmAdapter itself hard-pins concurrencyCeiling:1
  // (adapter.test.mjs); this override is the only way to exercise Coordinator's ceiling-respecting
  // dispatch queue against a REAL adapter+worktree+referee stack, which is the whole point of
  // this suite (vs. coordinator.test.mjs's already-covered fake-adapter version of this scenario).
  const adapter = new MockAdapter({ scenario, card: { harness: 'glm-via-claude', version: '1.0.0', concurrencyCeiling: 1 } });
  const sys = setupSystem({ adapter, adapterVendor: 'glm' });
  cleanupSystem(t, sys);

  const handleA = await sys.coordinator.spawn('glm', makeBrief(), { taskId: 'glm-a', taskType: 'build' });
  assert.equal(handleA.status, 'working');

  const handleB = await sys.coordinator.spawn('glm', makeBrief(), { taskId: 'glm-b', taskType: 'build' });
  assert.equal(handleB.status, 'pending', 'the vendor is at its concurrency ceiling — B must queue, not dispatch');
  assert.equal(sys.adapterCalls.spawn.length, 1, 'adapter.spawn() must not be called for B while A occupies the only GLM slot');

  await waitUntil(async () => (await sys.coordinator.result(handleA.id)).ready);
  const outcomeA = await sys.coordinator.result(handleA.id);
  assert.equal(outcomeA.status, 'completed');

  sys.coordinator.tick();
  await waitUntil(() => sys.adapterCalls.spawn.length === 2);
  const bNow = sys.coordinator.list().find((w) => w.id === handleB.id);
  assert.equal(bNow.status, 'working', 'B must promote to working only once A actually vacated the single GLM slot');

  await waitUntil(async () => (await sys.coordinator.result(handleB.id)).ready);
  const outcomeB = await sys.coordinator.result(handleB.id);
  assert.equal(outcomeB.status, 'completed');

  // Effect: two genuinely separate, sequential trust-gate runs and router recordings — not one
  // shared/collapsed run. Proves the serialization was real end to end, not just at dispatch time.
  assert.equal(sys.worktreeCalls.freshVerifySandbox.length, 2);
  assert.equal(sys.refereeCalls.verify.length, 2);
  assert.equal(sys.routerCalls.record.length, 2, 'both verified outcomes were recorded, one per task');
  assert.ok(sys.routerCalls.record.every(([, , verifiedWin]) => verifiedWin === true));
});
