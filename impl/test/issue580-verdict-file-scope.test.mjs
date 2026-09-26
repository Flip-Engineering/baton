// Issue #580: the verdict path a caller hands the suite runner (BATON_SUITE_VERDICT_FILE) belongs
// to that run. A landing gate reads it after the run to compare the change with its target; a
// test file that drives a nested runner must not be able to write its own verdict there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');
const PROBE = 'test/fixtures/issue580-verdict-env-probe.mjs';

test('580c: a test process started by the runner does not see the runner verdict path', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue580-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const verdictPath = join(directory, 'verdict.json');
  const env = { ...process.env, BATON_SUITE_VERDICT_FILE: verdictPath, BATON_TEST_TMP_PARENT: directory };
  delete env.NODE_TEST_CONTEXT;
  const run = await new Promise((done) => {
    const child = spawn(process.execPath, [RUNNER, PROBE], { cwd: IMPL, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', () => done({ code: -1, stderr }));
    child.once('close', (code) => done({ code, stderr }));
  });
  assert.equal(run.code, 0, `the probe passes when the path is withheld: ${run.stderr.slice(-2000)}`);
  const document = JSON.parse(readFileSync(verdictPath, 'utf8'));
  assert.equal(document.green, true);
  assert.equal(document.passed, 1, 'the verdict at the path is this run: one probe test');
});
