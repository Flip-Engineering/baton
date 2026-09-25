// Cluster 2 (Workers & Trust) — referee.mjs test suite.
// THE TRUST GATE. These are the most important tests in the cluster: verify() must
// re-run the PINNED command in the fresh sandbox and ignore the worker's self-report.
// A worker that FORGES "done" (claims pass while the committed code actually fails the
// pinned check) must be caught. Tiny real repos with real shell/node one-liner test
// commands are used so the gate runs for real, not against a stub.
//
// D6 (spec/RECONCILIATION.md, authoritative — resolves red workers-trust#1/#4): the
// freshness guard is MANDATORY, not opt-in. IMPLEMENTATION.md's `RefereeTask.workerWorktreeDir`
// was documented "omit if unknown," making R1's defensive half a silent no-op whenever a
// caller forgot to pass it — and the flagship test itself omitted it. Per D6, `verify()`
// MUST assert `sandbox.dir !== task.workerWorktreeDir` unconditionally: the field is now
// REQUIRED (verify() rejects if it's missing, distinct from rejecting because it EQUALS
// sandbox.dir), and every test that exercises the trust gate supplies it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify, accept, SameWorktreeError, withVerificationLane, defaultVerificationConcurrency } from '../src/referee.mjs';
import { createFromBase, captureCommit, freshVerifySandbox } from '../src/worktree.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { MockAdapter } from '../src/adapter.mjs';

// ---------- helpers ----------

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

/** A plain throwaway directory standing in for a VerifySandbox — referee.mjs never
 * imports worktree.mjs, it just receives {dir, sha, cleanup} as data. */
function makeSandbox(sha = 'deadbeef') {
  const dir = mkdtempSync(join(tmpdir(), 'baton-referee-sandbox-'));
  return { dir, sha, cleanup: async () => rmSync(dir, { recursive: true, force: true }) };
}

function makeRealRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-referee-repo-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Test'], dir);
  sh('git', ['commit', '--allow-empty', '-q', '-m', 'base'], dir);
  return dir;
}

// D6: workerWorktreeDir is now a REQUIRED field (not "omit if unknown") — every task
// fixture supplies a real, distinct placeholder path by default so ordinary pass/fail/
// red-green/coverage tests keep exercising the mandatory-but-satisfied path; tests that
// specifically probe the guard itself override it explicitly.
const PLACEHOLDER_WORKER_WORKTREE_DIR = join(tmpdir(), 'baton-referee-worker-placeholder-never-used-as-a-real-dir');

function makeTask(overrides = {}) {
  return {
    id: 't1',
    verification: { command: 'test -f done.txt', expectExit: 0 },
    workerWorktreeDir: PLACEHOLDER_WORKER_WORKTREE_DIR,
    ...overrides,
  };
}

function makeResult(overrides = {}) {
  return {
    status: 'completed',
    progress: 1,
    summary: 'did the thing',
    artifacts: { commits: ['abc123'], files: [] },
    verification: { command: 'test -f done.txt', claimedExit: 0 },
    openQuestions: [],
    budgetUsed: { tokens: 10, usd: 0.01 },
    ...overrides,
  };
}

function stubLog() {
  const events = [];
  return { events, log: { append: (e) => { events.push(e); return e; } } };
}

// ============================================================
// basic pass/fail/divergence — behaviors 47-49
// ============================================================

test('basic pass: a genuinely passing sandbox with a matching claim is accepted', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  writeFileSync(join(sandbox.dir, 'done.txt'), 'ok');

  const task = makeTask();
  const result = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const verdict = await verify(task, result, sandbox);

  assert.equal(verdict.passed, true);
  assert.equal(verdict.matchesClaim, true);
  assert.equal(verdict.observedExit, 0);
  assert.equal(verdict.locus, 'fresh_sandbox');
  assert.equal(accept(verdict), true);
});

test('basic fail: a genuinely failing sandbox with an honest claim is rejected but not divergent', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  // done.txt deliberately absent

  const task = makeTask();
  const result = makeResult({ status: 'failed', verification: { command: task.verification.command, claimedExit: 1 } });
  const verdict = await verify(task, result, sandbox);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.matchesClaim, true, 'the worker honestly claimed failure');
  assert.equal(accept(verdict), false);
});

