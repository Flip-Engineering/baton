// Issue #508 — a file under test/ that never imports `node:test` is not a runnable test.
//
// The --changed import graph (issue #300) selects any impl/test/ path that a changed module
// reaches, and a directly named file runs the same way. Both reach driver scripts and helper
// modules (issue480-citation-driver.mjs, seam-member-source.mjs): such a file has no
// test-registration import, produces no test events, and the verdict read the run as
// "(file exited 0 without reporting)" — an unexpected failure indistinguishable from a
// genuinely broken test.
//
// Red-before: `node impl/scripts/run-suite.mjs --changed impl/test/issue480-citation-driver.mjs`
// was RED with `unexpected failure: test/issue480-citation-driver.mjs :: (file exited 0 without
// reporting)`, and `node impl/scripts/run-suite.mjs test/seam-member-source.mjs` was RED the
// same way. After the fix the runner classifies every file it is about to schedule by the file's
// own source, skips a file with no test-framework import, and the verdict names the skip and
// stays green.
//
// Row inventory (4 rows — red at HEAD, green after):
//   (a) a --changed selection that lands on the driver reports it skipped, not failed
//   (b) a directly named helper module reports skipped, not failed
//   (c) a real test file still runs: no skip rows for it, and it passes
//   (d) the verdict primitives carry the skip: green, named per row, in the document
//
// Suite-law hygiene: hermetic (spawns the runner on in-repo files with a mkdtemp verdict path
// and suite parent; test.after cleanup); no clocks as controls.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { computeVerdict, formatVerdict, verdictDocument } from '../scripts/suite-verdict.mjs';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');

function driveRunner(t, args) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue508-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const verdictPath = join(directory, 'verdict.json');
  const env = { ...process.env, BATON_SUITE_VERDICT_FILE: verdictPath, BATON_TEST_TMP_PARENT: directory };
  delete env.NODE_TEST_CONTEXT;
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [RUNNER, ...args], {
      cwd: IMPL, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => resolveRun({ code: -1, stderr, verdictPath }));
    child.once('close', (code) => resolveRun({ code, stderr, verdictPath }));
  });
}

test('(a) a --changed selection that lands on the driver reports it skipped, not failed', async (t) => {
  const run = await driveRunner(t, ['--changed', 'impl/test/issue480-citation-driver.mjs']);
  assert.equal(run.code, 0, `the driver-shaped file is not a failure: ${run.stderr.slice(-2000)}`);
  assert.match(run.stderr, /impl\/test\/issue480-citation-driver\.mjs \(changed\)/u,
    'the selection still says why the file was selected');
  assert.match(run.stderr, /0 file\(s\) expanded from 1 changed path\(s\): 0 in the parallel lane/u,
    'the plan schedules nothing for a selection that is entirely non-test files');
  assert.match(run.stderr, /skipped: no test-framework import: test\/issue480-citation-driver\.mjs/u,
    'the verdict names the skip and its reason');
  assert.doesNotMatch(run.stderr, /^ {2}unexpected failure:/mu, 'no unexpected failure is reported');
  const document = JSON.parse(readFileSync(run.verdictPath, 'utf8'));
  assert.equal(document.green, true, 'a skipped non-test file does not redden the verdict');
  assert.deepEqual(document.unexpected, []);
  assert.deepEqual(document.skipped, [{ file: 'test/issue480-citation-driver.mjs', reason: 'no test-framework import' }]);
});

test('(b) a directly named helper module reports skipped, not failed', async (t) => {
  const run = await driveRunner(t, ['test/seam-member-source.mjs']);
  assert.equal(run.code, 0, `the helper module is not a failure: ${run.stderr.slice(-2000)}`);
  assert.match(run.stderr, /skipped: no test-framework import: test\/seam-member-source\.mjs/u);
  assert.doesNotMatch(run.stderr, /^ {2}unexpected failure:/mu);
  const document = JSON.parse(readFileSync(run.verdictPath, 'utf8'));
  assert.equal(document.green, true);
  assert.deepEqual(document.skipped, [{ file: 'test/seam-member-source.mjs', reason: 'no test-framework import' }]);
});

test('(c) a real test file still runs: no skip rows for it, and it passes', async (t) => {
  const run = await driveRunner(t, ['test/suite-verdict.test.mjs']);
  assert.doesNotMatch(run.stderr, /^ {2}unexpected failure:/mu);
  assert.doesNotMatch(run.stderr, /skipped: no test-framework import/u);
  const document = JSON.parse(readFileSync(run.verdictPath, 'utf8'));
  assert.deepEqual(document.skipped, []);
  assert.ok(document.passed > 0, 'the named test file actually ran and passed');
});

test('(d) the verdict primitives carry the skip: green, named per row, in the document', () => {
  const skipped = [{ file: 'test/driver.mjs', reason: 'no test-framework import' }];
  const verdict = computeVerdict([{ lane: 'suite', passed: [], failed: [], skipped }], { rows: [] });
  assert.equal(verdict.green, true, 'a skipped non-test file is not a failure');
  assert.deepEqual(verdict.skipped, skipped);
  assert.match(formatVerdict(verdict), /skipped: no test-framework import: test\/driver\.mjs/u);
  assert.match(formatVerdict(verdict), /1 skipped/u);
  assert.deepEqual(verdictDocument(verdict).skipped, skipped);
});
