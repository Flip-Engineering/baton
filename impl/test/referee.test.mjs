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
import { verify, accept, SameWorktreeError } from '../src/referee.mjs';
import { createFromBase, captureCommit, freshVerifySandbox } from '../src/worktree.mjs';
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

// ============================================================
// red -> green — behaviors 53-55
// ============================================================

test('red->green true: base fails, result passes', async (t) => {
  const base = makeSandbox('base-sha');
  const result = makeSandbox('result-sha');
  t.after(() => { base.cleanup(); result.cleanup(); });
  writeFileSync(join(result.dir, 'done.txt'), 'ok'); // base has no done.txt -> fails

  const task = makeTask();
  const workerResult = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const verdict = await verify(task, workerResult, result, { baseSandbox: base });

  assert.equal(verdict.redGreen, true);
  assert.equal(verdict.baseExit, 1);
  assert.equal(verdict.passed, true);
});

test('red->green false: base already passes ("suspicious green-green")', async (t) => {
  const base = makeSandbox('base-sha');
  const result = makeSandbox('result-sha');
  t.after(() => { base.cleanup(); result.cleanup(); });
  writeFileSync(join(base.dir, 'done.txt'), 'already here');
  writeFileSync(join(result.dir, 'done.txt'), 'still here');

  const task = makeTask();
  const workerResult = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const verdict = await verify(task, workerResult, result, { baseSandbox: base });

  assert.equal(verdict.redGreen, false, 'the check never actually discriminated before/after');
  assert.equal(verdict.passed, true);
  assert.equal(accept(verdict, { requireRedGreen: true }), false);
  assert.equal(accept(verdict, { requireRedGreen: false }), true);
});

test('red->green not evaluated when no baseSandbox is given', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  writeFileSync(join(sandbox.dir, 'done.txt'), 'ok');

  const task = makeTask();
  const workerResult = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.redGreen, null);
  assert.equal(verdict.baseExit, null);
  assert.equal(accept(verdict, { requireRedGreen: true }), false, 'null must not satisfy a required check');
});

// ============================================================
// coverage-of-change — behaviors 56-59
// ============================================================

function coverageCommandReporting(files) {
  const json = JSON.stringify({ files });
  return `node -e "console.log(${JSON.stringify(json)})"`;
}

test('coverage-of-change true: reported executedLines cover every changed line', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  writeFileSync(join(sandbox.dir, 'done.txt'), 'ok');

  const task = makeTask({
    changedLines: { 'src/x.js': [10, 11] },
    verification: {
      command: 'test -f done.txt',
      expectExit: 0,
      coverageCommand: coverageCommandReporting({ 'src/x.js': { executedLines: [10, 11, 12] } }),
    },
  });
  const workerResult = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.coverageOfChange, true);
  assert.deepEqual(verdict.uncoveredChangedLines, []);
});

test('coverage-of-change false: a changed line was never executed', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  writeFileSync(join(sandbox.dir, 'done.txt'), 'ok');

  const task = makeTask({
    changedLines: { 'src/x.js': [10, 11] },
    verification: {
      command: 'test -f done.txt',
      expectExit: 0,
      coverageCommand: coverageCommandReporting({ 'src/x.js': { executedLines: [10] } }),
    },
  });
  const workerResult = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.coverageOfChange, false);
  assert.deepEqual(verdict.uncoveredChangedLines, ['src/x.js:11']);
  assert.equal(accept(verdict, { requireCoverage: true }), false);
});

test('coverage is skipped (null, never invoked) when the main check fails', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  // done.txt absent -> main check fails

  const task = makeTask({
    changedLines: { 'src/x.js': [10] },
    verification: {
      command: 'test -f done.txt',
      expectExit: 0,
      coverageCommand: 'touch coverage-ran.marker', // would prove it ran, if it ran
    },
  });
  const workerResult = makeResult({ status: 'failed', verification: { command: task.verification.command, claimedExit: 1 } });
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.passed, false);
  assert.equal(verdict.coverageOfChange, null);
  assert.ok(!existsSync(join(sandbox.dir, 'coverage-ran.marker')), 'coverage command was never invoked');
});

test('a coverage command producing non-JSON garbage does not crash verify(); coverageOfChange stays null', async (t) => {
  const sandbox = makeSandbox();
  t.after(() => sandbox.cleanup());
  writeFileSync(join(sandbox.dir, 'done.txt'), 'ok');

  const task = makeTask({
    changedLines: { 'src/x.js': [1] },
    verification: {
      command: 'test -f done.txt',
      expectExit: 0,
      coverageCommand: 'printf "not json at all"',
    },
  });
  const workerResult = makeResult({ verification: { command: task.verification.command, claimedExit: 0 } });
  const verdict = await verify(task, workerResult, sandbox);

  assert.equal(verdict.coverageOfChange, null);
  assert.equal(verdict.coverageOfChange, null);
  assert.equal(Object.hasOwn(verdict, 'note'), false);
});

// ============================================================
// accept() truth table — behavior 60
// ============================================================

test('accept() truth table: pins the documented decision logic exactly', () => {
  function referenceAccept(verdict, opts = {}) {
    const { requireRedGreen = false, requireCoverage = false } = opts;
    if (!verdict.reverified || !verdict.passed) return false;
    if (requireRedGreen && verdict.redGreen !== true) return false;
    if (requireCoverage && verdict.coverageOfChange !== true) return false;
    return true;
  }

  const boolCombos = [true, false];
  let checked = 0;
  for (const passed of boolCombos) {
    for (const redGreen of boolCombos) {
      for (const coverageOfChange of boolCombos) {
        for (const requireRedGreen of boolCombos) {
          for (const requireCoverage of boolCombos) {
            const verdict = { reverified: true, passed, redGreen, coverageOfChange };
            const opts = { requireRedGreen, requireCoverage };
            assert.equal(accept(verdict, opts), referenceAccept(verdict, opts), JSON.stringify({ verdict, opts }));
            checked += 1;
          }
        }
      }
    }
  }
  assert.equal(checked, 32, '8 {passed,redGreen,coverageOfChange} combos x 4 {requireRedGreen,requireCoverage} combos');

  // Bonus: reverified:false always fails regardless of everything else.
  assert.equal(accept({ reverified: false, passed: true, redGreen: true, coverageOfChange: true }), false);
});

// ============================================================
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

test('closed plan verification executes argv without a shell, strips ambient env, and fails at the output bound', async (t) => {
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
  assert.equal(verdict.outputExceeded, true);
  assert.equal(verdict.passed, false);
  assert.equal(verdict.observedExit, null);
  assert.equal(verdict.capturedOutputBytes, 64);
  assert.equal(verdict.capturedOutputDigest, createHash('sha256').update('x'.repeat(64)).digest('hex'));
  assert.equal(verdict.diagnosticCode, 'verification_output_exceeded');
  assert.equal(Object.hasOwn(verdict, 'observedOutputTail'), false);
  assert.equal(verdict.failureCapsule.kind, 'verification_failure_tail');
  assert.equal(verdict.failureCapsule.capturedOutputDigest, verdict.capturedOutputDigest);
});