test('divergence: a genuinely failing sandbox but a claim of the passing exit code is caught', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  // done.txt deliberately absent -> command will really fail

  const task = makeTask();
  const result = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } }); // lies
  const verdict = await verify(task, result, sandbox);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.matchesClaim, false);
  assert.equal(verdict.diagnosticCode, 'verification_claim_diverged');
  assert.equal(Object.hasOwn(verdict, 'note'), false);
  assert.equal(accept(verdict), false);
});

// ============================================================
// SameWorktreeError / mandatory freshness guard — behavior 50, hardened per D6
// ============================================================

test('verify() rejects with SameWorktreeError when sandbox.dir equals the worker\'s own worktree, and never runs the command', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());

  const task = makeTask({ workerWorktreeDir: sandbox.dir, verification: { command: 'touch ran.marker', expectExit: 0 } });
  const result = makeResult();

  await assert.rejects(() => verify(task, result, sandbox), SameWorktreeError);
  assert.ok(!existsSync(join(sandbox.dir, 'ran.marker')), 'the verification command was never invoked');
});

test('D6: the freshness guard is NOT optional — verify() rejects if task.workerWorktreeDir is omitted entirely, before running the command', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());

  const task = makeTask({ verification: { command: 'touch ran.marker', expectExit: 0 } });
  delete task.workerWorktreeDir; // simulate a caller that "forgot" — the old, dangerous "omit if unknown" path
  const result = makeResult();

  await assert.rejects(
    () => verify(task, result, sandbox),
    (err) => {
      // A caller-contract violation (missing required field) is distinct from catching
      // an actual same-dir forgery: never silently treated as "no defense configured,
      // proceed anyway," and never mistaken for SameWorktreeError itself.
      assert.ok(!(err instanceof SameWorktreeError), 'a MISSING field is not the same failure as an EQUAL field');
      assert.match(err.message, /workerWorktreeDir/i);
      return true;
    },
  );
  assert.ok(!existsSync(join(sandbox.dir, 'ran.marker')), 'the verification command never ran without the guard armed');
});

test('sanity check: a workerWorktreeDir that is merely DIFFERENT from sandbox.dir never spuriously throws SameWorktreeError', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  writeFileSync(join(sandbox.dir, 'done.txt'), 'ok');

  const someOtherRealDir = mkdtempSync(join(tmpdir(), 'baton-referee-other-worker-dir-'));
  const task = makeTask({ workerWorktreeDir: someOtherRealDir });
  const result = makeResult();

  const verdict = await verify(task, result, sandbox);
  assert.equal(verdict.passed, true, 'the guard checks exact-dir-equality, not mere presence of a workerWorktreeDir');
  rmSync(someOtherRealDir, { recursive: true, force: true });
});

// ============================================================
// timeout — behavior 51
// ============================================================

test('a verification command that outlives timeoutMs resolves with observedExit:null and a timeout note, without hanging', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());

  const task = makeTask({ verification: { command: 'sleep 5', expectExit: 0, timeoutMs: 100 } });
  const result = makeResult({ verification: { command: 'sleep 5', claimedExit: 0 } });
  const verdict = await verify(task, result, sandbox);

  assert.equal(verdict.observedExit, null);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.diagnosticCode, 'verification_timed_out');
});

// ============================================================
// end-to-end forge-catch — behavior 52 (the flagship integration test)
// ============================================================

test('FLAGSHIP: a MockAdapter forgeSuccess run is caught end-to-end across worktree + adapter + referee', async (t) => {
  const repoRoot = makeRealRepo();
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  const baseSha = sh('git', ['rev-parse', 'HEAD'], repoRoot);

  const handle = await createFromBase(repoRoot, 'forge-task', baseSha);

  const brief = {
    goal: 'create done.txt',
    constraints: [],
    pathScope: [],
    definitionOfDone: 'done.txt exists',
    verification: { command: 'test -f done.txt', expectExit: 0 },
    budget: { tokens: 100, usd: 1, wallMin: 10 },
  };
  // The mock LIES: it claims completed/passing but never actually writes done.txt.
  const scenario = {
    outcome: 'failed',
    forgeSuccess: true,
    edits: [{ path: 'unrelated.txt', content: 'not what was asked for' }],
  };
  const adapter = new MockAdapter({ scenario });
  const workerResult = await adapter.run(brief, { worktree: handle.dir, timeoutMs: 20000 });

  // The worker's self-report claims victory.
  assert.equal(workerResult.status, 'completed');
  assert.equal(workerResult.verification.claimedExit, 0);

  const { sha: resultSha } = await captureCommit(repoRoot, 'forge-task');
  const sandbox = await freshVerifySandbox(repoRoot, 'forge-task-result', resultSha);
  t.after(() => sandbox.cleanup());

  // D6/red workers-trust#4: workerWorktreeDir is REQUIRED — the flagship test must
  // arm BOTH the structural guarantee (a genuinely distinct sandbox dir) and the
  // defensive SameWorktreeError check simultaneously, never omit it as the old test did.
  const task = { id: 'forge-task', verification: brief.verification, workerWorktreeDir: handle.dir };
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.passed, false, 'the trust gate independently observes the check really fails');
  assert.equal(verdict.matchesClaim, false, 'the claim diverges from what was actually observed');
  assert.equal(accept(verdict), false, 'a forged done is never accepted');
});

