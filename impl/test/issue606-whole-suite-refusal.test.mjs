// Issue #606: a suite run that names no files refuses, and a name the runner cannot resolve is
// reported instead of dropped. On 2026-09-26 13:31Z sixteen whole-suite runs started at once — an
// empty file list made each one expand to every file in the suite, taking the host to load 187.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');
const ABSENT = 'test/no-such-file-issue606.test.mjs';

function runRunner(t, args) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue606-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, BATON_TEST_TMP_PARENT: directory };
  // The markers a landing gate passes its own gate run are not this run's: the refusals below are
  // the ones a caller outside a gate meets.
  delete env.BATON_SUITE_GATE;
  delete env.BATON_SUITE_VERDICT_FILE;
  delete env.NODE_TEST_CONTEXT;
  return new Promise((done) => {
    const child = spawn(process.execPath, [RUNNER, ...args], {
      cwd: IMPL, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => done({ code: -1, stderr }));
    child.once('close', (code) => done({ code, stderr }));
  });
}

test('a run with no file list refuses and names the fix', async (t) => {
  const run = await runRunner(t, []);
  assert.equal(run.code, 1, 'a bare run does not silently expand to the whole suite');
  assert.match(run.stderr, /no test files were named/u, 'the refusal says what was missing');
  assert.match(run.stderr, /test\/<file>/u, 'the refusal names the path form to pass');
  assert.match(run.stderr, /--all/u, 'the refusal names the deliberate whole-suite flag');
  assert.doesNotMatch(run.stderr, /file\(s\) expanded/u, 'no lane was planned');
});

test('a named path the checkout does not carry is reported and refused', async (t) => {
  const run = await runRunner(t, ['test/suite-verdict.test.mjs', ABSENT]);
  assert.equal(run.code, 1, 'a run cannot report a green over a name it never opened');
  assert.match(run.stderr, /do not resolve to a file in this checkout/u, 'the refusal says why');
  assert.match(run.stderr, new RegExp(ABSENT.replaceAll('.', '\\.'), 'u'),
    'the unresolved name is reported, not dropped');
  assert.doesNotMatch(run.stderr, /file\(s\) expanded/u, 'no lane ran for an unresolved name');
});

test('--all is a runner flag, so the no-files refusal does not fire for it', async (t) => {
  // `--all`'s own path is the whole suite, which `npm test` exercises; this drives a run that
  // still refuses for another reason and asserts WHICH refusal it was.
  const run = await runRunner(t, ['--all', ABSENT]);
  assert.equal(run.code, 1);
  assert.doesNotMatch(run.stderr, /no test files were named/u, '--all named the whole suite');
  assert.match(run.stderr, /do not resolve to a file in this checkout/u);
});
