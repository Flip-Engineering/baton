// Issue #290 deliverable 6 (audit swarm-a lead second tier / swarm worker finding): the suite
// runner's --write-expected-red flag rewrites the whole expected-red manifest from the run's own
// failures — so it must refuse an explicit-file run, whose rows the manifest rewrite would judge
// without ever having executed them. The refusal names the flag's contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMPL = resolve(import.meta.dirname, '..');
const RUNNER = join(IMPL, 'scripts', 'run-suite.mjs');
const MANIFEST = join(IMPL, 'scripts', 'expected-red-tests.json');

test('I290-R1: --write-expected-red refuses an explicit-file run and leaves the manifest untouched', async (t) => {
  const manifestBefore = readFileSync(MANIFEST, 'utf8');
  const parent = join(IMPL, 'test');
  const child = spawn(process.execPath, [RUNNER, 'issue290-explicit-file-run.fixture.test.mjs', '--write-expected-red'], {
    cwd: IMPL,
    env: { ...process.env, BATON_TEST_TMP_PARENT: parent },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code, signal] = await new Promise((resolveClose) => {
    child.once('error', resolveClose);
    child.once('close', (exitCode, exitSignal) => resolveClose([exitCode, exitSignal]));
  });
  assert.equal(signal, null);
  assert.equal(code, 1, 'the explicit-file manifest rewrite is refused, not silently performed');
  assert.match(stderr, /--write-expected-red/,
    'the refusal names the flag whose contract was violated');
  assert.match(stderr, /explicit file|explicit-file/i,
    'the refusal names the explicit-file run it refused to rewrite from');
  assert.match(stderr, /full suite|full-suite|entire suite|complete suite/i,
    'the refusal states what the flag requires instead');
  assert.equal(readFileSync(MANIFEST, 'utf8'), manifestBefore,
    'the expected-red manifest is byte-identical after the refusal');
  assert.equal(stdout, '', 'no verdict is produced for a refused invocation');
});