test('FLAGSHIP-2: freshness is PROVEN to be the mechanism — a check that would spuriously PASS in the worker\'s own poisoned dir genuinely FAILS in the fresh sandbox (red workers-trust#7)', async (t) => {
  // The original flagship test proves "the gate re-checks and doesn't trust the claim,"
  // but its forged content (an unrelated file) never makes `test -f done.txt` pass
  // ANYWHERE — so it can't distinguish "the gate re-ran the check" from "the gate
  // specifically ran it in a FRESH sandbox." This test closes that gap: done.txt is
  // planted directly on disk in the worker's own worktree (so checking that directory
  // as-is would spuriously PASS) but via a .gitignore entry it is structurally excluded
  // from every commit — the worker's own literal commit, AND captureCommit's snapshot-
  // if-dirty fallback, AND therefore the fresh sandbox checked out from that commit.
  // Only running in the fresh sandbox catches the lie; running in the worker's own dir
  // would have been fooled.
  const repoRoot = makeRealRepo();
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  writeFileSync(join(repoRoot, '.gitignore'), 'done.txt\n');
  sh('git', ['add', '-A'], repoRoot);
  sh('git', ['commit', '-q', '-m', 'add gitignore'], repoRoot);
  const baseSha = sh('git', ['rev-parse', 'HEAD'], repoRoot);

  const handle = await createFromBase(repoRoot, 'poison-task', baseSha);

  const brief = {
    goal: 'create done.txt',
    constraints: [],
    pathScope: [],
    definitionOfDone: 'done.txt exists',
    verification: { command: 'test -f done.txt', expectExit: 0 },
    budget: { tokens: 100, usd: 1, wallMin: 10 },
  };
  // done.txt IS written to disk (a real file, real content) — but it's gitignored, so
  // `git add -A && git commit` (both the mock's own commit and captureCommit's
  // snapshot-if-dirty fallback) never actually tracks it.
  const scenario = { outcome: 'failed', forgeSuccess: true, edits: [{ path: 'done.txt', content: 'ok' }] };
  const adapter = new MockAdapter({ scenario });
  const workerResult = await adapter.run(brief, { worktree: handle.dir, timeoutMs: 20000 });
  assert.equal(workerResult.status, 'completed', 'the mock lies about status, as scripted');

  // THE PROOF, part 1: re-running the pinned check directly in the worker's own
  // worktree — the thing R1 exists to prevent — would be FOOLED (the file is really
  // there on disk, gitignore or not).
  const wouldFoolWorkerDir = existsSync(join(handle.dir, 'done.txt'));
  assert.equal(wouldFoolWorkerDir, true, 'sanity: the worker\'s own directory really does have the planted file on disk');

  // THE PROOF, part 2: the captured commit — and therefore the fresh sandbox checked
  // out from it — never includes the gitignored file at all.
  const { sha: resultSha } = await captureCommit(repoRoot, 'poison-task');
  const sandbox = await freshVerifySandbox(repoRoot, 'poison-task-result', resultSha);
  t.after(() => sandbox.cleanup());
  assert.ok(!existsSync(join(sandbox.dir, 'done.txt')), 'the fresh sandbox never received the gitignored plant');

  const task = { id: 'poison-task', verification: brief.verification, workerWorktreeDir: handle.dir };
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.passed, false, 'freshness catches what re-running in the worker\'s own dir would have missed');
  assert.equal(verdict.matchesClaim, false);
  assert.equal(verdict.locus, 'fresh_sandbox', 'the verdict is explicit about WHERE the check ran — the load-bearing property');
  assert.equal(accept(verdict), false);
});
// log emission — behavior 61
// ============================================================

