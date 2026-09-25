// Issue #593: a contribution check judges a capture by the comparison the landing gate uses, not
// by the exit code of a full suite. The suite is red by design since #580 (a test written before
// its feature fails until the feature lands), so an exit-code judgement fails every capture
// whatever it does. The cases below are the issue's own acceptance list:
//
//   a. a capture whose only failures also fail at its base checks green;
//   b. a capture that breaks a test passing at its base checks red naming it;
//   c. a capture that adds a failing test checks red;
//   d. a runner that dies without a verdict fails the check with its runner's last words.
//
// The comparison runs the selected files on the change side and only the failing files the base
// HAS on the base side; the fixture runner records the argv each side was handed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verify } from '../src/referee.mjs';
import { compareSuiteVerdicts, suiteRoots } from '../src/suite-comparison.mjs';

const RUNNER = resolve(import.meta.dirname, 'fixtures', 'issue593-suite-runner.mjs');
const SELECTED = ['impl/test/selected.test.mjs'];

/** A checkout of `files`, with the plan this side's run reports. */
function sandbox(root, side, { plan = null, files = [] } = {}) {
  const dir = join(root, side);
  mkdirSync(join(dir, 'impl', 'test'), { recursive: true });
  for (const file of files) writeFileSync(join(dir, file), '// fixture test file\n');
  writeFileSync(join(dir, '.plan.json'), JSON.stringify(plan ?? {}));
  return dir;
}

const task = () => ({
  id: 'check', worktree: '/owned', workerWorktreeDir: '/owned',
  verification: {
    command: process.execPath, arguments: [RUNNER], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, timeoutMs: 30_000, maxOutputBytes: 65_536,
  },
});

async function compareCapture(t, { changePlan, basePlan, baseHas = [], selected = SELECTED }) {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue593-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const changeDir = sandbox(root, 'change', { plan: changePlan });
  const baseDir = sandbox(root, 'base', { plan: basePlan, files: baseHas });
  const verdict = await verify(task(), { verification: { claimedExit: null } }, { dir: changeDir }, {
    baseSandbox: { dir: baseDir },
    comparison: { files: selected, roots: suiteRoots() },
  });
  const ran = (side) => {
    try { return JSON.parse(readFileSync(join(side === 'change' ? changeDir : baseDir, '.ran.json'), 'utf8')); }
    catch { return []; }
  };
  return { verdict, ranChange: ran('change'), ranBase: ran('base') };
}

const failure = (file, name) => ({ file, name });

test('593a: a capture whose only failures also fail at its base checks green', async (t) => {
  const shared = failure('test/selected.test.mjs', 'written before its feature');
  const { verdict, ranChange, ranBase } = await compareCapture(t, {
    changePlan: { failures: [shared], passed: 4 },
    basePlan: { failures: [shared], passed: 4 },
    baseHas: ['impl/test/selected.test.mjs'],
  });
  assert.equal(verdict.passed, true, 'the failure is the base\'s own, so nothing blocks');
  assert.equal(verdict.outcome, 'passed');
  assert.equal(verdict.observedExit, 0, 'the comparison reports its own exit, not the red run\'s');
  assert.deepEqual(verdict.comparison.blocking, []);
  assert.deepEqual(verdict.comparison.shared, ['test/selected.test.mjs :: written before its feature']);
  assert.deepEqual(verdict.comparison.change.failures, ['test/selected.test.mjs :: written before its feature']);
  assert.equal(verdict.comparison.base.judged, true);
  assert.deepEqual(ranChange, [SELECTED], 'the change side ran the selected files');
  assert.deepEqual(ranBase, [['test/selected.test.mjs']], 'the base side ran the failing file, named as the verdict names it');
});

test('593b: a capture that breaks a test passing at its base checks red naming it', async (t) => {
  const { verdict, ranBase } = await compareCapture(t, {
    changePlan: { failures: [failure('test/selected.test.mjs', 'broke here')], passed: 4 },
    basePlan: { failures: [], passed: 4 },
    baseHas: ['impl/test/selected.test.mjs'],
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.outcome, 'candidate_failed');
  assert.equal(verdict.failureOwnership, 'candidate');
  assert.equal(verdict.observedExit, 1, 'the comparison reports the change run\'s own exit');
  assert.deepEqual(verdict.comparison.blocking, ['test/selected.test.mjs :: broke here']);
  assert.deepEqual(verdict.comparison.shared, []);
  assert.deepEqual(verdict.comparison.base.failures, [], 'the base judged the file and passed it');
  assert.deepEqual(ranBase, [['test/selected.test.mjs']]);
});

test('593c: a capture that adds a failing test checks red — the base has no such file to compare', async (t) => {
  const { verdict, ranBase } = await compareCapture(t, {
    changePlan: { failures: [failure('test/new.test.mjs', 'new red')], passed: 4 },
    basePlan: { failures: [], passed: 4 },
    baseHas: [],
  });
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.comparison.blocking, ['test/new.test.mjs :: new red']);
  assert.equal(verdict.comparison.base, null, 'the base has none of the failing files, so the base never ran');
  assert.deepEqual(ranBase, []);
});

test('593d: a runner that dies without a verdict fails the check with its runner\'s last words', async (t) => {
  const died = 'the runner was killed before it could judge: pipes held at the group reap';
  const { verdict } = await compareCapture(t, {
    changePlan: { died },
    basePlan: { failures: [], passed: 0 },
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.reverified, false, 'the hub derived no truth from a run that did not judge');
  assert.equal(verdict.diagnosticCode, 'verification_unjudged');
  assert.equal(verdict.outcome, 'inconclusive');
  assert.equal(verdict.failureOwnership, 'verifier', 'a run that did not judge is the verifier\'s, never the capture\'s');
  assert.equal(verdict.comparison.change.judged, false);
  assert.match(verdict.failureCapsule.text, /killed before it could judge/u, 'the cause rides the failure capsule');
});

test('593e: a comparison over no files refuses — an empty run would silently mean the whole contract', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue593-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = sandbox(root, 'change', { plan: { failures: [] } });
  await assert.rejects(
    verify(task(), {}, { dir }, { comparison: { files: [], roots: suiteRoots() } }),
    { name: 'TypeError' },
  );
});

test('593f: a base that did not judge blocks every failure, and a document older than #580 compares by key', () => {
  const legacy = { unexpected: ['test/a.test.mjs :: same', 'test/b.test.mjs :: only here'] };
  const shared = compareSuiteVerdicts({
    change: legacy, base: { document: { unexpected: ['test/a.test.mjs :: same'] } },
  });
  assert.deepEqual(shared.blocking.map((row) => row.key), ['test/b.test.mjs :: only here']);
  assert.deepEqual(shared.shared.map((row) => row.key), ['test/a.test.mjs :: same']);

  const unjudged = compareSuiteVerdicts({
    change: legacy, base: { document: null }, note: '; the base run did not judge, so every failure blocks',
  });
  assert.equal(unjudged.blocking.length, 2, 'a base that did not judge shares nothing');
  assert.equal(unjudged.note, '; the base run did not judge, so every failure blocks');
  assert.equal(compareSuiteVerdicts({ change: { failures: [] } }).blocking.length, 0, 'a green change has nothing to compare');
});