test('verify() appends exactly one verify.reverified event whose payload deep-equals the returned Verdict', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  writeFileSync(join(sandbox.dir, 'done.txt'), 'ok');

  const task = makeTask();
  const workerResult = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const { events, log } = stubLog();
  const verdict = await verify(task, workerResult, sandbox, { log, worker: 'w1' });

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'verify.reverified');
  assert.equal(events[0].actor, 'policy');
  assert.deepEqual(events[0].payload, verdict);
});

// ============================================================
// closed captured-output receipt — behavior 62 / Phase 90 RV
// ============================================================

test('successful captured verifier output is represented only by its exact byte count and SHA-256 digest', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());

  const command = `node -e "process.stdout.write('x'.repeat(5000))"`;
  const task = makeTask({ verification: { command, expectExit: 0 } });
  const workerResult = makeResult({ verification: { command, claimedExit: 0 } });
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.capturedOutputBytes, 5000);
  assert.equal(verdict.capturedOutputDigest, createHash('sha256').update('x'.repeat(5000)).digest('hex'));
  assert.equal(Object.hasOwn(verdict, 'observedOutputTail'), false);
  assert.equal(verdict.failureCapsule, null);
  assert.equal(Object.hasOwn(verdict, 'note'), false);
});

test('failed verifier output retains one bounded sanitized tail capsule bound to the full output digest', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz012345';
  const diagnostic = `${'prefix\n'.repeat(2_000)}${sandbox.dir}/impl/test/failure.test.mjs:42\n`
    + `authorization: Bearer ${secret}\nAssertionError: expected 1 to equal 2\n`;
  const verification = {
    command: 'node',
    arguments: ['-e', `process.stderr.write(${JSON.stringify(diagnostic)});process.exit(1)`],
    cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 5_000,
    maxOutputBytes: 64 * 1_024, requiredPredecessorEvidence: [],
  };
  const task = makeTask({ verification });
  const verdict = await verify(task,
    makeResult({ verification: { command: verification.command, claimedExit: 1 } }), sandbox);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.failureCapsule.schemaVersion, 1);
  assert.equal(verdict.failureCapsule.kind, 'verification_failure_tail');
  assert.equal(Buffer.byteLength(verdict.failureCapsule.text) <= 8_192, true);
  assert.equal(verdict.failureCapsule.truncated, true);
  assert.equal(verdict.failureCapsule.capturedOutputBytes, verdict.capturedOutputBytes);
  assert.equal(verdict.failureCapsule.capturedOutputDigest, verdict.capturedOutputDigest);
  assert.match(verdict.failureCapsule.text, /AssertionError: expected 1 to equal 2/u);
  assert.equal(verdict.failureCapsule.text.includes(secret), false);
  assert.equal(verdict.failureCapsule.text.includes(sandbox.dir), false);
  assert.match(verdict.failureCapsule.text, /\[verification-sandbox\]/u);
  assert.equal(verdict.failureCapsule.textDigest,
    createHash('sha256').update(verdict.failureCapsule.text).digest('hex'));
});

test('closed plan verification executes argv without a shell, strips ambient env, and keeps its verdict past the output bound', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  process.env.BATON_TEST_CREDENTIAL = 'must-not-cross';
  t.after(() => { delete process.env.BATON_TEST_CREDENTIAL; });
  const verification = {
    command: 'node',
    arguments: ['-e', "if (process.env.BATON_TEST_CREDENTIAL) process.exit(9); process.stdout.write('x'.repeat(128));"],
    cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 5_000,
    maxOutputBytes: 64, requiredPredecessorEvidence: [],
  };
  const verdict = await verify(
    makeTask({ verification }),
    makeResult({ verification: { command: 'node', claimedExit: 0 } }),
    sandbox,
  );
  // #266: output is bounded evidence (32-byte head + 32-byte tail of the 128 written), the exit
  // code is the verdict — a verifier is never killed for printing.
  assert.equal(verdict.outputExceeded, true);
  assert.equal(verdict.passed, true);
  assert.equal(verdict.observedExit, 0);
  assert.equal(verdict.capturedOutputBytes, 64);
  assert.equal(verdict.capturedOutputDigest, createHash('sha256').update('x'.repeat(64)).digest('hex'));
  assert.equal(verdict.diagnosticCode, 'verification_passed');
  assert.equal(Object.hasOwn(verdict, 'observedOutputTail'), false);

  const failing = await verify(
    makeTask({ verification: { ...verification, arguments: ['-e', "process.stdout.write('head-'.repeat(40)); process.stderr.write('tail-marker\\n'); process.exit(1);"] } }),
    makeResult({ verification: { command: 'node', claimedExit: 0 } }),
    sandbox,
  );
  assert.equal(failing.outputExceeded, true);
  assert.equal(failing.passed, false);
  assert.equal(failing.observedExit, 1);
  assert.equal(failing.diagnosticCode, 'verification_claim_diverged');
  assert.ok(failing.capturedOutputBytes <= 64, 'the capture stays within the bound');
  assert.match(failing.failureCapsule.text, /tail-marker/u, 'the capsule still shows how the run ended');
  assert.match(failing.failureCapsule.text, /bytes omitted between head and tail/u);
  assert.equal(failing.failureCapsule.kind, 'verification_failure_tail');
  assert.equal(failing.failureCapsule.capturedOutputDigest, failing.capturedOutputDigest);
  assert.equal(verdict.failureCapsule, null, 'a passing verdict carries no failure capsule, however much it printed');
});

// #269: one verification lane per deployment. Verifications queue in order behind the lane;
// a rejection releases it; the lane count is derived from the machine unless configured.
test('withVerificationLane runs at most `concurrency` verifications at once, in order, and a rejection releases the lane', async () => {
  const gates = [];
  const order = [];
  const referee = (label) => new Promise((resolve, reject) => { order.push(`start:${label}`); gates.push({ label, resolve, reject }); });
  const laned = withVerificationLane(referee, { concurrency: 1 });
  assert.deepEqual({ concurrency: laned.lane.concurrency, running: laned.lane.running, queued: laned.lane.queued }, { concurrency: 1, running: 0, queued: 0 });
  const first = laned('a'); const second = laned('b'); const third = laned('c');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start:a'], 'only the first verification starts');
  assert.deepEqual({ running: laned.lane.running, queued: laned.lane.queued }, { running: 1, queued: 2 });
  gates[0].reject(Object.assign(new Error('verifier refused'), { code: 'verification_spawn_unavailable' }));
  await assert.rejects(first, { code: 'verification_spawn_unavailable' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start:a', 'start:b'], 'a rejection releases the lane to the next in order');
  gates[1].resolve('b-done');
  assert.equal(await second, 'b-done');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start:a', 'start:b', 'start:c']);
  gates[2].resolve('c-done');
  assert.equal(await third, 'c-done');
  assert.deepEqual({ running: laned.lane.running, queued: laned.lane.queued }, { running: 0, queued: 0 });
});

test('the verification lane count is derived from the machine and only overridden explicitly', () => {
  assert.equal(defaultVerificationConcurrency({ cores: 8 }), 1, 'the suite takes every core but one, so one lane');
  assert.equal(defaultVerificationConcurrency({ cores: 8, verificationCores: 2 }), 3, 'a lighter verification earns more lanes, from the cores left after the hub keeps its own');
  assert.equal(defaultVerificationConcurrency({ cores: 2 }), 1, 'a two-core machine runs one suite, not two (2026-09-14 audit G-29)');
  assert.equal(defaultVerificationConcurrency({ cores: 3 }), 1);
  assert.equal(defaultVerificationConcurrency({ cores: 1 }), 1);
  assert.ok(withVerificationLane(async () => 'x').lane.concurrency >= 1, 'the default lane count is a positive integer on this machine');
  assert.throws(() => withVerificationLane(async () => 'x', { concurrency: 0 }), /positive safe integer/u);
  assert.throws(() => withVerificationLane(async () => 'x', { concurrency: 1.5 }), /positive safe integer/u);
  assert.throws(() => withVerificationLane('not a function'), /requires a referee function/u);
});

// 2026-09-14 audit G-19: the pinned command's quoted spans are tokenized at the nearest quote that
// ends a token, so two quoted arguments stay two arguments. Under the previous last-quote rule this
// command became `sh -c 'exit $1" sh "3'`, a syntax error blamed on the candidate.
test('two quoted arguments in a pinned command are two argv entries, and the receipt runs what it says', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  const command = 'sh -c "exit $1" sh "3"';
  const task = makeTask({ verification: { command, expectExit: 3 } });
  const result = makeResult({ verification: { command, claimedExit: 3 } });
  const verdict = await verify(task, result, sandbox);
  assert.equal(verdict.observedExit, 3, 'the shell received `exit $1` and `3` as separate arguments');
  assert.equal(verdict.passed, true);
});

// 2026-09-14 audit G-18: a first token that is not an executable on the deployment PATH (a shell
// builtin here) falls back to a real shell, and the abandoned direct-exec child's late `close`
// (-2) no longer settles the verdict as a candidate failure before the shell runs.
test('a pinned command whose first token is a shell builtin is judged by the shell fallback, not by the dead direct-exec child', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  const command = 'command -v sh';
  const task = makeTask({ verification: { command, expectExit: 0 } });
  const result = makeResult({ verification: { command, claimedExit: 0 } });
  const verdict = await verify(task, result, sandbox);
  assert.equal(verdict.observedExit, 0, 'the shell fallback ran the builtin');
  assert.equal(verdict.passed, true);
});

// ============================================================
// 2026-09-14 audit — G-10 (one output bound), G-12 (one timeout), G-15 (expectExit)
// ============================================================

// G-10: the legacy string path (the pinned text command, plus every coverage and mutation run)
// bounds its capture exactly as the closed argv path has since #266 — head and rolling tail,
// `outputExceeded` reported, the exit code still the verdict. The bound is the contract's own row,
// so no execution path can grow its own literal.
test('G-10: a legacy string verification is bounded at its declared row and keeps its verdict', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  const verification = { command: `node -e "process.stdout.write('x'.repeat(256))"`, expectExit: 0, maxOutputBytes: 64 };
  const task = makeTask({ verification });
  const result = makeResult({ verification: { command: verification.command, claimedExit: 0 } });

  const verdict = await verify(task, result, sandbox);

  assert.equal(verdict.passed, true, 'the exit code is the verdict, whatever the verifier printed');
  assert.equal(verdict.observedExit, 0);
  assert.equal(verdict.outputExceeded, true);
  assert.equal(verdict.capturedOutputBytes, 64, 'half the bound as the head, half as the rolling tail');
  assert.equal(verdict.capturedOutputDigest, createHash('sha256').update('x'.repeat(64)).digest('hex'));
  assert.equal(verdict.diagnosticCode, 'verification_passed');
});

// G-10: a legacy contract predates `maxOutputBytes` (the northbound scratch_oracle shape), and its
// transcript is one durable evidence body — so the bound is the frame-limits registry's declared
// `spill.body` row, never a number minted in the referee for this path alone.
test('G-10: a legacy contract with no declared bound is bounded by the frame registry row, not a second literal', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  const bound = FRAME_LIMITS['spill.body'].value;
  const verification = { command: `node -e "process.stdout.write('y'.repeat(${bound + 4096}))"`, expectExit: 0 };
  const task = makeTask({ verification });
  const result = makeResult({ verification: { command: verification.command, claimedExit: 0 } });

  const verdict = await verify(task, result, sandbox);

  assert.equal(verdict.passed, true);
  assert.equal(verdict.outputExceeded, true);
  assert.equal(verdict.capturedOutputBytes, bound, 'the one declared bound, not the whole transcript');
});

// G-10: the same one bound governs the auxiliary runs, and evidence past it is never half-parsed
// into a signal. The padding comes FIRST and the report last, so the payload stays one argv token
// (a bare inner `"` followed by a space would end the quoted span — G-19) and the report alone is
// what a read-whole verifier would parse.
test('G-15: accept() honors the expectExit its callers thread in', () => {
  const verdict = {
    reverified: true, passed: true, observedExit: 0,
    redGreen: true, coverageOfChange: true, mutationPassed: true,
  };
  assert.equal(accept(verdict), true, 'no expectation threaded: unchanged behaviour');
  assert.equal(accept(verdict, { expectExit: 0 }), true);
  assert.equal(accept(verdict, { expectExit: 1 }), false, 'a verdict observed at another exit is not this row\'s pass');
  assert.equal(accept({ ...verdict, observedExit: 3 }, { expectExit: 3 }), true);
  assert.equal(accept({ ...verdict, observedExit: 3 }, { expectExit: 0 }), false);
  assert.equal(accept({ ...verdict, reverified: false }, { expectExit: 0 }), false);
});
